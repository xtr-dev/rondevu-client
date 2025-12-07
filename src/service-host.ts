import { WebRTCRondevuConnection } from './connection.js'
import { WebRTCContext } from './webrtc-context.js'
import { RondevuService } from './rondevu-service.js'
import { RondevuSignaler } from './signaler.js'
import { NoOpSignaler } from './noop-signaler.js'
import { EventBus } from './event-bus.js'
import { createBin } from './bin.js'
import { ConnectionInterface } from './types.js'

export interface ServiceHostOptions {
    service: string
    rondevuService: RondevuService
    maxPeers?: number
    ttl?: number
    isPublic?: boolean
    metadata?: Record<string, any>
}

export interface ServiceHostEvents {
    connection: ConnectionInterface
    'connection-closed': { connectionId: string; reason: string }
    error: Error
}

/**
 * ServiceHost - Manages a pool of WebRTC offers for a service
 *
 * Maintains up to maxPeers concurrent offers, automatically replacing
 * them when connections are established or expire.
 *
 * @example
 * ```typescript
 * const rondevuService = new RondevuService({
 *   apiUrl: 'https://signal.example.com',
 *   username: 'myusername',
 * })
 *
 * await rondevuService.initialize()
 * await rondevuService.claimUsername()
 *
 * const host = new ServiceHost({
 *   service: 'chat.app@1.0.0',
 *   rondevuService,
 *   maxPeers: 5,
 * })
 *
 * await host.start()
 *
 * host.events.on('connection', (conn) => {
 *   console.log('New connection:', conn.id)
 *   conn.events.on('message', (msg) => {
 *     console.log('Message:', msg)
 *   })
 * })
 * ```
 */
export class ServiceHost {
    private connections = new Map<string, WebRTCRondevuConnection>()
    private readonly service: string
    private readonly rondevuService: RondevuService
    private readonly maxPeers: number
    private readonly ttl: number
    private readonly isPublic: boolean
    private readonly metadata?: Record<string, any>
    private readonly bin = createBin()
    private isStarted = false

    public readonly events = new EventBus<ServiceHostEvents>()

    constructor(options: ServiceHostOptions) {
        this.service = options.service
        this.rondevuService = options.rondevuService
        this.maxPeers = options.maxPeers || 20
        this.ttl = options.ttl || 300000
        this.isPublic = options.isPublic !== false
        this.metadata = options.metadata
    }

    /**
     * Start hosting the service - creates initial pool of offers
     */
    async start(): Promise<void> {
        if (this.isStarted) {
            throw new Error('ServiceHost already started')
        }

        this.isStarted = true
        await this.fillOfferPool()
    }

    /**
     * Stop hosting - closes all connections and cleans up
     */
    stop(): void {
        this.isStarted = false
        this.connections.forEach(conn => conn.disconnect())
        this.connections.clear()
        this.bin.clean()
    }

    /**
     * Get current number of active connections
     */
    getConnectionCount(): number {
        return Array.from(this.connections.values()).filter(conn => conn.state === 'connected')
            .length
    }

    /**
     * Get current number of pending offers
     */
    getPendingOfferCount(): number {
        return Array.from(this.connections.values()).filter(conn => conn.state === 'connecting')
            .length
    }

    /**
     * Fill the offer pool up to maxPeers
     */
    private async fillOfferPool(): Promise<void> {
        const currentOffers = this.connections.size
        const needed = this.maxPeers - currentOffers

        if (needed <= 0) {
            return
        }

        // Create multiple offers in parallel
        const offerPromises: Promise<void>[] = []
        for (let i = 0; i < needed; i++) {
            offerPromises.push(this.createOffer())
        }

        await Promise.allSettled(offerPromises)
    }

    /**
     * Create a single offer and publish it
     */
    private async createOffer(): Promise<void> {
        try {
            // Create temporary context with NoOp signaler
            const tempContext = new WebRTCContext(new NoOpSignaler())

            // Create connection (offerer role)
            const conn = new WebRTCRondevuConnection({
                id: `${this.service}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
                service: this.service,
                offer: null,
                context: tempContext,
            })

            // Wait for offer to be created
            await conn.ready

            // Get offer SDP
            if (!conn.connection?.localDescription?.sdp) {
                throw new Error('Failed to create offer SDP')
            }

            const sdp = conn.connection.localDescription.sdp

            // Publish service offer
            const service = await this.rondevuService.publishService({
                serviceFqn: this.service,
                sdp,
                ttl: this.ttl,
                isPublic: this.isPublic,
                metadata: this.metadata,
            })

            // Replace with real signaler now that we have offerId
            const realSignaler = new RondevuSignaler(this.rondevuService.getAPI(), service.offerId)
            ;(tempContext as any).signaler = realSignaler

            // Track connection
            this.connections.set(conn.id, conn)

            // Listen for state changes
            const cleanup = conn.events.on('state-change', state => {
                this.handleConnectionStateChange(conn, state)
            })

            this.bin(cleanup)
        } catch (error) {
            this.events.emit('error', error as Error)
        }
    }

    /**
     * Handle connection state changes
     */
    private handleConnectionStateChange(
        conn: WebRTCRondevuConnection,
        state: ConnectionInterface['state']
    ): void {
        if (state === 'connected') {
            // Connection established - emit event
            this.events.emit('connection', conn)

            // Create new offer to replace this one
            if (this.isStarted) {
                this.fillOfferPool().catch(error => {
                    this.events.emit('error', error as Error)
                })
            }
        } else if (state === 'disconnected') {
            // Connection closed - remove and create new offer
            this.connections.delete(conn.id)
            this.events.emit('connection-closed', {
                connectionId: conn.id,
                reason: state,
            })

            if (this.isStarted) {
                this.fillOfferPool().catch(error => {
                    this.events.emit('error', error as Error)
                })
            }
        }
    }

    /**
     * Get all active connections
     */
    getConnections(): WebRTCRondevuConnection[] {
        return Array.from(this.connections.values())
    }

    /**
     * Get a specific connection by ID
     */
    getConnection(connectionId: string): WebRTCRondevuConnection | undefined {
        return this.connections.get(connectionId)
    }
}
