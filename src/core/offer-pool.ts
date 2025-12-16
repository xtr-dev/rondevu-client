import { EventEmitter } from 'eventemitter3'
import { RondevuAPI } from '../api/client.js'
import { OffererConnection } from '../connections/offerer.js'
import { ConnectionConfig } from '../connections/config.js'
import { AsyncLock } from '../utils/async-lock.js'

export type OfferFactory = (pc: RTCPeerConnection) => Promise<{
    dc?: RTCDataChannel
    offer: RTCSessionDescriptionInit
}>

export interface OfferPoolOptions {
    api: RondevuAPI
    serviceFqn: string
    maxOffers: number
    offerFactory: OfferFactory
    ttl: number
    iceServers: RTCIceServer[]
    connectionConfig?: Partial<ConnectionConfig>
    debugEnabled?: boolean
}

interface OfferPoolEvents {
    'connection:opened': (offerId: string, connection: OffererConnection) => void
    'offer:created': (offerId: string, serviceFqn: string) => void
    'offer:failed': (offerId: string, error: Error) => void
    'connection:rotated': (oldOfferId: string, newOfferId: string, connection: OffererConnection) => void
}

/**
 * OfferPool manages a pool of WebRTC offers for a published service.
 * Maintains a target number of active offers and automatically replaces
 * offers that fail or get answered.
 */
export class OfferPool extends EventEmitter<OfferPoolEvents> {
    private readonly api: RondevuAPI
    private readonly serviceFqn: string
    private readonly maxOffers: number
    private readonly offerFactory: OfferFactory
    private readonly ttl: number
    private readonly iceServers: RTCIceServer[]
    private readonly connectionConfig?: Partial<ConnectionConfig>
    private readonly debugEnabled: boolean

    // State
    private readonly activeConnections = new Map<string, OffererConnection>()
    private readonly fillLock = new AsyncLock()
    private running = false
    private pollingInterval: ReturnType<typeof setInterval> | null = null
    private lastPollTimestamp = 0

    private static readonly POLLING_INTERVAL_MS = 1000

    constructor(options: OfferPoolOptions) {
        super()
        this.api = options.api
        this.serviceFqn = options.serviceFqn
        this.maxOffers = options.maxOffers
        this.offerFactory = options.offerFactory
        this.ttl = options.ttl
        this.iceServers = options.iceServers
        this.connectionConfig = options.connectionConfig
        this.debugEnabled = options.debugEnabled || false
    }

    /**
     * Start filling offers and polling for answers
     */
    async start(): Promise<void> {
        if (this.running) {
            this.debug('Already running')
            return
        }

        this.debug('Starting offer pool')
        this.running = true

        // Fill initial offers
        await this.fillOffers()

        // Start polling for answers
        this.pollingInterval = setInterval(() => {
            this.pollInternal()
        }, OfferPool.POLLING_INTERVAL_MS)
    }

    /**
     * Stop filling offers and polling
     * Closes all active connections
     */
    stop(): void {
        this.debug('Stopping offer pool')
        this.running = false

        // Stop polling
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval)
            this.pollingInterval = null
        }

        // Close all active connections
        for (const [offerId, connection] of this.activeConnections.entries()) {
            if (connection.isRotating()) {
                this.debug(`Connection ${offerId} is rotating, will close anyway`)
            }
            this.debug(`Closing connection ${offerId}`)
            connection.close()
        }

        this.activeConnections.clear()
    }

    /**
     * Get count of active offers
     */
    getOfferCount(): number {
        return this.activeConnections.size
    }

    /**
     * Get all active connections
     */
    getActiveConnections(): Map<string, OffererConnection> {
        return this.activeConnections
    }

    /**
     * Check if a specific offer is connected
     */
    isConnected(offerId: string): boolean {
        const connection = this.activeConnections.get(offerId)
        return connection ? connection.getState() === 'connected' : false
    }

    /**
     * Disconnect all active offers
     */
    disconnectAll(): void {
        this.debug('Disconnecting all offers')
        for (const [offerId, connection] of this.activeConnections.entries()) {
            this.debug(`Closing connection ${offerId}`)
            connection.close()
        }
        this.activeConnections.clear()
    }

    /**
     * Fill offers to reach maxOffers count
     * Uses AsyncLock to prevent concurrent fills
     */
    private async fillOffers(): Promise<void> {
        if (!this.running) return

        return this.fillLock.run(async () => {
            const currentCount = this.activeConnections.size
            const needed = this.maxOffers - currentCount

            this.debug(`Filling offers: current=${currentCount}, needed=${needed}`)

            for (let i = 0; i < needed; i++) {
                try {
                    await this.createOffer()
                } catch (err) {
                    console.error('[OfferPool] Failed to create offer:', err)
                }
            }
        })
    }

    /**
     * Create a new offer for rotation (reuses existing creation logic)
     * Similar to createOffer() but only creates the offer, doesn't create connection
     */
    private async createNewOfferForRotation(): Promise<{
        newOfferId: string
        pc: RTCPeerConnection
        dc?: RTCDataChannel
    }> {
        const rtcConfig: RTCConfiguration = {
            iceServers: this.iceServers
        }

        this.debug('Creating new offer for rotation...')

        // 1. Create RTCPeerConnection
        const pc = new RTCPeerConnection(rtcConfig)

        // 2. Call the factory to create offer
        let dc: RTCDataChannel | undefined
        let offer: RTCSessionDescriptionInit
        try {
            const factoryResult = await this.offerFactory(pc)
            dc = factoryResult.dc
            offer = factoryResult.offer
        } catch (err) {
            pc.close()
            throw err
        }

        // 3. Publish to server to get offerId
        const result = await this.api.publishService({
            serviceFqn: this.serviceFqn,
            offers: [{ sdp: offer.sdp! }],
            ttl: this.ttl,
            signature: '',
            message: '',
        })

        const newOfferId = result.offers[0].offerId

        this.debug(`New offer created for rotation: ${newOfferId}`)

        return { newOfferId, pc, dc }
    }

    /**
     * Create a single offer and publish it to the server
     */
    private async createOffer(): Promise<void> {
        const rtcConfig: RTCConfiguration = {
            iceServers: this.iceServers
        }

        this.debug('Creating new offer...')

        // 1. Create RTCPeerConnection
        const pc = new RTCPeerConnection(rtcConfig)

        // 2. Call the factory to create offer
        let dc: RTCDataChannel | undefined
        let offer: RTCSessionDescriptionInit
        try {
            const factoryResult = await this.offerFactory(pc)
            dc = factoryResult.dc
            offer = factoryResult.offer
        } catch (err) {
            pc.close()
            throw err
        }

        // 3. Publish to server to get offerId
        const result = await this.api.publishService({
            serviceFqn: this.serviceFqn,
            offers: [{ sdp: offer.sdp! }],
            ttl: this.ttl,
            signature: '',
            message: '',
        })

        const offerId = result.offers[0].offerId

        // 4. Create OffererConnection instance
        const connection = new OffererConnection({
            api: this.api,
            serviceFqn: this.serviceFqn,
            offerId,
            pc,
            dc,
            config: {
                ...this.connectionConfig,
                debug: this.debugEnabled,
            },
        })

        // Setup connection event handlers
        connection.on('connected', () => {
            this.debug(`Connection established for offer ${offerId}`)
            this.emit('connection:opened', offerId, connection)
        })

        connection.on('failed', async (error) => {
            const currentOfferId = connection.getOfferId()
            this.debug(`Connection failed for offer ${currentOfferId}, rotating...`)

            try {
                // Create new offer and rebind existing connection
                const { newOfferId, pc, dc } = await this.createNewOfferForRotation()

                // Rebind the connection to new offer
                await connection.rebindToOffer(newOfferId, pc, dc)

                // Update map: remove old offerId, add new offerId with same connection
                this.activeConnections.delete(currentOfferId)
                this.activeConnections.set(newOfferId, connection)

                this.emit('connection:rotated', currentOfferId, newOfferId, connection)
                this.debug(`Connection rotated: ${currentOfferId} → ${newOfferId}`)

            } catch (rotationError) {
                // If rotation fails, fall back to destroying connection
                this.debug(`Rotation failed for ${currentOfferId}:`, rotationError)
                this.activeConnections.delete(currentOfferId)
                this.emit('offer:failed', currentOfferId, error)
                this.fillOffers()  // Create replacement
            }
        })

        connection.on('closed', () => {
            this.debug(`Connection closed for offer ${offerId}`)
            this.activeConnections.delete(offerId)
            this.fillOffers()  // Replace closed offer
        })

        // Store active connection
        this.activeConnections.set(offerId, connection)

        // Initialize the connection
        await connection.initialize()

        this.debug(`Offer created: ${offerId}`)
        this.emit('offer:created', offerId, this.serviceFqn)
    }

    /**
     * Poll for answers and delegate to OffererConnections
     */
    private async pollInternal(): Promise<void> {
        if (!this.running) return

        try {
            const result = await this.api.poll(this.lastPollTimestamp)

            // Process answers - delegate to OffererConnections
            for (const answer of result.answers) {
                const connection = this.activeConnections.get(answer.offerId)
                if (connection) {
                    try {
                        await connection.processAnswer(answer.sdp, answer.answererId)
                        this.lastPollTimestamp = Math.max(this.lastPollTimestamp, answer.answeredAt)

                        // Create replacement offer
                        this.fillOffers()
                    } catch (err) {
                        this.debug(`Failed to process answer for offer ${answer.offerId}:`, err)
                    }
                }
            }
        } catch (err) {
            console.error('[OfferPool] Polling error:', err)
        }
    }

    /**
     * Debug logging (only if debug enabled)
     */
    private debug(...args: unknown[]): void {
        if (this.debugEnabled) {
            console.log('[OfferPool]', ...args)
        }
    }
}
