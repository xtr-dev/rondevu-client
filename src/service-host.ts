import { RondevuService } from './rondevu-service.js'
import { RondevuSignaler } from './rondevu-signaler.js'
import { WebRTCContext } from './webrtc-context.js'
import { RTCDurableConnection } from './durable-connection.js'
import { EventBus } from './event-bus.js'

export interface ServiceHostOptions {
    service: string                      // e.g., 'chat.app@1.0.0'
    rondevuService: RondevuService
    maxPeers?: number                    // Default: 5
    ttl?: number                         // Default: 300000 (5 min)
    isPublic?: boolean                   // Default: true
    rtcConfiguration?: RTCConfiguration
    metadata?: Record<string, any>
}

export interface ServiceHostEvents {
    connection: RTCDurableConnection
    error: Error
}

/**
 * ServiceHost - High-level wrapper for hosting a WebRTC service
 *
 * Simplifies hosting by handling:
 * - Offer/answer exchange
 * - ICE candidate polling
 * - Connection pool management
 * - Automatic reconnection
 *
 * @example
 * ```typescript
 * const host = new ServiceHost({
 *     service: 'chat.app@1.0.0',
 *     rondevuService: myService,
 *     maxPeers: 5
 * })
 *
 * host.events.on('connection', conn => {
 *     conn.events.on('message', msg => console.log('Received:', msg))
 *     conn.sendMessage('Hello!')
 * })
 *
 * await host.start()
 * ```
 */
export class ServiceHost {
    events: EventBus<ServiceHostEvents>

    private signaler: RondevuSignaler | null = null
    private webrtcContext: WebRTCContext
    private connections: RTCDurableConnection[] = []
    private maxPeers: number
    private running = false

    constructor(private options: ServiceHostOptions) {
        this.events = new EventBus<ServiceHostEvents>()
        this.webrtcContext = new WebRTCContext(options.rtcConfiguration)
        this.maxPeers = options.maxPeers || 5
    }

    /**
     * Start hosting the service
     */
    async start(): Promise<void> {
        if (this.running) {
            throw new Error('ServiceHost already running')
        }

        this.running = true

        // Create signaler
        this.signaler = new RondevuSignaler(
            this.options.rondevuService,
            this.options.service
        )

        // Create first connection (offerer)
        const connection = new RTCDurableConnection({
            context: this.webrtcContext,
            signaler: this.signaler,
            offer: null  // null means we're the offerer
        })

        // Wait for connection to be ready
        await connection.ready

        // Set up connection event listeners
        connection.events.on('state-change', (state) => {
            if (state === 'connected') {
                this.connections.push(connection)
                this.events.emit('connection', connection)

                // Create next connection if under maxPeers
                if (this.connections.length < this.maxPeers) {
                    this.createNextConnection().catch(err => {
                        console.error('Failed to create next connection:', err)
                        this.events.emit('error', err)
                    })
                }
            } else if (state === 'disconnected') {
                // Remove from connections list
                const index = this.connections.indexOf(connection)
                if (index > -1) {
                    this.connections.splice(index, 1)
                }
            }
        })

        // Publish service with the offer
        const offer = connection.connection?.localDescription
        if (!offer?.sdp) {
            throw new Error('Offer SDP is empty')
        }

        await this.signaler.setOffer(offer)
    }

    /**
     * Create the next connection for incoming peers
     */
    private async createNextConnection(): Promise<void> {
        if (!this.signaler || !this.running) {
            return
        }

        // For now, we'll use the same offer for all connections
        // In a production scenario, you'd create multiple offers
        // This is a limitation of the current service model
        // which publishes one offer per service
    }

    /**
     * Stop hosting the service
     */
    dispose(): void {
        this.running = false

        // Cleanup signaler
        if (this.signaler) {
            this.signaler.dispose()
            this.signaler = null
        }

        // Disconnect all connections
        for (const conn of this.connections) {
            conn.disconnect()
        }
        this.connections = []
    }

    /**
     * Get all active connections
     */
    getConnections(): RTCDurableConnection[] {
        return [...this.connections]
    }
}
