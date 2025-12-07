import { WebRTCRondevuConnection } from './connection.js'
import { WebRTCContext } from './webrtc-context.js'
import { RondevuService } from './rondevu-service.js'
import { RondevuSignaler } from './signaler.js'
import { EventBus } from './event-bus.js'
import { createBin } from './bin.js'
import { ConnectionInterface } from './types.js'

export interface ServiceClientOptions {
    username: string
    serviceFqn: string
    rondevuService: RondevuService
    autoReconnect?: boolean
    reconnectDelay?: number
    maxReconnectAttempts?: number
    rtcConfiguration?: RTCConfiguration
}

export interface ServiceClientEvents {
    connected: ConnectionInterface
    disconnected: { reason: string }
    reconnecting: { attempt: number; maxAttempts: number }
    error: Error
}

/**
 * ServiceClient - Connects to a hosted service
 *
 * Searches for available service offers and establishes a WebRTC connection.
 * Optionally supports automatic reconnection on failure.
 *
 * @example
 * ```typescript
 * const rondevuService = new RondevuService({
 *   apiUrl: 'https://signal.example.com',
 *   username: 'client-user',
 * })
 *
 * await rondevuService.initialize()
 *
 * const client = new ServiceClient({
 *   username: 'host-user',
 *   serviceFqn: 'chat.app@1.0.0',
 *   rondevuService,
 *   autoReconnect: true,
 * })
 *
 * await client.connect()
 *
 * client.events.on('connected', (conn) => {
 *   console.log('Connected to service')
 *   conn.sendMessage('Hello!')
 * })
 * ```
 */
export class ServiceClient {
    private readonly username: string
    private readonly serviceFqn: string
    private readonly rondevuService: RondevuService
    private readonly autoReconnect: boolean
    private readonly reconnectDelay: number
    private readonly maxReconnectAttempts: number
    private readonly rtcConfiguration?: RTCConfiguration
    private connection: WebRTCRondevuConnection | null = null
    private reconnectAttempts = 0
    private reconnectTimeout: ReturnType<typeof setTimeout> | null = null
    private readonly bin = createBin()
    private isConnecting = false

    public readonly events = new EventBus<ServiceClientEvents>()

    constructor(options: ServiceClientOptions) {
        this.username = options.username
        this.serviceFqn = options.serviceFqn
        this.rondevuService = options.rondevuService
        this.autoReconnect = options.autoReconnect !== false
        this.reconnectDelay = options.reconnectDelay || 2000
        this.maxReconnectAttempts = options.maxReconnectAttempts || 5
        this.rtcConfiguration = options.rtcConfiguration
    }

    /**
     * Connect to the service
     */
    async connect(): Promise<WebRTCRondevuConnection> {
        if (this.isConnecting) {
            throw new Error('Already connecting')
        }

        if (this.connection && this.connection.state === 'connected') {
            return this.connection
        }

        this.isConnecting = true

        try {
            // Search for available services
            const services = await this.rondevuService
                .getAPI()
                .searchServices(this.username, this.serviceFqn)

            if (services.length === 0) {
                throw new Error(`No services found for ${this.username}/${this.serviceFqn}`)
            }

            // Get the first available service
            const service = services[0]

            // Get service details including SDP
            const serviceDetails = await this.rondevuService.getAPI().getService(service.uuid)

            // Create WebRTC context with signaler for this offer
            const signaler = new RondevuSignaler(
                this.rondevuService.getAPI(),
                serviceDetails.offerId
            )
            const context = new WebRTCContext(signaler, this.rtcConfiguration)

            // Create connection (answerer role)
            const conn = new WebRTCRondevuConnection({
                id: `client-${this.serviceFqn}-${Date.now()}`,
                service: this.serviceFqn,
                offer: {
                    type: 'offer',
                    sdp: serviceDetails.sdp,
                },
                context,
            })

            // Wait for answer to be created
            await conn.ready

            // Get answer SDP
            if (!conn.connection?.localDescription?.sdp) {
                throw new Error('Failed to create answer SDP')
            }

            const answerSdp = conn.connection.localDescription.sdp

            // Send answer to server
            await this.rondevuService.getAPI().answerOffer(serviceDetails.offerId, answerSdp)

            // Track connection
            this.connection = conn
            this.reconnectAttempts = 0

            // Listen for state changes
            const cleanup = conn.events.on('state-change', state => {
                this.handleConnectionStateChange(state)
            })
            this.bin(cleanup)

            this.isConnecting = false

            // Emit connected event when actually connected
            if (conn.state === 'connected') {
                this.events.emit('connected', conn)
            }

            return conn
        } catch (error) {
            this.isConnecting = false
            this.events.emit('error', error as Error)
            throw error
        }
    }

    /**
     * Disconnect from the service
     */
    disconnect(): void {
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout)
            this.reconnectTimeout = null
        }

        if (this.connection) {
            this.connection.disconnect()
            this.connection = null
        }

        this.bin.clean()
        this.reconnectAttempts = 0
    }

    /**
     * Get the current connection
     */
    getConnection(): WebRTCRondevuConnection | null {
        return this.connection
    }

    /**
     * Check if currently connected
     */
    isConnected(): boolean {
        return this.connection?.state === 'connected'
    }

    /**
     * Handle connection state changes
     */
    private handleConnectionStateChange(state: ConnectionInterface['state']): void {
        if (state === 'connected') {
            this.events.emit('connected', this.connection!)
            this.reconnectAttempts = 0
        } else if (state === 'disconnected') {
            this.events.emit('disconnected', { reason: 'Connection closed' })

            // Attempt reconnection if enabled
            if (this.autoReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
                this.scheduleReconnect()
            }
        }
    }

    /**
     * Schedule a reconnection attempt
     */
    private scheduleReconnect(): void {
        if (this.reconnectTimeout) {
            return
        }

        this.reconnectAttempts++

        this.events.emit('reconnecting', {
            attempt: this.reconnectAttempts,
            maxAttempts: this.maxReconnectAttempts,
        })

        // Exponential backoff
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1)

        this.reconnectTimeout = setTimeout(() => {
            this.reconnectTimeout = null
            this.connect().catch(error => {
                this.events.emit('error', error as Error)

                // Schedule next attempt if we haven't exceeded max attempts
                if (this.reconnectAttempts < this.maxReconnectAttempts) {
                    this.scheduleReconnect()
                }
            })
        }, delay)
    }
}
