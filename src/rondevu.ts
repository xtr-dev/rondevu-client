import { RondevuAPI, Keypair, Service, ServiceRequest, IceCandidate } from './api.js'

export interface RondevuOptions {
    apiUrl: string
    username?: string  // Optional, will generate anonymous if not provided
    keypair?: Keypair  // Optional, will generate if not provided
}

export interface PublishServiceOptions {
    serviceFqn: string // Must include @username (e.g., "chat:1.0.0@alice")
    offers: Array<{ sdp: string }>
    ttl?: number
}

/**
 * Rondevu - Complete WebRTC signaling client
 *
 * Provides a unified API for:
 * - Username claiming with Ed25519 signatures
 * - Service publishing with automatic signature generation
 * - Service discovery (direct, random, paginated)
 * - WebRTC signaling (offer/answer exchange, ICE relay)
 * - Keypair management
 *
 * @example
 * ```typescript
 * // Create Rondevu instance with username
 * const rondevu = new Rondevu({
 *   apiUrl: 'https://signal.example.com',
 *   username: 'alice',
 * })
 * await rondevu.initialize()
 * await rondevu.claimUsername()  // Claim username before publishing
 *
 * // Publish a service
 * const publishedService = await rondevu.publishService({
 *   serviceFqn: 'chat:1.0.0@alice',
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
    private api: RondevuAPI | null = null
    private readonly apiUrl: string
    private username: string
    private keypair: Keypair | null = null
    private usernameClaimed = false

    constructor(options: RondevuOptions) {
        this.apiUrl = options.apiUrl
        this.username = options.username || this.generateAnonymousUsername()
        this.keypair = options.keypair || null

        console.log('[Rondevu] Constructor called:', {
            username: this.username,
            hasKeypair: !!this.keypair,
            publicKey: this.keypair?.publicKey
        })
    }

    /**
     * Generate an anonymous username with timestamp and random component
     */
    private generateAnonymousUsername(): string {
        const timestamp = Date.now().toString(36)
        const random = Array.from(crypto.getRandomValues(new Uint8Array(3)))
            .map(b => b.toString(16).padStart(2, '0')).join('')
        return `anon-${timestamp}-${random}`
    }

    // ============================================
    // Initialization
    // ============================================

    /**
     * Initialize the service - generates keypair if not provided and creates API instance
     * Call this before using other methods
     */
    async initialize(): Promise<void> {
        console.log('[Rondevu] Initialize called, hasKeypair:', !!this.keypair)

        // Generate keypair if not provided
        if (!this.keypair) {
            console.log('[Rondevu] Generating new keypair...')
            this.keypair = await RondevuAPI.generateKeypair()
            console.log('[Rondevu] Generated keypair, publicKey:', this.keypair.publicKey)
        } else {
            console.log('[Rondevu] Using existing keypair, publicKey:', this.keypair.publicKey)
        }

        // Create API instance with username and keypair
        this.api = new RondevuAPI(this.apiUrl, this.username, this.keypair)
        console.log('[Rondevu] Created API instance with username:', this.username)
    }

    // ============================================
    // Username Management
    // ============================================

    /**
     * Claim the username with Ed25519 signature
     * Should be called once before publishing services
     */
    async claimUsername(): Promise<void> {
        if (!this.keypair) {
            throw new Error('Not initialized. Call initialize() first.')
        }

        // Check if username is already claimed
        const check = await this.getAPI().checkUsername(this.username)
        if (!check.available) {
            // Verify it's claimed by us
            if (check.publicKey === this.keypair.publicKey) {
                this.usernameClaimed = true
                return
            }
            throw new Error(`Username "${this.username}" is already claimed by another user`)
        }

        // Generate signature for username claim
        const message = `claim:${this.username}:${Date.now()}`
        const signature = await RondevuAPI.signMessage(message, this.keypair.privateKey)

        // Claim the username
        await this.getAPI().claimUsername(this.username, this.keypair.publicKey, signature, message)
        this.usernameClaimed = true
    }

    /**
     * Get API instance (creates lazily if needed)
     */
    private getAPI(): RondevuAPI {
        if (!this.api) {
            throw new Error('Not initialized. Call initialize() first.')
        }
        return this.api
    }

    /**
     * Check if username has been claimed (checks with server)
     */
    async isUsernameClaimed(): Promise<boolean> {
        if (!this.keypair) {
            return false
        }

        try {
            const check = await this.getAPI().checkUsername(this.username)

            // Debug logging
            console.log('[Rondevu] Username check:', {
                username: this.username,
                available: check.available,
                serverPublicKey: check.publicKey,
                localPublicKey: this.keypair.publicKey,
                match: check.publicKey === this.keypair.publicKey
            })

            // Username is claimed if it's not available and owned by our public key
            const claimed = !check.available && check.publicKey === this.keypair.publicKey

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
     */
    async publishService(options: PublishServiceOptions): Promise<Service> {
        if (!this.keypair) {
            throw new Error('Not initialized. Call initialize() first.')
        }

        if (!this.usernameClaimed) {
            throw new Error(
                'Username not claimed. Call claimUsername() first or the server will reject the service.'
            )
        }

        const { serviceFqn, offers, ttl } = options

        // Generate signature for service publication
        const message = `publish:${this.username}:${serviceFqn}:${Date.now()}`
        const signature = await RondevuAPI.signMessage(message, this.keypair.privateKey)

        // Create service request
        const serviceRequest: ServiceRequest = {
            serviceFqn, // Must include @username
            offers,
            signature,
            message,
            ttl,
        }

        // Publish to server
        return await this.getAPI().publishService(serviceRequest)
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
        return await this.getAPI().getService(serviceFqn)
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
        return await this.getAPI().discoverService(serviceVersion)
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
        return await this.getAPI().discoverServices(serviceVersion, limit, offset)
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
        return await this.getAPI().postOfferAnswer(serviceFqn, offerId, sdp)
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
        return await this.getAPI().getOfferAnswer(serviceFqn, offerId)
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
        return await this.getAPI().poll(since)
    }

    /**
     * Add ICE candidates to specific offer
     */
    async addOfferIceCandidates(serviceFqn: string, offerId: string, candidates: RTCIceCandidateInit[]): Promise<{
        count: number
        offerId: string
    }> {
        return await this.getAPI().addOfferIceCandidates(serviceFqn, offerId, candidates)
    }

    /**
     * Get ICE candidates for specific offer (with polling support)
     */
    async getOfferIceCandidates(serviceFqn: string, offerId: string, since: number = 0): Promise<{
        candidates: IceCandidate[]
        offerId: string
    }> {
        return await this.getAPI().getOfferIceCandidates(serviceFqn, offerId, since)
    }

    // ============================================
    // Utility Methods
    // ============================================

    /**
     * Get the current keypair (for backup/storage)
     */
    getKeypair(): Keypair | null {
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
    getPublicKey(): string | null {
        return this.keypair?.publicKey || null
    }

    /**
     * Access to underlying API for advanced operations
     * @deprecated Use direct methods on Rondevu instance instead
     */
    getAPIPublic(): RondevuAPI {
        if (!this.api) {
            throw new Error('Not initialized. Call initialize() first.')
        }
        return this.api
    }
}
