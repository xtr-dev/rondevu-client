import { RondevuAPI, Credential, IceCandidate } from '../api/client.js'
import { CryptoAdapter } from '../crypto/adapter.js'
import { EventEmitter } from 'eventemitter3'
import { OffererConnection } from '../connections/offerer.js'
import { AnswererConnection } from '../connections/answerer.js'
import { ConnectionConfig } from '../connections/config.js'
import { OfferPool } from './offer-pool.js'

// ICE server preset names
export type IceServerPreset = 'ipv4-turn' | 'hostname-turns' | 'google-stun' | 'relay-only'

// ICE server presets
export const ICE_SERVER_PRESETS: Record<IceServerPreset, RTCIceServer[]> = {
    'ipv4-turn': [
        { urls: 'stun:57.129.61.67:3478' },
        {
            urls: [
                'turn:57.129.61.67:3478?transport=tcp',
                'turn:57.129.61.67:3478?transport=udp',
            ],
            username: 'webrtcuser',
            credential: 'supersecretpassword'
        }
    ],
    'hostname-turns': [
        { urls: 'stun:turn.share.fish:3478' },
        {
            urls: [
                'turns:turn.share.fish:5349?transport=tcp',
                'turns:turn.share.fish:5349?transport=udp',
                'turn:turn.share.fish:3478?transport=tcp',
                'turn:turn.share.fish:3478?transport=udp',
            ],
            username: 'webrtcuser',
            credential: 'supersecretpassword'
        }
    ],
    'google-stun': [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ],
    'relay-only': [
        { urls: 'stun:57.129.61.67:3478' },
        {
            urls: [
                'turn:57.129.61.67:3478?transport=tcp',
                'turn:57.129.61.67:3478?transport=udp',
            ],
            username: 'webrtcuser',
            credential: 'supersecretpassword',
            // @ts-expect-error - iceTransportPolicy is valid but not in RTCIceServer type
            iceTransportPolicy: 'relay'
        }
    ]
}

export interface RondevuOptions {
    apiUrl: string
    credential?: Credential  // Optional, will generate if not provided
    cryptoAdapter?: CryptoAdapter  // Optional, defaults to WebCryptoAdapter
    iceServers?: IceServerPreset | RTCIceServer[]  // Optional: preset name or custom STUN/TURN servers
    debug?: boolean  // Optional: enable debug logging (default: false)
    // WebRTC polyfills for Node.js environments (e.g., wrtc)
    rtcPeerConnection?: typeof RTCPeerConnection
    rtcIceCandidate?: typeof RTCIceCandidate
}

export interface OfferContext {
    dc?: RTCDataChannel
    offer: RTCSessionDescriptionInit
}

/**
 * Factory function for creating WebRTC offers.
 * Rondevu creates the RTCPeerConnection and passes it to the factory,
 * allowing ICE candidate handlers to be set up before setLocalDescription() is called.
 *
 * @param pc - The RTCPeerConnection created by Rondevu (already configured with ICE servers)
 * @returns Promise containing the data channel (optional) and offer SDP
 */
export type OfferFactory = (pc: RTCPeerConnection) => Promise<OfferContext>

export interface PublishServiceOptions {
    service: string // Service name and version (e.g., "chat:2.0.0") - username will be auto-appended
    maxOffers: number  // Maximum number of concurrent offers to maintain
    offerFactory?: OfferFactory  // Optional: custom offer creation (defaults to simple data channel)
    ttl?: number  // Time-to-live for offers in milliseconds (default: 300000)
    connectionConfig?: Partial<ConnectionConfig>  // Optional: connection durability configuration
}

export interface ConnectionContext {
    pc: RTCPeerConnection
    dc: RTCDataChannel
    serviceFqn: string
    offerId: string
    peerUsername: string
}

export interface ConnectToServiceOptions {
    serviceFqn?: string  // Full FQN like 'chat:2.0.0@alice'
    service?: string     // Service without username (for discovery)
    username?: string    // Target username (combined with service)
    rtcConfig?: RTCConfiguration  // Optional: override default ICE servers
    connectionConfig?: Partial<ConnectionConfig>  // Optional: connection durability configuration
}

export interface ActiveOffer {
    offerId: string
    serviceFqn: string
    pc: RTCPeerConnection
    dc?: RTCDataChannel
    answered: boolean
    createdAt: number
}

export interface FindServiceOptions {
    mode?: 'direct' | 'random' | 'paginated'  // Default: 'direct' if serviceFqn has username, 'random' otherwise
    limit?: number  // For paginated mode (default: 10)
    offset?: number  // For paginated mode (default: 0)
}

export interface ServiceResult {
    serviceId: string
    username: string
    serviceFqn: string
    offerId: string
    sdp: string
    createdAt: number
    expiresAt: number
}

export interface PaginatedServiceResult {
    services: ServiceResult[]
    count: number
    limit: number
    offset: number
}

/**
 * Base error class for Rondevu errors
 */
export class RondevuError extends Error {
    constructor(message: string, public context?: Record<string, any>) {
        super(message)
        this.name = 'RondevuError'
        Object.setPrototypeOf(this, RondevuError.prototype)
    }
}

/**
 * Network-related errors (API calls, connectivity)
 */
export class NetworkError extends RondevuError {
    constructor(message: string, context?: Record<string, any>) {
        super(message, context)
        this.name = 'NetworkError'
        Object.setPrototypeOf(this, NetworkError.prototype)
    }
}

/**
 * Validation errors (invalid input, malformed data)
 */
export class ValidationError extends RondevuError {
    constructor(message: string, context?: Record<string, any>) {
        super(message, context)
        this.name = 'ValidationError'
        Object.setPrototypeOf(this, ValidationError.prototype)
    }
}

/**
 * WebRTC connection errors (peer connection failures, ICE issues)
 */
export class ConnectionError extends RondevuError {
    constructor(message: string, context?: Record<string, any>) {
        super(message, context)
        this.name = 'ConnectionError'
        Object.setPrototypeOf(this, ConnectionError.prototype)
    }
}

/**
 * Rondevu - Complete WebRTC signaling client with durable connections
 *
 * v1.0.0 introduces breaking changes:
 * - connectToService() now returns AnswererConnection instead of ConnectionContext
 * - Automatic reconnection and message buffering built-in
 * - Connection objects expose .send() method instead of raw DataChannel
 * - Rich event system for connection lifecycle (connected, disconnected, reconnecting, etc.)
 *
 * @example
 * ```typescript
 * // Create and initialize Rondevu instance with preset ICE servers
 * const rondevu = await Rondevu.connect({
 *   apiUrl: 'https://signal.example.com',
 *   username: 'alice',
 *   iceServers: 'ipv4-turn'  // Use preset: 'ipv4-turn', 'hostname-turns', 'google-stun', or 'relay-only'
 * })
 *
 * // Publish a service with automatic offer management
 * await rondevu.publishService({
 *   service: 'chat:2.0.0',
 *   maxOffers: 5  // Maintain up to 5 concurrent offers
 * })
 *
 * // Start accepting connections (auto-fills offers and polls)
 * await rondevu.startFilling()
 *
 * // Listen for connections (v1.0.0 API)
 * rondevu.on('connection:opened', (offerId, connection) => {
 *   connection.on('connected', () => console.log('Connected!'))
 *   connection.on('message', (data) => console.log('Received:', data))
 *   connection.send('Hello!')
 * })
 *
 * // Connect to a service (v1.0.0 - returns AnswererConnection)
 * const connection = await rondevu.connectToService({
 *   serviceFqn: 'chat:2.0.0@bob'
 * })
 *
 * connection.on('connected', () => {
 *   console.log('Connected!')
 *   connection.send('Hello!')
 * })
 *
 * connection.on('message', (data) => {
 *   console.log('Received:', data)
 * })
 *
 * connection.on('reconnecting', (attempt) => {
 *   console.log(`Reconnecting, attempt ${attempt}`)
 * })
 * ```
 */
export class Rondevu extends EventEmitter {
    // Constants
    private static readonly DEFAULT_TTL_MS = 300000  // 5 minutes
    private static readonly POLLING_INTERVAL_MS = 1000  // 1 second

    private api: RondevuAPI
    private readonly apiUrl: string
    private credential: Credential
    private cryptoAdapter?: CryptoAdapter
    private iceServers: RTCIceServer[]
    private debugEnabled: boolean
    private rtcPeerConnection?: typeof RTCPeerConnection
    private rtcIceCandidate?: typeof RTCIceCandidate

    // Service management
    private currentService: string | null = null
    private connectionConfig?: Partial<ConnectionConfig>
    private offerPool: OfferPool | null = null

    private constructor(
        apiUrl: string,
        credential: Credential,
        api: RondevuAPI,
        iceServers: RTCIceServer[],
        cryptoAdapter?: CryptoAdapter,
        debugEnabled = false,
        rtcPeerConnection?: typeof RTCPeerConnection,
        rtcIceCandidate?: typeof RTCIceCandidate
    ) {
        super()
        this.apiUrl = apiUrl
        this.credential = credential
        this.api = api
        this.iceServers = iceServers
        this.cryptoAdapter = cryptoAdapter
        this.debugEnabled = debugEnabled
        this.rtcPeerConnection = rtcPeerConnection
        this.rtcIceCandidate = rtcIceCandidate

        this.debug('Instance created:', {
            name: this.credential.name,
            hasIceServers: iceServers.length > 0
        })
    }

    /**
     * Internal debug logging - only logs if debug mode is enabled
     */
    private debug(message: string, ...args: any[]): void {
        if (this.debugEnabled) {
            console.log(`[Rondevu] ${message}`, ...args)
        }
    }

    /**
     * Create and initialize a Rondevu client
     *
     * @example
     * ```typescript
     * const rondevu = await Rondevu.connect({
     *   apiUrl: 'https://api.ronde.vu'
     * })
     * ```
     */
    static async connect(options: RondevuOptions): Promise<Rondevu> {
        // Apply WebRTC polyfills to global scope if provided (Node.js environments)
        if (options.rtcPeerConnection) {
            globalThis.RTCPeerConnection = options.rtcPeerConnection as any
        }
        if (options.rtcIceCandidate) {
            globalThis.RTCIceCandidate = options.rtcIceCandidate as any
        }

        // Handle preset string or custom array
        let iceServers: RTCIceServer[]
        if (typeof options.iceServers === 'string') {
            iceServers = ICE_SERVER_PRESETS[options.iceServers]
        } else {
            iceServers = options.iceServers || [
                { urls: 'stun:stun.l.google.com:19302' }
            ]
        }

        if (options.debug) {
            console.log('[Rondevu] Connecting:', {
                hasCredential: !!options.credential,
                iceServers: iceServers.length
            })
        }

        // Generate credential if not provided
        let credential = options.credential
        if (!credential) {
            if (options.debug) console.log('[Rondevu] Generating new credentials...')
            credential = await RondevuAPI.generateCredentials(options.apiUrl)
            if (options.debug) console.log('[Rondevu] Generated credentials, name:', credential.name)
        } else {
            if (options.debug) console.log('[Rondevu] Using existing credential, name:', credential.name)
        }

        // Create API instance
        const api = new RondevuAPI(
            options.apiUrl,
            credential,
            options.cryptoAdapter
        )
        if (options.debug) console.log('[Rondevu] Created API instance')

        return new Rondevu(
            options.apiUrl,
            credential,
            api,
            iceServers,
            options.cryptoAdapter,
            options.debug || false,
            options.rtcPeerConnection,
            options.rtcIceCandidate
        )
    }

    // ============================================
    // Credential Access
    // ============================================

    /**
     * Get the current credential name
     */
    getName(): string {
        return this.credential.name
    }

    /**
     * Get the full credential (name + secret)
     * Use this to persist credentials for future sessions
     *
     * ⚠️ SECURITY WARNING:
     * - The secret grants full access to this identity
     * - Store credentials securely (encrypted storage, never in logs)
     * - Never expose credentials in URLs, console output, or error messages
     * - Treat the secret like a password or API key
     */
    getCredential(): Credential {
        return { ...this.credential }
    }

    // ============================================
    // Service Publishing
    // ============================================

    /**
     * Default offer factory - creates a simple data channel connection
     * The RTCPeerConnection is created by Rondevu and passed in
     */
    private async defaultOfferFactory(pc: RTCPeerConnection): Promise<OfferContext> {
        const dc = pc.createDataChannel('default')

        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)

        return { dc, offer }
    }

    /**
     * Publish a service with automatic offer management
     * Call startFilling() to begin accepting connections
     *
     * @example
     * ```typescript
     * await rondevu.publishService({
     *   service: 'chat:2.0.0',
     *   maxOffers: 5,
     *   connectionConfig: {
     *     reconnectEnabled: true,
     *     bufferEnabled: true
     *   }
     * })
     * await rondevu.startFilling()
     * ```
     */
    async publishService(options: PublishServiceOptions): Promise<void> {
        const { service, maxOffers, offerFactory, ttl, connectionConfig } = options

        this.currentService = service
        this.connectionConfig = connectionConfig

        // Auto-append credential name to service
        const serviceFqn = `${service}@${this.credential.name}`

        this.debug(`Publishing service: ${service} with maxOffers: ${maxOffers}`)

        // Create OfferPool (but don't start it yet - call startFilling() to begin)
        this.offerPool = new OfferPool({
            api: this.api,
            serviceFqn,
            maxOffers,
            offerFactory: offerFactory || this.defaultOfferFactory.bind(this),
            ttl: ttl || Rondevu.DEFAULT_TTL_MS,
            iceServers: this.iceServers,
            connectionConfig,
            debugEnabled: this.debugEnabled,
        })

        // Forward events from OfferPool
        this.offerPool.on('connection:opened', (offerId, connection) => {
            this.emit('connection:opened', offerId, connection)
        })

        this.offerPool.on('offer:created', (offerId, serviceFqn) => {
            this.emit('offer:created', offerId, serviceFqn)
        })

        this.offerPool.on('connection:rotated', (oldOfferId, newOfferId, connection) => {
            this.emit('connection:rotated', oldOfferId, newOfferId, connection)
        })
    }

    /**
     * Start filling offers and polling for answers/ICE
     * Call this after publishService() to begin accepting connections
     */
    async startFilling(): Promise<void> {
        if (!this.offerPool) {
            throw new Error('No service published. Call publishService() first.')
        }

        this.debug('Starting offer filling and polling')
        await this.offerPool.start()
    }

    /**
     * Stop filling offers and polling
     * Closes all active peer connections
     */
    stopFilling(): void {
        this.debug('Stopping offer filling and polling')
        this.offerPool?.stop()
    }

    /**
     * Get the count of active offers
     * @returns Number of active offers
     */
    getOfferCount(): number {
        return this.offerPool?.getOfferCount() ?? 0
    }

    /**
     * Check if an offer is currently connected
     * @param offerId - The offer ID to check
     * @returns True if the offer exists and is connected
     */
    isConnected(offerId: string): boolean {
        return this.offerPool?.isConnected(offerId) ?? false
    }

    /**
     * Disconnect all active offers
     * Similar to stopFilling() but doesn't stop the polling/filling process
     */
    disconnectAll(): void {
        this.debug('Disconnecting all offers')
        this.offerPool?.disconnectAll()
    }

    /**
     * Get the current service status
     * @returns Object with service state information
     */
    getServiceStatus(): { active: boolean; offerCount: number } {
        return {
            active: this.currentService !== null,
            offerCount: this.offerPool?.getOfferCount() ?? 0
        }
    }

    /**
     * Resolve the full service FQN from various input options
     * Supports direct FQN, service+username, or service discovery
     */
    private async resolveServiceFqn(options: ConnectToServiceOptions): Promise<string> {
        const { serviceFqn, service, username } = options

        if (serviceFqn) {
            return serviceFqn
        } else if (service && username) {
            return `${service}@${username}`
        } else if (service) {
            // Discovery mode - get random service
            this.debug(`Discovering service: ${service}`)
            const discovered = await this.findService(service) as ServiceResult
            return discovered.serviceFqn
        } else {
            throw new Error('Either serviceFqn or service must be provided')
        }
    }

    /**
     * Connect to a service (answerer side) - v1.0.0 API
     * Returns an AnswererConnection with automatic reconnection and buffering
     *
     * BREAKING CHANGE: This now returns AnswererConnection instead of ConnectionContext
     *
     * @example
     * ```typescript
     * // Connect to specific user
     * const connection = await rondevu.connectToService({
     *   serviceFqn: 'chat:2.0.0@alice',
     *   connectionConfig: {
     *     reconnectEnabled: true,
     *     bufferEnabled: true
     *   }
     * })
     *
     * connection.on('connected', () => {
     *   console.log('Connected!')
     *   connection.send('Hello!')
     * })
     *
     * connection.on('message', (data) => {
     *   console.log('Received:', data)
     * })
     *
     * connection.on('reconnecting', (attempt) => {
     *   console.log(`Reconnecting, attempt ${attempt}`)
     * })
     *
     * // Discover random service
     * const connection = await rondevu.connectToService({
     *   service: 'chat:2.0.0'
     * })
     * ```
     */
    async connectToService(options: ConnectToServiceOptions): Promise<AnswererConnection> {
        const { rtcConfig, connectionConfig } = options

        // Validate inputs
        if (options.serviceFqn !== undefined && typeof options.serviceFqn === 'string' && !options.serviceFqn.trim()) {
            throw new Error('serviceFqn cannot be empty')
        }
        if (options.service !== undefined && typeof options.service === 'string' && !options.service.trim()) {
            throw new Error('service cannot be empty')
        }
        if (options.username !== undefined && typeof options.username === 'string' && !options.username.trim()) {
            throw new Error('username cannot be empty')
        }

        // Determine the full service FQN
        const fqn = await this.resolveServiceFqn(options)
        this.debug(`Connecting to service: ${fqn}`)

        // Get service offer
        const serviceData = await this.api.getService(fqn)
        this.debug(`Found service from @${serviceData.username}`)

        // Create RTCConfiguration
        const rtcConfiguration = rtcConfig || {
            iceServers: this.iceServers
        }

        // Create AnswererConnection
        const connection = new AnswererConnection({
            api: this.api,
            serviceFqn: serviceData.serviceFqn,
            offerId: serviceData.offerId,
            offerSdp: serviceData.sdp,
            rtcConfig: rtcConfiguration,
            config: {
                ...connectionConfig,
                debug: this.debugEnabled,
            },
        })

        // Initialize the connection
        await connection.initialize()

        return connection
    }

    // ============================================
    // Service Discovery
    // ============================================

    /**
     * Find a service - unified discovery method
     *
     * @param serviceFqn - Service identifier (e.g., 'chat:1.0.0' or 'chat:1.0.0@alice')
     * @param options - Discovery options
     *
     * @example
     * ```typescript
     * // Direct lookup (has username)
     * const service = await rondevu.findService('chat:1.0.0@alice')
     *
     * // Random discovery (no username)
     * const service = await rondevu.findService('chat:1.0.0')
     *
     * // Paginated discovery
     * const result = await rondevu.findService('chat:1.0.0', {
     *   mode: 'paginated',
     *   limit: 20,
     *   offset: 0
     * })
     * ```
     */
    async findService(
        serviceFqn: string,
        options?: FindServiceOptions
    ): Promise<ServiceResult | PaginatedServiceResult> {
        const { mode, limit = 10, offset = 0 } = options || {}

        // Auto-detect mode if not specified
        const hasUsername = serviceFqn.includes('@')
        const effectiveMode = mode || (hasUsername ? 'direct' : 'random')

        if (effectiveMode === 'paginated') {
            return await this.api.getService(serviceFqn, { limit, offset })
        } else {
            // Both 'direct' and 'random' use the same API call
            return await this.api.getService(serviceFqn)
        }
    }

    // ============================================
    // WebRTC Signaling
    // ============================================

    /**
     * Post answer SDP to specific offer
     */
    async postOfferAnswer(serviceFqn: string, offerId: string, sdp: string): Promise<{
        success: boolean
        offerId: string
    }> {
        await this.api.answerOffer(serviceFqn, offerId, sdp)
        return { success: true, offerId }
    }

    /**
     * Get answer SDP (offerer polls this)
     */
    async getOfferAnswer(serviceFqn: string, offerId: string): Promise<{
        sdp: string
        offerId: string
        answererId: string
        answeredAt: number
    } | null> {
        return await this.api.getOfferAnswer(serviceFqn, offerId)
    }

    /**
     * Combined polling for answers and ICE candidates
     * Returns all answered offers and ICE candidates for all peer's offers since timestamp
     */
    async poll(since?: number): Promise<{
        answers: Array<{
            offerId: string
            serviceId?: string
            answererId: string
            sdp: string
            answeredAt: number
        }>
        iceCandidates: Record<string, Array<{
            candidate: RTCIceCandidateInit | null
            role: 'offerer' | 'answerer'
            peerId: string
            createdAt: number
        }>>
    }> {
        return await this.api.poll(since)
    }

    /**
     * Add ICE candidates to specific offer
     */
    async addOfferIceCandidates(serviceFqn: string, offerId: string, candidates: RTCIceCandidateInit[]): Promise<{
        count: number
        offerId: string
    }> {
        return await this.api.addOfferIceCandidates(serviceFqn, offerId, candidates)
    }

    /**
     * Get ICE candidates for specific offer (with polling support)
     */
    async getOfferIceCandidates(serviceFqn: string, offerId: string, since: number = 0): Promise<{
        candidates: IceCandidate[]
        offerId: string
    }> {
        return await this.api.getOfferIceCandidates(serviceFqn, offerId, since)
    }

    // ============================================
    // Utility Methods
    // ============================================

    /**
     * Get the credential name
     * @deprecated Use getName() instead
     */
    getUsername(): string {
        console.warn('[Rondevu] getUsername() is deprecated. Use getName() instead.')
        return this.credential.name
    }

    /**
     * Get active connections (for offerer side)
     */
    getActiveConnections(): Map<string, OffererConnection> {
        return this.offerPool?.getActiveConnections() ?? new Map()
    }

    /**
     * Get all active offers (legacy compatibility)
     * @deprecated Use getActiveConnections() instead
     */
    getActiveOffers(): ActiveOffer[] {
        const offers: ActiveOffer[] = []
        const connections = this.offerPool?.getActiveConnections() ?? new Map()
        for (const [offerId, connection] of connections.entries()) {
            const pc = connection.getPeerConnection()
            const dc = connection.getDataChannel()
            if (pc) {
                offers.push({
                    offerId,
                    serviceFqn: this.currentService ? `${this.currentService}@${this.credential.name}` : '',
                    pc,
                    dc: dc || undefined,
                    answered: connection.getState() === 'connected',
                    createdAt: Date.now(),
                })
            }
        }
        return offers
    }

    /**
     * Access to underlying API for advanced operations
     * @deprecated Use direct methods on Rondevu instance instead
     */
    getAPIPublic(): RondevuAPI {
        return this.api
    }
}
