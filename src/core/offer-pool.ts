import { EventEmitter } from 'eventemitter3'
import { RondevuAPI, IceCandidate } from '../api/client.js'
import { OffererConnection } from '../connections/offerer.js'
import { ConnectionConfig } from '../connections/config.js'
import { AsyncLock } from '../utils/async-lock.js'
import { WebRTCAdapter } from '../webrtc/adapter.js'
import type { PollAnswerEvent, PollIceEvent } from './polling-manager.js'

export type OfferFactory = (pc: RTCPeerConnection) => Promise<{
    dc?: RTCDataChannel
    offer: RTCSessionDescriptionInit
}>

export interface OfferPoolOptions {
    api: RondevuAPI
    tags: string[]
    ownerUsername: string
    maxOffers: number
    offerFactory: OfferFactory
    ttl: number
    iceServers: RTCIceServer[]
    iceTransportPolicy?: RTCIceTransportPolicy
    webrtcAdapter: WebRTCAdapter
    connectionConfig?: Partial<ConnectionConfig>
    debugEnabled?: boolean
}

interface OfferPoolEvents {
    'connection:opened': (
        offerId: string,
        connection: OffererConnection,
        matchedTags?: string[]
    ) => void
    'offer:created': (offerId: string, tags: string[]) => void
    'offer:failed': (offerId: string, error: Error) => void
    'connection:rotated': (
        oldOfferId: string,
        newOfferId: string,
        connection: OffererConnection
    ) => void
}

/**
 * OfferPool manages a pool of WebRTC offers for published tags.
 * Maintains a target number of active offers and automatically replaces
 * offers that fail or get answered.
 */
export class OfferPool extends EventEmitter<OfferPoolEvents> {
    private readonly api: RondevuAPI
    private tags: string[]
    private readonly ownerUsername: string
    private readonly maxOffers: number
    private readonly offerFactory: OfferFactory
    private readonly ttl: number
    private readonly iceServers: RTCIceServer[]
    private readonly iceTransportPolicy?: RTCIceTransportPolicy
    private readonly webrtcAdapter: WebRTCAdapter
    private readonly connectionConfig?: Partial<ConnectionConfig>
    private readonly debugEnabled: boolean

    // State
    private readonly activeConnections = new Map<string, OffererConnection>()
    private readonly matchedTagsByOffer = new Map<string, string[]>() // Track matchedTags from answers
    private readonly fillLock = new AsyncLock()
    private running = false

    constructor(options: OfferPoolOptions) {
        super()
        this.api = options.api
        this.tags = options.tags
        this.ownerUsername = options.ownerUsername
        this.webrtcAdapter = options.webrtcAdapter
        this.maxOffers = options.maxOffers
        this.offerFactory = options.offerFactory
        this.ttl = options.ttl
        this.iceServers = options.iceServers
        this.iceTransportPolicy = options.iceTransportPolicy
        this.connectionConfig = options.connectionConfig
        this.debugEnabled = options.debugEnabled || false
    }

    /**
     * Start filling offers
     * Polling is managed externally by Rondevu's PollingManager
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
    }

    /**
     * Stop filling offers
     * Closes all active connections
     */
    stop(): void {
        this.debug('Stopping offer pool')
        this.running = false

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
     * Update tags for new offers
     * Existing offers keep their old tags until they expire/rotate
     * New offers created during fill will use the updated tags
     */
    updateTags(newTags: string[]): void {
        this.debug(`Updating tags: ${newTags.join(', ')}`)
        this.tags = newTags
    }

    /**
     * Get current tags
     */
    getTags(): string[] {
        return [...this.tags]
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
     * Create and publish an offer to the server.
     * Shared logic used by both createOffer() and createNewOfferForRotation().
     *
     * @returns The offer ID, RTCPeerConnection, and optional data channel
     */
    private async createOfferAndPublish(): Promise<{
        offerId: string
        pc: RTCPeerConnection
        dc?: RTCDataChannel
    }> {
        const rtcConfig: RTCConfiguration = {
            iceServers: this.iceServers,
            iceTransportPolicy: this.iceTransportPolicy,
        }

        // 1. Create RTCPeerConnection using adapter
        const pc = this.webrtcAdapter.createPeerConnection(rtcConfig)

        // Collect ICE candidates during offer creation
        // We need to set this up BEFORE setLocalDescription is called
        const collectedCandidates: RTCIceCandidateInit[] = []
        pc.onicecandidate = event => {
            if (event.candidate) {
                collectedCandidates.push({
                    candidate: event.candidate.candidate,
                    sdpMLineIndex: event.candidate.sdpMLineIndex,
                    sdpMid: event.candidate.sdpMid,
                })
            }
        }

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
        const result = await this.api.publish({
            tags: this.tags,
            offers: [{ sdp: offer.sdp! }],
            ttl: this.ttl,
        })

        const offerId = result.offers[0].offerId

        // 4. Send any ICE candidates we've already collected
        if (collectedCandidates.length > 0) {
            this.debug(
                `Sending ${collectedCandidates.length} early ICE candidates for offer ${offerId}`
            )
            this.api.addOfferIceCandidates(offerId, collectedCandidates).catch(err => {
                this.debug('Failed to send early ICE candidates:', err)
            })
        }

        return { offerId, pc, dc }
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
        this.debug('Creating new offer for rotation...')
        const { offerId, pc, dc } = await this.createOfferAndPublish()
        this.debug(`New offer created for rotation: ${offerId}`)
        return { newOfferId: offerId, pc, dc }
    }

    /**
     * Create a single offer and publish it to the server
     */
    private async createOffer(): Promise<void> {
        this.debug('Creating new offer...')
        const { offerId, pc, dc } = await this.createOfferAndPublish()

        // Create OffererConnection instance
        const connection = new OffererConnection({
            api: this.api,
            ownerUsername: this.ownerUsername,
            offerId,
            pc,
            dc,
            webrtcAdapter: this.webrtcAdapter,
            config: {
                ...this.connectionConfig,
                debug: this.debugEnabled,
            },
        })

        // Setup connection event handlers
        connection.on('connected', () => {
            // Use getOfferId() to get current ID after potential rotations
            const currentOfferId = connection.getOfferId()
            this.debug(`Connection established for offer ${currentOfferId}`)

            // Get and clean up matchedTags
            const matchedTags = this.matchedTagsByOffer.get(currentOfferId)
            this.matchedTagsByOffer.delete(currentOfferId)

            this.emit('connection:opened', currentOfferId, connection, matchedTags)
        })

        connection.on('failed', async error => {
            const currentOfferId = connection.getOfferId()
            this.debug(`Connection failed for offer ${currentOfferId}`)

            // Double-check connection state before rotating
            // (polling events may have already recovered the connection)
            if (connection.getState() !== 'failed') {
                this.debug(`Connection ${currentOfferId} recovered, skipping rotation`)
                return
            }

            this.debug(`Proceeding with rotation for offer ${currentOfferId}`)

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
                this.fillOffers() // Create replacement
            }
        })

        connection.on('closed', () => {
            this.debug(`Connection closed for offer ${offerId}`)
            this.activeConnections.delete(offerId)
            this.fillOffers() // Replace closed offer
        })

        // Store active connection
        this.activeConnections.set(offerId, connection)

        // Initialize the connection
        await connection.initialize()

        this.debug(`Offer created: ${offerId}`)
        this.emit('offer:created', offerId, this.tags)
    }

    /**
     * Handle poll:answer event from PollingManager
     * Called by Rondevu when a poll:answer event is received
     */
    async handlePollAnswer(data: PollAnswerEvent): Promise<void> {
        if (!this.running) return

        const connection = this.activeConnections.get(data.offerId)
        if (connection) {
            this.debug(`Processing answer for offer ${data.offerId}`)

            // Store matchedTags for when connection opens
            if (data.matchedTags) {
                this.matchedTagsByOffer.set(data.offerId, data.matchedTags)
            }

            try {
                await connection.processAnswer(data.sdp, data.answererId)

                // Create replacement offer
                this.fillOffers()
            } catch (err) {
                this.debug(`Failed to process answer for offer ${data.offerId}:`, err)
            }
        }
        // Silently ignore answers for offers we don't have - they may be for other connections
    }

    /**
     * Handle poll:ice event from PollingManager
     * Called by Rondevu when a poll:ice event is received
     */
    handlePollIce(data: PollIceEvent): void {
        if (!this.running) return

        const connection = this.activeConnections.get(data.offerId)
        if (connection) {
            this.debug(
                `Processing ${data.candidates.length} ICE candidates for offer ${data.offerId}`
            )
            connection.handleRemoteIceCandidates(data.candidates)
        }
        // Silently ignore ICE candidates for offers we don't have
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
