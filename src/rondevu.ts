import { RondevuAPI, Keypair, IceCandidate, BatcherOptions } from './api.js'
import { CryptoAdapter } from './crypto-adapter.js'
import { EventEmitter } from 'eventemitter3'

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
    username?: string  // Optional, will generate anonymous if not provided
    keypair?: Keypair  // Optional, will generate if not provided
    cryptoAdapter?: CryptoAdapter  // Optional, defaults to WebCryptoAdapter
    batching?: BatcherOptions | false  // Optional, defaults to enabled with default options
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
    onConnection?: (context: ConnectionContext) => void | Promise<void>  // Called when data channel opens
    rtcConfig?: RTCConfiguration  // Optional: override default ICE servers
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
 * Rondevu - Complete WebRTC signaling client
 *
 * Provides a unified API for:
 * - Implicit username claiming (auto-claimed on first authenticated request)
 * - Service publishing with automatic signature generation
 * - Service discovery (direct, random, paginated)
 * - WebRTC signaling (offer/answer exchange, ICE relay)
 * - Keypair management
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
 * // Or use custom ICE servers
 * const rondevu2 = await Rondevu.connect({
 *   apiUrl: 'https://signal.example.com',
 *   username: 'bob',
 *   iceServers: [
 *     { urls: 'stun:stun.l.google.com:19302' },
 *     { urls: 'turn:turn.example.com:3478', username: 'user', credential: 'pass' }
 *   ]
 * })
 *
 * // Publish a service with automatic offer management
 * await rondevu.publishService({
 *   service: 'chat:2.0.0',
 *   maxOffers: 5,  // Maintain up to 5 concurrent offers
 *   offerFactory: async (pc) => {
 *     // pc is created by Rondevu with ICE handlers already attached
 *     const dc = pc.createDataChannel('chat')
 *     const offer = await pc.createOffer()
 *     await pc.setLocalDescription(offer)
 *     return { dc, offer }
 *   }
 * })
 *
 * // Start accepting connections (auto-fills offers and polls)
 * await rondevu.startFilling()
 *
 * // Access active connections
 * for (const offer of rondevu.getActiveOffers()) {
 *   offer.dc?.addEventListener('message', (e) => console.log(e.data))
 * }
 *
 * // Stop when done
 * rondevu.stopFilling()
 * ```
 */
export class Rondevu extends EventEmitter {
    // Constants
    private static readonly DEFAULT_TTL_MS = 300000  // 5 minutes
    private static readonly POLLING_INTERVAL_MS = 1000  // 1 second

    private api: RondevuAPI
    private readonly apiUrl: string
    private username: string
    private keypair: Keypair
    private usernameClaimed = false
    private cryptoAdapter?: CryptoAdapter
    private batchingOptions?: BatcherOptions | false
    private iceServers: RTCIceServer[]
    private debugEnabled: boolean
    private rtcPeerConnection?: typeof RTCPeerConnection
    private rtcIceCandidate?: typeof RTCIceCandidate

    // Service management
    private currentService: string | null = null
    private maxOffers = 0
    private offerFactory: OfferFactory | null = null
    private ttl = Rondevu.DEFAULT_TTL_MS
    private activeOffers = new Map<string, ActiveOffer>()

    // Polling
    private filling = false
    private pollingInterval: ReturnType<typeof setInterval> | null = null
    private lastPollTimestamp = 0
    private isPolling = false  // Guard against concurrent poll execution

    private constructor(
        apiUrl: string,
        username: string,
        keypair: Keypair,
        api: RondevuAPI,
        iceServers: RTCIceServer[],
        cryptoAdapter?: CryptoAdapter,
        batchingOptions?: BatcherOptions | false,
        debugEnabled = false,
        rtcPeerConnection?: typeof RTCPeerConnection,
        rtcIceCandidate?: typeof RTCIceCandidate
    ) {
        super()
        this.apiUrl = apiUrl
        this.username = username
        this.keypair = keypair
        this.api = api
        this.iceServers = iceServers
        this.cryptoAdapter = cryptoAdapter
        this.batchingOptions = batchingOptions
        this.debugEnabled = debugEnabled
        this.rtcPeerConnection = rtcPeerConnection
        this.rtcIceCandidate = rtcIceCandidate

        this.debug('Instance created:', {
            username: this.username,
            publicKey: this.keypair.publicKey,
            hasIceServers: iceServers.length > 0,
            batchingEnabled: batchingOptions !== false
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
     *   apiUrl: 'https://api.ronde.vu',
     *   username: 'alice'
     * })
     * ```
     */
    static async connect(options: RondevuOptions): Promise<Rondevu> {
        const username = options.username || Rondevu.generateAnonymousUsername()

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
                username,
                hasKeypair: !!options.keypair,
                iceServers: iceServers.length,
                batchingEnabled: options.batching !== false
            })
        }

        // Generate keypair if not provided
        let keypair = options.keypair
        if (!keypair) {
            if (options.debug) console.log('[Rondevu] Generating new keypair...')
            keypair = await RondevuAPI.generateKeypair(options.cryptoAdapter)
            if (options.debug) console.log('[Rondevu] Generated keypair, publicKey:', keypair.publicKey)
        } else {
            if (options.debug) console.log('[Rondevu] Using existing keypair, publicKey:', keypair.publicKey)
        }

        // Create API instance
        const api = new RondevuAPI(
            options.apiUrl,
            username,
            keypair,
            options.cryptoAdapter,
            options.batching
        )
        if (options.debug) console.log('[Rondevu] Created API instance')

        return new Rondevu(
            options.apiUrl,
            username,
            keypair,
            api,
            iceServers,
            options.cryptoAdapter,
            options.batching,
            options.debug || false,
            options.rtcPeerConnection,
            options.rtcIceCandidate
        )
    }

    /**
     * Generate an anonymous username with timestamp and random component
     */
    private static generateAnonymousUsername(): string {
        const timestamp = Date.now().toString(36)
        const random = Array.from(crypto.getRandomValues(new Uint8Array(3)))
            .map(b => b.toString(16).padStart(2, '0')).join('')
        return `anon-${timestamp}-${random}`
    }

    // ============================================
    // Username Management
    // ============================================

    /**
     * Check if username has been claimed (checks with server)
     */
    async isUsernameClaimed(): Promise<boolean> {
        try {
            const claimed = await this.api.isUsernameClaimed()

            // Update internal flag to match server state
            this.usernameClaimed = claimed

            return claimed
        } catch (err) {
            console.error('Failed to check username claim status:', err)
            return false
        }
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
     *   maxOffers: 5
     * })
     * await rondevu.startFilling()
     * ```
     */
    async publishService(options: PublishServiceOptions): Promise<void> {
        const { service, maxOffers, offerFactory, ttl } = options

        this.currentService = service
        this.maxOffers = maxOffers
        this.offerFactory = offerFactory || this.defaultOfferFactory.bind(this)
        this.ttl = ttl || Rondevu.DEFAULT_TTL_MS

        this.debug(`Publishing service: ${service} with maxOffers: ${maxOffers}`)
        this.usernameClaimed = true
    }

    /**
     * Set up ICE candidate handler to send candidates to the server
     *
     * Note: This is used by connectToService() where the offerId is already known.
     * For createOffer(), we use inline ICE handling with early candidate queuing
     * since the offerId isn't available until after the factory completes.
     */
    private setupIceCandidateHandler(
        pc: RTCPeerConnection,
        serviceFqn: string,
        offerId: string
    ): void {
        pc.onicecandidate = async (event) => {
            if (event.candidate) {
                try {
                    // Handle both browser and Node.js (wrtc) environments
                    // Browser: candidate.toJSON() exists
                    // Node.js wrtc: candidate is already a plain object
                    const candidateData = typeof event.candidate.toJSON === 'function'
                        ? event.candidate.toJSON()
                        : event.candidate

                    // Emit local ICE candidate event
                    this.emit('ice:candidate:local', offerId, candidateData)

                    await this.api.addOfferIceCandidates(
                        serviceFqn,
                        offerId,
                        [candidateData]
                    )
                } catch (err) {
                    console.error('[Rondevu] Failed to send ICE candidate:', err)
                }
            }
        }
    }

    /**
     * Create a single offer and publish it to the server
     */
    private async createOffer(): Promise<void> {
        if (!this.currentService || !this.offerFactory) {
            throw new Error('Service not published. Call publishService() first.')
        }

        const rtcConfig: RTCConfiguration = {
            iceServers: this.iceServers
        }

        // Auto-append username to service
        const serviceFqn = `${this.currentService}@${this.username}`

        this.debug('Creating new offer...')

        // 1. Create the RTCPeerConnection - Rondevu controls this to set up handlers early
        const pc = new RTCPeerConnection(rtcConfig)

        // 2. Set up ICE candidate handler with queuing BEFORE the factory runs
        // This ensures we capture all candidates, even those generated immediately
        // when setLocalDescription() is called in the factory
        const earlyIceCandidates: RTCIceCandidateInit[] = []
        let offerId: string | undefined

        pc.onicecandidate = async (event) => {
            if (event.candidate) {
                // Handle both browser and Node.js (wrtc) environments
                const candidateData = typeof event.candidate.toJSON === 'function'
                    ? event.candidate.toJSON()
                    : event.candidate

                // Emit local ICE candidate event
                if (offerId) {
                    this.emit('ice:candidate:local', offerId, candidateData)
                }

                if (offerId) {
                    // We have the offerId, send directly
                    try {
                        await this.api.addOfferIceCandidates(serviceFqn, offerId, [candidateData])
                    } catch (err) {
                        console.error('[Rondevu] Failed to send ICE candidate:', err)
                    }
                } else {
                    // Queue for later - we don't have the offerId yet
                    this.debug('Queuing early ICE candidate')
                    earlyIceCandidates.push(candidateData)
                }
            }
        }

        // 3. Call the factory with the pc - factory creates data channel and offer
        // When factory calls setLocalDescription(), ICE gathering starts and
        // candidates are captured by the handler we set up above
        let dc: RTCDataChannel | undefined
        let offer: RTCSessionDescriptionInit
        try {
            const factoryResult = await this.offerFactory(pc)
            dc = factoryResult.dc
            offer = factoryResult.offer
        } catch (err) {
            // Clean up the connection if factory fails
            pc.close()
            throw err
        }

        // 4. Publish to server to get offerId
        const result = await this.api.publishService({
            serviceFqn,
            offers: [{ sdp: offer.sdp! }],
            ttl: this.ttl,
            signature: '',
            message: '',
        })

        offerId = result.offers[0].offerId

        // 5. Store active offer
        this.activeOffers.set(offerId, {
            offerId,
            serviceFqn,
            pc,
            dc,
            answered: false,
            createdAt: Date.now()
        })

        this.debug(`Offer created: ${offerId}`)
        this.emit('offer:created', offerId, serviceFqn)

        // Set up data channel open handler (offerer side)
        if (dc) {
            dc.onopen = () => {
                this.debug(`Data channel opened for offer ${offerId}`)
                this.emit('connection:opened', offerId, dc)
            }
        }

        // 6. Send any queued early ICE candidates
        if (earlyIceCandidates.length > 0) {
            this.debug(`Sending ${earlyIceCandidates.length} early ICE candidates`)
            try {
                await this.api.addOfferIceCandidates(serviceFqn, offerId, earlyIceCandidates)
            } catch (err) {
                console.error('[Rondevu] Failed to send early ICE candidates:', err)
            }
        }

        // 7. Monitor connection state
        pc.onconnectionstatechange = () => {
            this.debug(`Offer ${offerId} connection state: ${pc.connectionState}`)

            if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
                this.emit('connection:closed', offerId!)
                this.activeOffers.delete(offerId!)
                this.fillOffers()  // Try to replace failed offer
            }
        }
    }

    /**
     * Fill offers to reach maxOffers count
     */
    private async fillOffers(): Promise<void> {
        if (!this.filling || !this.currentService) return

        const currentCount = this.activeOffers.size
        const needed = this.maxOffers - currentCount

        this.debug(`Filling offers: current=${currentCount}, needed=${needed}`)

        for (let i = 0; i < needed; i++) {
            try {
                await this.createOffer()
            } catch (err) {
                console.error('[Rondevu] Failed to create offer:', err)
            }
        }
    }

    /**
     * Poll for answers and ICE candidates (internal use for automatic offer management)
     */
    private async pollInternal(): Promise<void> {
        if (!this.filling) return

        // Prevent concurrent poll execution to avoid duplicate answer processing
        if (this.isPolling) {
            this.debug('Poll already in progress, skipping')
            return
        }

        this.isPolling = true
        try {
            const result = await this.api.poll(this.lastPollTimestamp)

            // Process answers
            for (const answer of result.answers) {
                const activeOffer = this.activeOffers.get(answer.offerId)
                if (activeOffer && !activeOffer.answered) {
                    this.debug(`Received answer for offer ${answer.offerId}`)

                    // Mark as answered BEFORE setRemoteDescription to prevent race condition
                    activeOffer.answered = true

                    try {
                        await activeOffer.pc.setRemoteDescription({
                            type: 'answer',
                            sdp: answer.sdp
                        })

                        this.lastPollTimestamp = answer.answeredAt
                        this.emit('offer:answered', answer.offerId, answer.answererId)

                        // Create replacement offer
                        this.fillOffers()
                    } catch (err) {
                        // If setRemoteDescription fails, reset the answered flag
                        activeOffer.answered = false
                        throw err
                    }
                }
            }

            // Process ICE candidates
            for (const [offerId, candidates] of Object.entries(result.iceCandidates)) {
                const activeOffer = this.activeOffers.get(offerId)
                if (activeOffer) {
                    const answererCandidates = candidates.filter(c => c.role === 'answerer')

                    for (const item of answererCandidates) {
                        if (item.candidate) {
                            this.emit('ice:candidate:remote', offerId, item.candidate, item.role)
                            await activeOffer.pc.addIceCandidate(new RTCIceCandidate(item.candidate))
                            this.lastPollTimestamp = Math.max(this.lastPollTimestamp, item.createdAt)
                        }
                    }
                }
            }
        } catch (err) {
            console.error('[Rondevu] Polling error:', err)
        } finally {
            this.isPolling = false
        }
    }

    /**
     * Start filling offers and polling for answers/ICE
     * Call this after publishService() to begin accepting connections
     */
    async startFilling(): Promise<void> {
        if (this.filling) {
            this.debug('Already filling')
            return
        }

        if (!this.currentService) {
            throw new Error('No service published. Call publishService() first.')
        }

        this.debug('Starting offer filling and polling')
        this.filling = true

        // Fill initial offers
        await this.fillOffers()

        // Start polling
        this.pollingInterval = setInterval(() => {
            this.pollInternal()
        }, Rondevu.POLLING_INTERVAL_MS)
    }

    /**
     * Stop filling offers and polling
     * Closes all active peer connections
     */
    stopFilling(): void {
        this.debug('Stopping offer filling and polling')
        this.filling = false
        this.isPolling = false  // Reset polling guard

        // Stop polling
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval)
            this.pollingInterval = null
        }

        // Close all active connections
        for (const [offerId, offer] of this.activeOffers.entries()) {
            this.debug(`Closing offer ${offerId}`)
            offer.dc?.close()
            offer.pc.close()
        }

        this.activeOffers.clear()
    }

    /**
     * Get the count of active offers
     * @returns Number of active offers
     */
    getOfferCount(): number {
        return this.activeOffers.size
    }

    /**
     * Check if an offer is currently connected
     * @param offerId - The offer ID to check
     * @returns True if the offer exists and has been answered
     */
    isConnected(offerId: string): boolean {
        const offer = this.activeOffers.get(offerId)
        return offer ? offer.answered : false
    }

    /**
     * Disconnect all active offers
     * Similar to stopFilling() but doesn't stop the polling/filling process
     */
    async disconnectAll(): Promise<void> {
        this.debug('Disconnecting all offers')
        for (const [offerId, offer] of this.activeOffers.entries()) {
            this.debug(`Closing offer ${offerId}`)
            offer.dc?.close()
            offer.pc.close()
        }
        this.activeOffers.clear()
    }

    /**
     * Get the current service status
     * @returns Object with service state information
     */
    getServiceStatus(): { active: boolean; offerCount: number; maxOffers: number; filling: boolean } {
        return {
            active: this.currentService !== null,
            offerCount: this.activeOffers.size,
            maxOffers: this.maxOffers,
            filling: this.filling
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
     * Start polling for remote ICE candidates
     * Returns the polling interval ID
     */
    private startIcePolling(
        pc: RTCPeerConnection,
        serviceFqn: string,
        offerId: string
    ): ReturnType<typeof setInterval> {
        let lastIceTimestamp = 0

        return setInterval(async () => {
            try {
                const result = await this.api.getOfferIceCandidates(
                    serviceFqn,
                    offerId,
                    lastIceTimestamp
                )
                for (const item of result.candidates) {
                    if (item.candidate) {
                        this.emit('ice:candidate:remote', offerId, item.candidate, item.role)
                        await pc.addIceCandidate(new RTCIceCandidate(item.candidate))
                        lastIceTimestamp = item.createdAt
                    }
                }
            } catch (err) {
                console.error('[Rondevu] Failed to poll ICE candidates:', err)
            }
        }, Rondevu.POLLING_INTERVAL_MS)
    }

    /**
     * Automatically connect to a service (answerer side)
     * Handles the entire connection flow: discovery, WebRTC setup, answer exchange, ICE candidates
     *
     * @example
     * ```typescript
     * // Connect to specific user
     * const connection = await rondevu.connectToService({
     *   serviceFqn: 'chat:2.0.0@alice',
     *   onConnection: ({ dc, peerUsername }) => {
     *     console.log('Connected to', peerUsername)
     *     dc.addEventListener('message', (e) => console.log(e.data))
     *     dc.addEventListener('open', () => dc.send('Hello!'))
     *   }
     * })
     *
     * // Discover random service
     * const connection = await rondevu.connectToService({
     *   service: 'chat:2.0.0',
     *   onConnection: ({ dc, peerUsername }) => {
     *     console.log('Connected to', peerUsername)
     *   }
     * })
     * ```
     */
    async connectToService(options: ConnectToServiceOptions): Promise<ConnectionContext> {
        const { onConnection, rtcConfig } = options

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

        // 1. Get service offer
        const serviceData = await this.api.getService(fqn)
        this.debug(`Found service from @${serviceData.username}`)

        // 2. Create RTCPeerConnection
        const rtcConfiguration = rtcConfig || {
            iceServers: this.iceServers
        }
        const pc = new RTCPeerConnection(rtcConfiguration)

        // 3. Set up data channel handler (answerer receives it from offerer)
        let dc: RTCDataChannel | null = null
        const dataChannelPromise = new Promise<RTCDataChannel>((resolve) => {
            pc.ondatachannel = (event) => {
                this.debug('Data channel received from offerer')
                dc = event.channel
                this.emit('connection:opened', serviceData.offerId, dc)
                resolve(dc)
            }
        })

        // 4. Set up ICE candidate exchange
        this.setupIceCandidateHandler(pc, serviceData.serviceFqn, serviceData.offerId)

        // 5. Poll for remote ICE candidates
        const icePollInterval = this.startIcePolling(pc, serviceData.serviceFqn, serviceData.offerId)

        // 6. Set remote description
        await pc.setRemoteDescription({
            type: 'offer',
            sdp: serviceData.sdp
        })

        // 7. Create and send answer
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        await this.api.answerOffer(
            serviceData.serviceFqn,
            serviceData.offerId,
            answer.sdp!
        )

        // 8. Wait for data channel to be established
        dc = await dataChannelPromise

        // Create connection context
        const context: ConnectionContext = {
            pc,
            dc,
            serviceFqn: serviceData.serviceFqn,
            offerId: serviceData.offerId,
            peerUsername: serviceData.username
        }

        // 9. Set up connection state monitoring
        pc.onconnectionstatechange = () => {
            this.debug(`Connection state: ${pc.connectionState}`)
            if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
                clearInterval(icePollInterval)
            }
        }

        // 10. Wait for data channel to open and call onConnection
        if (dc.readyState === 'open') {
            this.debug('Data channel already open')
            if (onConnection) {
                await onConnection(context)
            }
        } else {
            await new Promise<void>((resolve) => {
                dc!.addEventListener('open', async () => {
                    this.debug('Data channel opened')
                    if (onConnection) {
                        await onConnection(context)
                    }
                    resolve()
                })
            })
        }

        return context
    }

    // ============================================
    // Service Discovery
    // ============================================

    /**
     * Find a service - unified discovery method
     *
     * Replaces getService(), discoverService(), and discoverServices() with a single method.
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
     * Get the current keypair (for backup/storage)
     */
    getKeypair(): Keypair {
        return this.keypair
    }

    /**
     * Get the username
     */
    getUsername(): string {
        return this.username
    }

    /**
     * Get the public key
     */
    getPublicKey(): string {
        return this.keypair.publicKey
    }

    /**
     * Access to underlying API for advanced operations
     * @deprecated Use direct methods on Rondevu instance instead
     */
    getAPIPublic(): RondevuAPI {
        return this.api
    }
}
