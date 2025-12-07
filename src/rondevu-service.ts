import { RondevuAPI, Credentials, Keypair, Service, ServiceRequest } from './api.js'

export interface RondevuServiceOptions {
    apiUrl: string
    username: string
    keypair?: Keypair
    credentials?: Credentials
}

export interface PublishServiceOptions {
    serviceFqn: string
    offers: Array<{ sdp: string }>
    ttl?: number
    isPublic?: boolean
    metadata?: Record<string, any>
}

/**
 * RondevuService - High-level service management with automatic signature handling
 *
 * Provides a simplified API for:
 * - Username claiming with Ed25519 signatures
 * - Service publishing with automatic signature generation
 * - Keypair management
 *
 * @example
 * ```typescript
 * // Initialize service (generates keypair automatically)
 * const service = new RondevuService({
 *   apiUrl: 'https://signal.example.com',
 *   username: 'myusername',
 * })
 *
 * await service.initialize()
 *
 * // Claim username (one time)
 * await service.claimUsername()
 *
 * // Publish a service
 * const publishedService = await service.publishService({
 *   serviceFqn: 'chat.app@1.0.0',
 *   offers: [{ sdp: offerSdp }],
 *   ttl: 300000,
 *   isPublic: true,
 * })
 * ```
 */
export class RondevuService {
    private readonly api: RondevuAPI
    private readonly username: string
    private keypair: Keypair | null = null
    private usernameClaimed = false

    constructor(options: RondevuServiceOptions) {
        this.username = options.username
        this.keypair = options.keypair || null
        this.api = new RondevuAPI(options.apiUrl, options.credentials)
    }

    /**
     * Initialize the service - generates keypair if not provided
     * Call this before using other methods
     */
    async initialize(): Promise<void> {
        if (!this.keypair) {
            this.keypair = await RondevuAPI.generateKeypair()
        }

        // Register with API if no credentials provided
        if (!this.api['credentials']) {
            const credentials = await this.api.register()
            this.api.setCredentials(credentials)
        }
    }

    /**
     * Claim the username with Ed25519 signature
     * Should be called once before publishing services
     */
    async claimUsername(): Promise<void> {
        if (!this.keypair) {
            throw new Error('Service not initialized. Call initialize() first.')
        }

        // Check if username is already claimed
        const check = await this.api.checkUsername(this.username)
        if (!check.available) {
            // Verify it's claimed by us
            if (check.owner === this.keypair.publicKey) {
                this.usernameClaimed = true
                return
            }
            throw new Error(`Username "${this.username}" is already claimed by another user`)
        }

        // Generate signature for username claim
        const message = `claim:${this.username}:${Date.now()}`
        const signature = await RondevuAPI.signMessage(message, this.keypair.privateKey)

        // Claim the username
        await this.api.claimUsername(this.username, this.keypair.publicKey, signature, message)
        this.usernameClaimed = true
    }

    /**
     * Publish a service with automatic signature generation
     */
    async publishService(options: PublishServiceOptions): Promise<Service> {
        if (!this.keypair) {
            throw new Error('Service not initialized. Call initialize() first.')
        }

        if (!this.usernameClaimed) {
            throw new Error(
                'Username not claimed. Call claimUsername() first or the server will reject the service.'
            )
        }

        const { serviceFqn, offers, ttl, isPublic, metadata } = options

        // Generate signature for service publication
        const message = `publish:${this.username}:${serviceFqn}:${Date.now()}`
        const signature = await RondevuAPI.signMessage(message, this.keypair.privateKey)

        // Create service request
        const serviceRequest: ServiceRequest = {
            username: this.username,
            serviceFqn,
            offers,
            signature,
            message,
            ttl,
            isPublic,
            metadata,
        }

        // Publish to server
        return await this.api.publishService(serviceRequest)
    }

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
     * Check if username has been claimed
     */
    isUsernameClaimed(): boolean {
        return this.usernameClaimed
    }

    /**
     * Access to underlying API for advanced operations
     */
    getAPI(): RondevuAPI {
        return this.api
    }
}
