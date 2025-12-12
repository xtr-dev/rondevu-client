import { RondevuAPI, Keypair, Service, ServiceRequest, IceCandidate, BatcherOptions } from './api.js'
import { CryptoAdapter } from './crypto-adapter.js'

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
}

export interface OfferContext {
    pc: RTCPeerConnection
    dc?: RTCDataChannel
    offer: RTCSessionDescriptionInit
}

export type OfferFactory = (rtcConfig: RTCConfiguration) => Promise<OfferContext>

export interface PublishServiceOptions {
    service?: string // Service name and version (e.g., "chat:2.0.0") - username will be auto-appended
    serviceFqn?: string // Full service FQN (legacy, use 'service' instead)
    maxOffers?: number  // Maximum number of concurrent offers to maintain (automatic mode)
    offers?: Array<{ sdp: string }>  // Manual offers array (legacy mode)
    offerFactory?: OfferFactory  // Optional: custom offer creation (defaults to simple data channel)
    ttl?: number  // Time-to-live for offers in milliseconds
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

interface ActiveOffer {
    offerId: string
    serviceFqn: string
    pc: RTCPeerConnection
    dc?: RTCDataChannel
    answered: boolean
    createdAt: number
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
 *   offerFactory: async (rtcConfig) => {
 *     const pc = new RTCPeerConnection(rtcConfig)
 *     const dc = pc.createDataChannel('chat')
 *     const offer = await pc.createOffer()
 *     await pc.setLocalDescription(offer)
 *     return { pc, dc, offer }
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
export class Rondevu {
    private api: RondevuAPI
    private readonly apiUrl: string
    private username: string
    private keypair: Keypair
    private usernameClaimed = false
    private cryptoAdapter?: CryptoAdapter
    private batchingOptions?: BatcherOptions | false
    private iceServers: RTCIceServer[]

    // Service management
    private currentService: string | null = null
    private maxOffers = 0
    private offerFactory: OfferFactory | null = null
    private ttl = 300000  // 5 minutes default
    private activeOffers = new Map<string, ActiveOffer>()

    // Polling
    private filling = false
    private pollingInterval: ReturnType<typeof setInterval> | null = null
    private lastPollTimestamp = 0

    private constructor(
        apiUrl: string,
        username: string,
        keypair: Keypair,
        api: RondevuAPI,
        iceServers: RTCIceServer[],
        cryptoAdapter?: CryptoAdapter,
        batchingOptions?: BatcherOptions | false
    ) {
        this.apiUrl = apiUrl
        this.username = username
        this.keypair = keypair
        this.api = api
        this.iceServers = iceServers
        this.cryptoAdapter = cryptoAdapter
        this.batchingOptions = batchingOptions

        console.log('[Rondevu] Instance created:', {
            username: this.username,
            publicKey: this.keypair.publicKey,
            hasIceServers: iceServers.length > 0,
            batchingEnabled: batchingOptions !== false
        })
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

        // Handle preset string or custom array
        let iceServers: RTCIceServer[]
        if (typeof options.iceServers === 'string') {
            iceServers = ICE_SERVER_PRESETS[options.iceServers]
        } else {
            iceServers = options.iceServers || [
                { urls: 'stun:stun.l.google.com:19302' }
            ]
        }

        console.log('[Rondevu] Connecting:', {
            username,
            hasKeypair: !!options.keypair,
            iceServers: iceServers.length,
            batchingEnabled: options.batching !== false
        })

        // Generate keypair if not provided
        let keypair = options.keypair
        if (!keypair) {
            console.log('[Rondevu] Generating new keypair...')
            keypair = await RondevuAPI.generateKeypair(options.cryptoAdapter)
            console.log('[Rondevu] Generated keypair, publicKey:', keypair.publicKey)
        } else {
            console.log('[Rondevu] Using existing keypair, publicKey:', keypair.publicKey)
        }

        // Create API instance
        const api = new RondevuAPI(
            options.apiUrl,
            username,
            keypair,
            options.cryptoAdapter,
            options.batching
        )
        console.log('[Rondevu] Created API instance')

        return new Rondevu(
            options.apiUrl,
            username,
            keypair,
            api,
            iceServers,
            options.cryptoAdapter,
            options.batching
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
     */
    private async defaultOfferFactory(rtcConfig: RTCConfiguration): Promise<OfferContext> {
        const pc = new RTCPeerConnection(rtcConfig)
        const dc = pc.createDataChannel('default')

        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)

        return { pc, dc, offer }
    }

    /**
     * Publish a service
     *
     * Two modes:
     * 1. Automatic offer management (recommended):
     *    Pass maxOffers and optionally offerFactory
     *    Call startFilling() to begin accepting connections
     *
     * 2. Manual mode (legacy):
     *    Pass offers array with pre-created SDP offers
     *    Returns published service data
     *
     * @example Automatic mode:
     * ```typescript
     * await rondevu.publishService({
     *   service: 'chat:2.0.0',
     *   maxOffers: 5
     * })
     * await rondevu.startFilling()
     * ```
     *
     * @example Manual mode (legacy):
     * ```typescript
     * const published = await rondevu.publishService({
     *   serviceFqn: 'chat:2.0.0@alice',
     *   offers: [{ sdp: offerSdp }]
     * })
     * ```
     */
    async publishService(options: PublishServiceOptions): Promise<any> {
        const { service, serviceFqn, maxOffers, offers, offerFactory, ttl } = options

        // Manual mode (legacy) - publish pre-created offers
        if (offers && offers.length > 0) {
            const fqn = serviceFqn || `${service}@${this.username}`
            const result = await this.api.publishService({
                serviceFqn: fqn,
                offers,
                ttl: ttl || 300000,
                signature: '',
                message: '',
            })
            this.usernameClaimed = true
            return result
        }

        // Automatic mode - store configuration for startFilling()
        if (maxOffers !== undefined) {
            const svc = service || serviceFqn?.split('@')[0]
            if (!svc) {
                throw new Error('Either service or serviceFqn must be provided')
            }

            this.currentService = svc
            this.maxOffers = maxOffers
            this.offerFactory = offerFactory || this.defaultOfferFactory.bind(this)
            this.ttl = ttl || 300000

            console.log(`[Rondevu] Publishing service: ${svc} with maxOffers: ${maxOffers}`)
            this.usernameClaimed = true
            return
        }

        throw new Error('Either maxOffers (automatic mode) or offers array (manual mode) must be provided')
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

        console.log('[Rondevu] Creating new offer...')

        // Create the offer using the factory
        const { pc, dc, offer } = await this.offerFactory(rtcConfig)

        // Auto-append username to service
        const serviceFqn = `${this.currentService}@${this.username}`

        // Publish to server
        const result = await this.api.publishService({
            serviceFqn,
            offers: [{ sdp: offer.sdp! }],
            ttl: this.ttl,
            signature: '',
            message: '',
        })

        const offerId = result.offers[0].offerId

        // Store active offer
        this.activeOffers.set(offerId, {
            offerId,
            serviceFqn,
            pc,
            dc,
            answered: false,
            createdAt: Date.now()
        })

        console.log(`[Rondevu] Offer created: ${offerId}`)

        // Set up ICE candidate handler
        pc.onicecandidate = async (event) => {
            if (event.candidate) {
                try {
                    await this.api.addOfferIceCandidates(
                        serviceFqn,
                        offerId,
                        [event.candidate.toJSON()]
                    )
                } catch (err) {
                    console.error('[Rondevu] Failed to send ICE candidate:', err)
                }
            }
        }

        // Monitor connection state
        pc.onconnectionstatechange = () => {
            console.log(`[Rondevu] Offer ${offerId} connection state: ${pc.connectionState}`)

            if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
                this.activeOffers.delete(offerId)
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

        console.log(`[Rondevu] Filling offers: current=${currentCount}, needed=${needed}`)

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

        try {
            const result = await this.api.poll(this.lastPollTimestamp)

            // Process answers
            for (const answer of result.answers) {
                const activeOffer = this.activeOffers.get(answer.offerId)
                if (activeOffer && !activeOffer.answered) {
                    console.log(`[Rondevu] Received answer for offer ${answer.offerId}`)

                    await activeOffer.pc.setRemoteDescription({
                        type: 'answer',
                        sdp: answer.sdp
                    })

                    activeOffer.answered = true
                    this.lastPollTimestamp = answer.answeredAt

                    // Create replacement offer
                    this.fillOffers()
                }
            }

            // Process ICE candidates
            for (const [offerId, candidates] of Object.entries(result.iceCandidates)) {
                const activeOffer = this.activeOffers.get(offerId)
                if (activeOffer) {
                    const answererCandidates = candidates.filter(c => c.role === 'answerer')

                    for (const item of answererCandidates) {
                        if (item.candidate) {
                            await activeOffer.pc.addIceCandidate(new RTCIceCandidate(item.candidate))
                            this.lastPollTimestamp = Math.max(this.lastPollTimestamp, item.createdAt)
                        }
                    }
                }
            }
        } catch (err) {
            console.error('[Rondevu] Polling error:', err)
        }
    }

    /**
     * Start filling offers and polling for answers/ICE
     * Call this after publishService() to begin accepting connections
     */
    async startFilling(): Promise<void> {
        if (this.filling) {
            console.log('[Rondevu] Already filling')
            return
        }

        if (!this.currentService) {
            throw new Error('No service published. Call publishService() first.')
        }

        console.log('[Rondevu] Starting offer filling and polling')
        this.filling = true

        // Fill initial offers
        await this.fillOffers()

        // Start polling
        this.pollingInterval = setInterval(() => {
            this.pollInternal()
        }, 1000)
    }

    /**
     * Stop filling offers and polling
     * Closes all active peer connections
     */
    stopFilling(): void {
        console.log('[Rondevu] Stopping offer filling and polling')
        this.filling = false

        // Stop polling
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval)
            this.pollingInterval = null
        }

        // Close all active connections
        for (const [offerId, offer] of this.activeOffers.entries()) {
            console.log(`[Rondevu] Closing offer ${offerId}`)
            offer.dc?.close()
            offer.pc.close()
        }

        this.activeOffers.clear()
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
        const { serviceFqn, service, username, onConnection, rtcConfig } = options

        // Determine the full service FQN
        let fqn: string
        if (serviceFqn) {
            fqn = serviceFqn
        } else if (service && username) {
            fqn = `${service}@${username}`
        } else if (service) {
            // Discovery mode - get random service
            console.log(`[Rondevu] Discovering service: ${service}`)
            const discovered = await this.discoverService(service)
            fqn = discovered.serviceFqn
        } else {
            throw new Error('Either serviceFqn or service must be provided')
        }

        console.log(`[Rondevu] Connecting to service: ${fqn}`)

        // 1. Get service offer
        const serviceData = await this.api.getService(fqn)
        console.log(`[Rondevu] Found service from @${serviceData.username}`)

        // 2. Create RTCPeerConnection
        const rtcConfiguration = rtcConfig || {
            iceServers: this.iceServers
        }
        const pc = new RTCPeerConnection(rtcConfiguration)

        // 3. Set up data channel handler (answerer receives it from offerer)
        let dc: RTCDataChannel | null = null
        const dataChannelPromise = new Promise<RTCDataChannel>((resolve) => {
            pc.ondatachannel = (event) => {
                console.log('[Rondevu] Data channel received from offerer')
                dc = event.channel
                resolve(dc)
            }
        })

        // 4. Set up ICE candidate exchange
        pc.onicecandidate = async (event) => {
            if (event.candidate) {
                try {
                    await this.api.addOfferIceCandidates(
                        serviceData.serviceFqn,
                        serviceData.offerId,
                        [event.candidate.toJSON()]
                    )
                } catch (err) {
                    console.error('[Rondevu] Failed to send ICE candidate:', err)
                }
            }
        }

        // 5. Poll for remote ICE candidates
        let lastIceTimestamp = 0
        const icePollInterval = setInterval(async () => {
            try {
                const result = await this.api.getOfferIceCandidates(
                    serviceData.serviceFqn,
                    serviceData.offerId,
                    lastIceTimestamp
                )
                for (const item of result.candidates) {
                    if (item.candidate) {
                        await pc.addIceCandidate(new RTCIceCandidate(item.candidate))
                        lastIceTimestamp = item.createdAt
                    }
                }
            } catch (err) {
                console.error('[Rondevu] Failed to poll ICE candidates:', err)
            }
        }, 1000)

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
            console.log(`[Rondevu] Connection state: ${pc.connectionState}`)
            if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
                clearInterval(icePollInterval)
            }
        }

        // 10. Wait for data channel to open and call onConnection
        if (dc.readyState === 'open') {
            console.log('[Rondevu] Data channel already open')
            if (onConnection) {
                await onConnection(context)
            }
        } else {
            await new Promise<void>((resolve) => {
                dc!.addEventListener('open', async () => {
                    console.log('[Rondevu] Data channel opened')
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
     * Get service by FQN (with username) - Direct lookup
     * Example: chat:1.0.0@alice
     */
    async getService(serviceFqn: string): Promise<{
        serviceId: string
        username: string
        serviceFqn: string
        offerId: string
        sdp: string
        createdAt: number
        expiresAt: number
    }> {
        return await this.api.getService(serviceFqn)
    }

    /**
     * Discover a random available service without knowing the username
     * Example: chat:1.0.0 (without @username)
     */
    async discoverService(serviceVersion: string): Promise<{
        serviceId: string
        username: string
        serviceFqn: string
        offerId: string
        sdp: string
        createdAt: number
        expiresAt: number
    }> {
        return await this.api.getService(serviceVersion)
    }

    /**
     * Discover multiple available services with pagination
     * Example: chat:1.0.0 (without @username)
     */
    async discoverServices(serviceVersion: string, limit: number = 10, offset: number = 0): Promise<{
        services: Array<{
            serviceId: string
            username: string
            serviceFqn: string
            offerId: string
            sdp: string
            createdAt: number
            expiresAt: number
        }>
        count: number
        limit: number
        offset: number
    }> {
        return await this.api.getService(serviceVersion, { limit, offset })
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
            candidate: any
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
