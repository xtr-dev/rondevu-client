import { RondevuAPI, Keypair, Service, ServiceRequest, IceCandidate, BatcherOptions } from './api.js'
import { CryptoAdapter } from './crypto-adapter.js'

export interface RondevuOptions {
    apiUrl: string
    username?: string  // Optional, will generate anonymous if not provided
    keypair?: Keypair  // Optional, will generate if not provided
    cryptoAdapter?: CryptoAdapter  // Optional, defaults to WebCryptoAdapter
    batching?: BatcherOptions | false  // Optional, defaults to enabled with default options
}

export interface PublishServiceOptions {
    service: string // Service name and version (e.g., "chat:2.0.0") - username will be auto-appended
    offers: Array<{ sdp: string }>
    ttl?: number
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
 * // Create and initialize Rondevu instance
 * const rondevu = await Rondevu.connect({
 *   apiUrl: 'https://signal.example.com',
 *   username: 'alice',
 * })
 *
 * // Publish a service (username auto-claimed on first publish)
 * const publishedService = await rondevu.publishService({
 *   service: 'chat:1.0.0',
 *   offers: [{ sdp: offerSdp }],
 *   ttl: 300000,
 * })
 *
 * // Discover a service
 * const service = await rondevu.getService('chat:1.0.0@bob')
 *
 * // Post answer
 * await rondevu.postOfferAnswer(service.serviceFqn, service.offerId, answerSdp)
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

    private constructor(
        apiUrl: string,
        username: string,
        keypair: Keypair,
        api: RondevuAPI,
        cryptoAdapter?: CryptoAdapter,
        batchingOptions?: BatcherOptions | false
    ) {
        this.apiUrl = apiUrl
        this.username = username
        this.keypair = keypair
        this.api = api
        this.cryptoAdapter = cryptoAdapter
        this.batchingOptions = batchingOptions

        console.log('[Rondevu] Instance created:', {
            username: this.username,
            publicKey: this.keypair.publicKey,
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

        console.log('[Rondevu] Connecting:', {
            username,
            hasKeypair: !!options.keypair,
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
     * Publish a service with automatic signature generation
     * Username will be automatically claimed on first publish if not already claimed
     */
    async publishService(options: PublishServiceOptions): Promise<Service> {
        const { service, offers, ttl } = options

        // Auto-append username to service
        const serviceFqn = `${service}@${this.username}`

        // Publish to server (server will auto-claim username if needed)
        // Note: signature and message are generated by the API layer
        const result = await this.api.publishService({
            serviceFqn,
            offers,
            ttl,
            signature: '', // Not used, generated by API layer
            message: '',   // Not used, generated by API layer
        })

        // Mark username as claimed after successful publish
        this.usernameClaimed = true

        return result
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
