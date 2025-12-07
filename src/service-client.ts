import { RondevuService } from './rondevu-service.js'
import { RondevuSignaler } from './rondevu-signaler.js'
import { WebRTCContext } from './webrtc-context.js'
import { RTCDurableConnection } from './durable-connection.js'
import { EventBus } from './event-bus.js'

export interface ServiceClientOptions {
    username: string                     // Host username
    serviceFqn: string                  // e.g., 'chat.app@1.0.0'
    rondevuService: RondevuService
    autoReconnect?: boolean             // Default: true
    maxReconnectAttempts?: number       // Default: 5
    rtcConfiguration?: RTCConfiguration
}

export interface ServiceClientEvents {
    connected: RTCDurableConnection
    disconnected: void
    reconnecting: { attempt: number; maxAttempts: number }
    error: Error
}

/**
 * ServiceClient - High-level wrapper for connecting to a WebRTC service
 *
 * Simplifies client connection by handling:
 * - Service discovery
 * - Offer/answer exchange
 * - ICE candidate polling
 * - Automatic reconnection
 *
 * @example
 * ```typescript
 * const client = new ServiceClient({
 *     username: 'host-user',
 *     serviceFqn: 'chat.app@1.0.0',
 *     rondevuService: myService
 * })
 *
 * client.events.on('connected', conn => {
 *     conn.events.on('message', msg => console.log('Received:', msg))
 *     conn.sendMessage('Hello from client!')
 * })
 *
 * await client.connect()
 * ```
 */
export class ServiceClient {
    events: EventBus<ServiceClientEvents>

    private signaler: RondevuSignaler | null = null
    private webrtcContext: WebRTCContext
    private connection: RTCDurableConnection | null = null
    private autoReconnect: boolean
    private maxReconnectAttempts: number
    private reconnectAttempts = 0
    private isConnecting = false

    constructor(private options: ServiceClientOptions) {
        this.events = new EventBus<ServiceClientEvents>()
        this.webrtcContext = new WebRTCContext(options.rtcConfiguration)
        this.autoReconnect = options.autoReconnect !== undefined ? options.autoReconnect : true
        this.maxReconnectAttempts = options.maxReconnectAttempts || 5
    }

    /**
     * Connect to the service
     */
    async connect(): Promise<RTCDurableConnection> {
        if (this.isConnecting) {
            throw new Error('Connection already in progress')
        }

        if (this.connection) {
            throw new Error('Already connected. Disconnect first.')
        }

        this.isConnecting = true

        try {
            // Create signaler
            this.signaler = new RondevuSignaler(
                this.options.rondevuService,
                this.options.serviceFqn,
                this.options.username
            )

            // Wait for remote offer from signaler
            const remoteOffer = await new Promise<RTCSessionDescriptionInit>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Service discovery timeout'))
                }, 30000)

                this.signaler!.addOfferListener((offer) => {
                    clearTimeout(timeout)
                    resolve(offer)
                })
            })

            // Create connection with remote offer (makes us the answerer)
            const connection = new RTCDurableConnection({
                context: this.webrtcContext,
                signaler: this.signaler,
                offer: remoteOffer
            })

            // Wait for connection to be ready
            await connection.ready

            // Set up connection event listeners
            connection.events.on('state-change', (state) => {
                if (state === 'connected') {
                    this.reconnectAttempts = 0
                    this.events.emit('connected', connection)
                } else if (state === 'disconnected') {
                    this.events.emit('disconnected', undefined)
                    if (this.autoReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
                        this.attemptReconnect()
                    }
                }
            })

            this.connection = connection
            this.isConnecting = false

            return connection

        } catch (err) {
            this.isConnecting = false
            const error = err instanceof Error ? err : new Error(String(err))
            this.events.emit('error', error)
            throw error
        }
    }

    /**
     * Disconnect from the service
     */
    dispose(): void {
        if (this.signaler) {
            this.signaler.dispose()
            this.signaler = null
        }

        if (this.connection) {
            this.connection.disconnect()
            this.connection = null
        }

        this.isConnecting = false
        this.reconnectAttempts = 0
    }

    /**
     * @deprecated Use dispose() instead
     */
    disconnect(): void {
        this.dispose()
    }

    /**
     * Attempt to reconnect
     */
    private async attemptReconnect(): Promise<void> {
        this.reconnectAttempts++
        this.events.emit('reconnecting', {
            attempt: this.reconnectAttempts,
            maxAttempts: this.maxReconnectAttempts
        })

        // Cleanup old connection
        if (this.signaler) {
            this.signaler.dispose()
            this.signaler = null
        }

        if (this.connection) {
            this.connection = null
        }

        // Wait a bit before reconnecting
        await new Promise(resolve => setTimeout(resolve, 1000 * this.reconnectAttempts))

        try {
            await this.connect()
        } catch (err) {
            console.error('Reconnection attempt failed:', err)
            if (this.reconnectAttempts < this.maxReconnectAttempts) {
                this.attemptReconnect()
            } else {
                const error = new Error('Max reconnection attempts reached')
                this.events.emit('error', error)
            }
        }
    }

    /**
     * Get the current connection
     */
    getConnection(): RTCDurableConnection | null {
        return this.connection
    }
}
