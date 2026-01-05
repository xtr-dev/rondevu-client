import { RondevuAPI, Credential, IceCandidate } from '../api/client.js'
import { CryptoAdapter } from '../crypto/adapter.js'
import { WebRTCAdapter } from '../webrtc/adapter.js'
import { BrowserWebRTCAdapter } from '../webrtc/browser.js'
import { EventEmitter } from 'eventemitter3'
import { OffererConnection } from '../connections/offerer.js'
import { AnswererConnection } from '../connections/answerer.js'
import { ConnectionConfig } from '../connections/config.js'
import { OfferPool } from './offer-pool.js'
import { Peer, PeerOptions } from './peer.js'
import { getIceConfiguration } from './ice-config.js'
import { PollingManager, PollAnswerEvent, PollIceEvent } from './polling-manager.js'

// Import types from split files
import type {
    RondevuOptions,
    OfferContext,
    OfferFactory,
    OfferOptions,
    OfferHandle,
    ConnectionContext,
    DiscoverOptions,
    DiscoveredOffer,
    DiscoverResult,
} from './rondevu-types.js'

// Re-export all types for backward compatibility
export type {
    RondevuOptions,
    OfferContext,
    OfferFactory,
    OfferOptions,
    OfferHandle,
    ConnectionContext,
    DiscoverOptions,
    DiscoveredOffer,
    DiscoverResult,
} from './rondevu-types.js'

// Re-export ICE config for backward compatibility
export { ICE_SERVER_PRESETS } from './ice-config.js'
export type { IceServerPreset, IcePresetConfig } from './ice-config.js'

// Re-export polling types
export type { PollAnswerEvent, PollIceEvent } from './polling-manager.js'

/**
 * Rondevu - Complete WebRTC signaling client with durable connections
 *
 * Uses a tags-based discovery system where offers have 1+ tags for matching.
 *
 * @example
 * ```typescript
 * // Create and initialize Rondevu instance with preset ICE servers
 * const rondevu = await Rondevu.connect({
 *   apiUrl: 'https://signal.example.com',
 *   iceServers: 'ipv4-turn'  // Use preset: 'ipv4-turn', 'hostname-turns', 'google-stun', or 'relay-only'
 * })
 *
 * // Create offers with tags for discovery
 * await rondevu.offer({
 *   tags: ['chat', 'video'],
 *   maxOffers: 5  // Maintain up to 5 concurrent offers
 * })
 *
 * // Start accepting connections (auto-fills offers and polls)
 * await rondevu.startFilling()
 *
 * // Listen for connections
 * rondevu.on('connection:opened', (offerId, connection) => {
 *   connection.on('connected', () => console.log('Connected!'))
 *   connection.on('message', (data) => console.log('Received:', data))
 *   connection.send('Hello!')
 * })
 *
 * // Connect by discovering offers with matching tags
 * const connection = await rondevu.connect({
 *   tags: ['chat']
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
    private static readonly DEFAULT_API_URL = 'https://api.ronde.vu'
    private static readonly DEFAULT_TTL_MS = 300000 // 5 minutes
    private static readonly POLLING_INTERVAL_MS = 1000 // 1 second

    private api: RondevuAPI
    private readonly apiUrl: string
    private credential: Credential
    private cryptoAdapter?: CryptoAdapter
    private webrtcAdapter: WebRTCAdapter
    private iceServers: RTCIceServer[]
    private iceTransportPolicy?: RTCIceTransportPolicy
    private debugEnabled: boolean

    // Publishing state
    private currentTags: string[] | null = null
    private connectionConfig?: Partial<ConnectionConfig>
    private offerPool: OfferPool | null = null

    // Centralized polling
    private pollingManager: PollingManager

    private constructor(
        apiUrl: string,
        credential: Credential,
        api: RondevuAPI,
        iceServers: RTCIceServer[],
        iceTransportPolicy: RTCIceTransportPolicy | undefined,
        webrtcAdapter: WebRTCAdapter,
        cryptoAdapter?: CryptoAdapter,
        debugEnabled = false
    ) {
        super()
        this.apiUrl = apiUrl
        this.credential = credential
        this.api = api
        this.iceServers = iceServers
        this.iceTransportPolicy = iceTransportPolicy
        this.webrtcAdapter = webrtcAdapter
        this.cryptoAdapter = cryptoAdapter
        this.debugEnabled = debugEnabled

        // Initialize centralized polling manager
        this.pollingManager = new PollingManager({
            api: this.api,
            debugEnabled: this.debugEnabled,
        })

        // Forward polling events to Rondevu instance
        this.pollingManager.on('poll:answer', data => {
            this.emit('poll:answer', data)
        })
        this.pollingManager.on('poll:ice', data => {
            this.emit('poll:ice', data)
        })

        this.debug('Instance created:', {
            name: this.credential.name,
            hasIceServers: iceServers.length > 0,
            iceTransportPolicy: iceTransportPolicy || 'all',
        })
    }

    /**
     * Internal debug logging - only logs if debug mode is enabled
     */
    private debug(message: string, ...args: unknown[]): void {
        if (this.debugEnabled) {
            console.log(`[Rondevu] ${message}`, ...args)
        }
    }

    /**
     * Create and initialize a Rondevu client
     *
     * @example
     * ```typescript
     * const rondevu = await Rondevu.connect({})  // Uses default API URL
     * // or
     * const rondevu = await Rondevu.connect({
     *   apiUrl: 'https://custom.api.com'
     * })
     * ```
     */
    static async connect(options: RondevuOptions = {}): Promise<Rondevu> {
        const apiUrl = options.apiUrl || Rondevu.DEFAULT_API_URL

        // Use provided WebRTC adapter or default to browser adapter
        const webrtcAdapter = options.webrtcAdapter || new BrowserWebRTCAdapter()

        // Handle preset string or custom array, extracting iceTransportPolicy if present
        const iceConfig = getIceConfiguration(options.iceServers)

        if (options.debug) {
            console.log('[Rondevu] Connecting:', {
                apiUrl,
                hasCredential: !!options.credential,
                iceServers: iceConfig.iceServers?.length ?? 0,
                iceTransportPolicy: iceConfig.iceTransportPolicy || 'all',
            })
        }

        // Generate credential if not provided
        let credential = options.credential
        if (!credential) {
            if (options.debug) console.log('[Rondevu] Generating new credentials...')
            credential = await RondevuAPI.generateCredentials(apiUrl, {
                name: options.username, // Will claim this username if provided
            })
            if (options.debug)
                console.log('[Rondevu] Generated credentials, name:', credential.name)
        } else {
            if (options.debug)
                console.log('[Rondevu] Using existing credential, name:', credential.name)
        }

        // Create API instance
        const api = new RondevuAPI(apiUrl, credential, options.cryptoAdapter)
        if (options.debug) console.log('[Rondevu] Created API instance')

        return new Rondevu(
            apiUrl,
            credential,
            api,
            iceConfig.iceServers || [],
            iceConfig.iceTransportPolicy,
            webrtcAdapter,
            options.cryptoAdapter,
            options.debug || false
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

    /**
     * Get the WebRTC adapter for creating peer connections
     * Used internally by offer pool and connections
     */
    getWebRTCAdapter(): WebRTCAdapter {
        return this.webrtcAdapter
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
     * Create offers with tags for discovery (offerer/host side)
     * Auto-starts filling by default. Use the returned object to cancel.
     *
     * @example
     * ```typescript
     * // Auto-start (default)
     * const offer = await rondevu.offer({
     *   tags: ['chat', 'video'],
     *   maxOffers: 5
     * })
     * // Later: offer.cancel() to stop
     *
     * // Manual start
     * await rondevu.offer({ tags: ['chat'], maxOffers: 5, autoStart: false })
     * await rondevu.startFilling()
     * ```
     */
    async offer(options: OfferOptions): Promise<OfferHandle> {
        const { tags, maxOffers, offerFactory, ttl, connectionConfig, autoStart = true } = options

        this.currentTags = tags
        this.connectionConfig = connectionConfig

        this.debug(`Creating offers with tags: ${tags.join(', ')} with maxOffers: ${maxOffers}`)

        // Create OfferPool
        this.offerPool = new OfferPool({
            api: this.api,
            tags,
            ownerUsername: this.credential.name,
            maxOffers,
            offerFactory: offerFactory || this.defaultOfferFactory.bind(this),
            ttl: ttl || Rondevu.DEFAULT_TTL_MS,
            iceServers: this.iceServers,
            iceTransportPolicy: this.iceTransportPolicy,
            webrtcAdapter: this.webrtcAdapter,
            connectionConfig,
            debugEnabled: this.debugEnabled,
        })

        // Forward events from OfferPool
        this.offerPool.on('connection:opened', (offerId, connection, matchedTags) => {
            this.emit('connection:opened', offerId, connection, matchedTags)
        })

        this.offerPool.on('offer:created', (offerId, tags) => {
            this.emit('offer:created', offerId, tags)
        })

        this.offerPool.on('connection:rotated', (oldOfferId, newOfferId, connection) => {
            this.emit('connection:rotated', oldOfferId, newOfferId, connection)
        })

        // Subscribe to polling events and forward to OfferPool
        this.on('poll:answer', data => {
            this.offerPool?.handlePollAnswer(data)
        })
        this.on('poll:ice', data => {
            this.offerPool?.handlePollIce(data)
        })

        // Auto-start if enabled (default)
        if (autoStart) {
            await this.startFilling()
        }

        // Return handle for cancellation
        return {
            cancel: () => this.stopFilling(),
        }
    }

    /**
     * Start filling offers and polling for answers/ICE
     * Call this after offer() to begin accepting connections
     */
    async startFilling(): Promise<void> {
        if (!this.offerPool) {
            throw new Error('No offers created. Call offer() first.')
        }

        this.debug('Starting offer filling and polling')

        // Start the centralized polling manager
        this.pollingManager.start()

        await this.offerPool.start()
    }

    /**
     * Stop filling offers and polling
     * Closes all active peer connections
     */
    stopFilling(): void {
        this.debug('Stopping offer filling and polling')

        // Stop the centralized polling manager
        this.pollingManager.stop()

        this.offerPool?.stop()
    }

    /**
     * Start the centralized polling manager
     * Use this when you need polling without offers (e.g., answerer connections)
     */
    startPolling(): void {
        this.debug('Starting polling manager')
        this.pollingManager.start()
    }

    /**
     * Stop the centralized polling manager
     */
    stopPolling(): void {
        this.debug('Stopping polling manager')
        this.pollingManager.stop()
    }

    /**
     * Check if polling is active
     */
    isPolling(): boolean {
        return this.pollingManager.isRunning()
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
     * Update tags for new offers
     * Existing offers keep their old tags until they expire/rotate
     * New offers created during fill will use the updated tags
     * @param newTags - The new tags to use for future offers
     */
    updateOfferTags(newTags: string[]): void {
        this.debug(`Updating offer tags: ${newTags.join(', ')}`)
        this.currentTags = newTags
        this.offerPool?.updateTags(newTags)
    }

    /**
     * Get the current publishing status
     * @returns Object with publishing state information
     */
    getPublishStatus(): { active: boolean; offerCount: number; tags: string[] | null } {
        return {
            active: this.currentTags !== null,
            offerCount: this.offerPool?.getOfferCount() ?? 0,
            tags: this.currentTags,
        }
    }

    /**
     * Create a peer connection with simplified DX
     * Returns a Peer object with clean state management and events
     *
     * @example
     * ```typescript
     * // Connect to any peer matching tags
     * const peer = await rondevu.peer({ tags: ['chat'] })
     *
     * // Connect to specific user
     * const peer = await rondevu.peer({
     *   username: 'alice',
     *   tags: ['chat']
     * })
     *
     * peer.on('open', () => {
     *   console.log('Connected to', peer.peerUsername)
     *   peer.send('Hello!')
     * })
     *
     * peer.on('message', (data) => {
     *   console.log('Received:', data)
     * })
     *
     * peer.on('state', (state, prevState) => {
     *   console.log(`State: ${prevState} → ${state}`)
     * })
     *
     * // Access underlying RTCPeerConnection
     * if (peer.peerConnection) {
     *   console.log('ICE state:', peer.peerConnection.iceConnectionState)
     * }
     * ```
     */
    async peer(options: PeerOptions): Promise<Peer> {
        const peer = new Peer({
            ...options,
            api: this.api,
            iceServers: this.iceServers,
            iceTransportPolicy: this.iceTransportPolicy,
            webrtcAdapter: this.webrtcAdapter,
            debug: this.debugEnabled,
        })

        await peer.initialize()

        // Subscribe to poll:ice events for this peer's connection
        const peerOfferId = peer.offerId
        const peerConnection = peer.getConnection()

        if (peerConnection) {
            const pollIceHandler = (data: PollIceEvent) => {
                if (data.offerId === peerOfferId) {
                    peerConnection.handleRemoteIceCandidates(data.candidates)
                }
            }
            this.on('poll:ice', pollIceHandler)

            // Clean up handler when connection closes
            peerConnection.on('closed', () => {
                this.off('poll:ice', pollIceHandler)
            })
        }

        // Start polling if not already running
        if (!this.pollingManager.isRunning()) {
            this.debug('Starting polling for peer connection')
            this.pollingManager.start()
        }

        return peer
    }

    // ============================================
    // Discovery
    // ============================================

    /**
     * Discover offers by tags
     *
     * @param tags - Tags to search for (OR logic - matches any tag)
     * @param options - Discovery options (pagination)
     *
     * @example
     * ```typescript
     * // Discover offers matching any of the tags
     * const result = await rondevu.discover(['chat', 'video'])
     *
     * // Paginated discovery
     * const result = await rondevu.discover(['chat'], {
     *   limit: 20,
     *   offset: 0
     * })
     *
     * // Access offers
     * for (const offer of result.offers) {
     *   console.log(offer.username, offer.tags)
     * }
     * ```
     */
    async discover(tags: string[], options?: DiscoverOptions): Promise<DiscoverResult> {
        const { limit = 10, offset = 0 } = options || {}
        // Always pass limit to ensure we get DiscoverResponse (paginated mode)
        return (await this.api.discover({ tags, limit, offset })) as DiscoverResult
    }

    // ============================================
    // WebRTC Signaling
    // ============================================

    /**
     * Post answer SDP to specific offer
     */
    async postOfferAnswer(
        offerId: string,
        sdp: string
    ): Promise<{
        success: boolean
        offerId: string
    }> {
        await this.api.answerOffer(offerId, sdp)
        return { success: true, offerId }
    }

    /**
     * Get answer SDP (offerer polls this)
     */
    async getOfferAnswer(offerId: string): Promise<{
        sdp: string
        offerId: string
        answererId: string
        answeredAt: number
    } | null> {
        return await this.api.getOfferAnswer(offerId)
    }

    /**
     * Combined polling for answers and ICE candidates
     * Returns all answered offers and ICE candidates for all peer's offers since timestamp
     */
    async poll(since?: number): Promise<{
        answers: Array<{
            offerId: string
            answererId: string
            sdp: string
            answeredAt: number
        }>
        iceCandidates: Record<
            string,
            Array<{
                candidate: RTCIceCandidateInit | null
                role: 'offerer' | 'answerer'
                peerId: string
                createdAt: number
            }>
        >
    }> {
        return await this.api.poll(since)
    }

    /**
     * Add ICE candidates to specific offer
     */
    async addOfferIceCandidates(
        offerId: string,
        candidates: RTCIceCandidateInit[]
    ): Promise<{
        count: number
        offerId: string
    }> {
        return await this.api.addOfferIceCandidates(offerId, candidates)
    }

    /**
     * Get ICE candidates for specific offer (with polling support)
     */
    async getOfferIceCandidates(
        offerId: string,
        since: number = 0
    ): Promise<{
        candidates: IceCandidate[]
        offerId: string
    }> {
        return await this.api.getOfferIceCandidates(offerId, since)
    }

    // ============================================
    // Utility Methods
    // ============================================

    /**
     * Get active connections (for offerer side)
     */
    getActiveConnections(): Map<string, OffererConnection> {
        return this.offerPool?.getActiveConnections() ?? new Map()
    }
}
