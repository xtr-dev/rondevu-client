/**
 * Rondevu API Client - RPC interface
 */

import { CryptoAdapter, Credential } from '../crypto/adapter.js'
import { WebCryptoAdapter } from '../crypto/web.js'

export type { Credential } from '../crypto/adapter.js'

export interface OfferRequest {
    sdp: string
}

export interface ServiceRequest {
    serviceFqn: string // Must include username: service:version@username
    offers: OfferRequest[]
    ttl?: number
}

export interface ServiceOffer {
    offerId: string
    sdp: string
    createdAt: number
    expiresAt: number
}

export interface Service {
    serviceId: string
    offers: ServiceOffer[]
    username: string
    serviceFqn: string
    createdAt: number
    expiresAt: number
}

export interface IceCandidate {
    candidate: RTCIceCandidateInit | null
    role: 'offerer' | 'answerer'
    createdAt: number
}

/**
 * RPC request format (body only - auth in headers)
 */
interface RpcRequest {
    method: string
    params?: any
}

/**
 * RPC response format
 */
interface RpcResponse {
    success: boolean
    result?: any
    error?: string
}

/**
 * RondevuAPI - RPC-based API client for Rondevu signaling server
 */
export class RondevuAPI {
    private crypto: CryptoAdapter

    constructor(
        private baseUrl: string,
        private credential: Credential,
        cryptoAdapter?: CryptoAdapter
    ) {
        // Use WebCryptoAdapter by default (browser environment)
        this.crypto = cryptoAdapter || new WebCryptoAdapter()

        // Validate credential format early to provide clear error messages
        if (!credential.name || typeof credential.name !== 'string') {
            throw new Error('Invalid credential: name must be a non-empty string')
        }
        // Validate name format (alphanumeric, dots, underscores, hyphens only)
        if (credential.name.length > 256) {
            throw new Error('Invalid credential: name must not exceed 256 characters')
        }
        if (!/^[a-zA-Z0-9._-]+$/.test(credential.name)) {
            throw new Error('Invalid credential: name must contain only alphanumeric characters, dots, underscores, and hyphens')
        }

        // Validate secret
        if (!credential.secret || typeof credential.secret !== 'string') {
            throw new Error('Invalid credential: secret must be a non-empty string')
        }
        // Minimum 256 bits (64 hex characters) for security
        if (credential.secret.length < 64) {
            throw new Error('Invalid credential: secret must be at least 256 bits (64 hex characters)')
        }
        // Validate secret is valid hex (even length, only hex characters)
        if (credential.secret.length % 2 !== 0) {
            throw new Error('Invalid credential: secret must be a valid hex string (even length)')
        }
        if (!/^[0-9a-fA-F]+$/.test(credential.secret)) {
            throw new Error('Invalid credential: secret must contain only hexadecimal characters')
        }
    }

    /**
     * Canonical JSON serialization with sorted keys
     * Ensures deterministic output regardless of property insertion order
     */
    private canonicalJSON(obj: any): string {
        if (obj === null || obj === undefined) {
            return JSON.stringify(obj)
        }
        if (typeof obj !== 'object') {
            return JSON.stringify(obj)
        }
        if (Array.isArray(obj)) {
            return '[' + obj.map(item => this.canonicalJSON(item)).join(',') + ']'
        }
        // Sort object keys alphabetically for deterministic output
        const sortedKeys = Object.keys(obj).sort()
        const pairs = sortedKeys.map(key => {
            return JSON.stringify(key) + ':' + this.canonicalJSON(obj[key])
        })
        return '{' + pairs.join(',') + '}'
    }

    /**
     * Build signature message following server format
     * Format: timestamp:nonce:method:canonicalJSON(params || {})
     *
     * Uses canonical JSON (sorted keys) to ensure deterministic serialization
     * across different JavaScript engines and platforms.
     */
    private buildSignatureMessage(timestamp: number, nonce: string, method: string, params?: any): string {
        const paramsJson = this.canonicalJSON(params || {})
        return `${timestamp}:${nonce}:${method}:${paramsJson}`
    }

    /**
     * Generate cryptographically secure nonce
     * Uses crypto.randomUUID() if available, falls back to secure random bytes
     */
    private generateNonce(): string {
        // Prefer crypto.randomUUID() for widespread support and standard format
        // UUIDv4 provides 122 bits of entropy (6 fixed version/variant bits)
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID()
        }
        // Fallback: 16 random bytes (128 bits entropy) as hex string
        // Slightly more entropy than UUID, but both are cryptographically secure
        const randomBytes = this.crypto.randomBytes(16)
        return this.crypto.bytesToHex(randomBytes)
    }

    /**
     * Generate authentication headers for RPC request
     * Uses HMAC-SHA256 signature with nonce for replay protection
     *
     * Security notes:
     * - Nonce: Cryptographically secure random value (UUID or 128-bit hex)
     * - Timestamp: Prevents replay attacks outside the server's time window
     *   - Server validates timestamp is within acceptable range (typically ±5 minutes)
     *   - Tolerates reasonable clock skew between client and server
     *   - Requests with stale timestamps are rejected
     * - Signature: HMAC-SHA256 ensures message integrity and authenticity
     * - Server validates nonce uniqueness to prevent replay within time window
     *   - Each nonce can only be used once within the timestamp validity window
     *   - Server maintains nonce cache with expiration matching timestamp window
     */
    private async generateAuthHeaders(request: RpcRequest): Promise<Record<string, string>> {
        const timestamp = Date.now()
        const nonce = this.generateNonce()

        // Build message and generate signature
        const message = this.buildSignatureMessage(timestamp, nonce, request.method, request.params)
        const signature = await this.crypto.generateSignature(this.credential.secret, message)

        return {
            'X-Name': this.credential.name,
            'X-Timestamp': timestamp.toString(),
            'X-Nonce': nonce,
            'X-Signature': signature,
        }
    }

    /**
     * Execute RPC call
     */
    private async rpc(request: RpcRequest, authHeaders: Record<string, string>): Promise<any> {
        const response = await fetch(`${this.baseUrl}/rpc`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...authHeaders,
            },
            body: JSON.stringify(request),
        })

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }

        const result: RpcResponse = await response.json()

        if (!result.success) {
            throw new Error(result.error || 'RPC call failed')
        }

        return result.result
    }

    // ============================================
    // Credential Management
    // ============================================

    /**
     * Generate new credentials (name + secret pair)
     * This is the entry point for new users - no authentication required
     * Credentials are generated server-side to ensure security and uniqueness
     *
     * ⚠️ SECURITY NOTE:
     * - Store the returned credential securely
     * - The secret provides full access to this identity
     * - Credentials should be persisted encrypted and never logged
     *
     * @param baseUrl - Rondevu server URL
     * @param expiresAt - Optional custom expiry timestamp (defaults to 1 year)
     * @param options - Optional: { maxRetries: number, timeout: number }
     * @returns Generated credential with name and secret
     */
    static async generateCredentials(
        baseUrl: string,
        expiresAt?: number,
        options?: { maxRetries?: number; timeout?: number }
    ): Promise<Credential> {
        const maxRetries = options?.maxRetries ?? 3
        const timeout = options?.timeout ?? 30000 // 30 seconds
        let lastError: Error | null = null

        const request: RpcRequest = {
            method: 'generateCredentials',
            params: expiresAt ? { expiresAt } : undefined,
        }

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            let httpStatus: number | null = null

            try {
                // Create abort controller for timeout
                const controller = new AbortController()
                const timeoutId = setTimeout(() => controller.abort(), timeout)

                try {
                    const response = await fetch(`${baseUrl}/rpc`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify(request),
                        signal: controller.signal
                    })

                    clearTimeout(timeoutId)
                    httpStatus = response.status

                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
                    }

                    const result: RpcResponse = await response.json()

                    if (!result.success) {
                        throw new Error(result.error || 'Failed to generate credentials')
                    }

                    // Validate credential structure
                    const credential = result.result
                    if (!credential || typeof credential !== 'object') {
                        throw new Error('Invalid credential response: result is not an object')
                    }
                    if (typeof credential.name !== 'string' || !credential.name) {
                        throw new Error('Invalid credential response: missing or invalid name')
                    }
                    if (typeof credential.secret !== 'string' || !credential.secret) {
                        throw new Error('Invalid credential response: missing or invalid secret')
                    }

                    return credential as Credential
                } finally {
                    clearTimeout(timeoutId)
                }
            } catch (error) {
                lastError = error as Error

                // Don't retry on abort (timeout)
                if (error instanceof Error && error.name === 'AbortError') {
                    throw new Error(`Credential generation timed out after ${timeout}ms`)
                }

                // Don't retry on 4xx errors (client errors) - check actual status
                if (httpStatus !== null && httpStatus >= 400 && httpStatus < 500) {
                    throw error
                }

                // Retry with exponential backoff for network/server errors (5xx or network failures)
                if (attempt < maxRetries - 1) {
                    const backoffMs = 1000 * Math.pow(2, attempt)
                    await new Promise(resolve => setTimeout(resolve, backoffMs))
                }
            }
        }

        throw new Error(`Failed to generate credentials after ${maxRetries} attempts: ${lastError?.message || 'Unknown error'}`)
    }

    /**
     * Generate a random secret locally (for advanced use cases)
     * @param cryptoAdapter - Optional crypto adapter
     */
    static generateSecret(cryptoAdapter?: CryptoAdapter): string {
        const adapter = cryptoAdapter || new WebCryptoAdapter()
        return adapter.generateSecret()
    }

    // ============================================
    // Service Management
    // ============================================

    /**
     * Publish a service
     */
    async publishService(service: ServiceRequest): Promise<Service> {
        const request: RpcRequest = {
            method: 'publishOffer',
            params: {
                serviceFqn: service.serviceFqn,
                offers: service.offers,
                ttl: service.ttl,
            },
        }
        const authHeaders = await this.generateAuthHeaders(request)
        return await this.rpc(request, authHeaders)
    }

    /**
     * Get service by FQN (direct lookup, random, or paginated)
     */
    async getService(
        serviceFqn: string,
        options?: { limit?: number; offset?: number }
    ): Promise<any> {
        const request: RpcRequest = {
            method: 'getOffer',
            params: {
                serviceFqn,
                ...options,
            },
        }
        const authHeaders = await this.generateAuthHeaders(request)
        return await this.rpc(request, authHeaders)
    }

    /**
     * Delete a service
     */
    async deleteService(serviceFqn: string): Promise<void> {
        const request: RpcRequest = {
            method: 'deleteOffer',
            params: { serviceFqn },
        }
        const authHeaders = await this.generateAuthHeaders(request)
        await this.rpc(request, authHeaders)
    }

    // ============================================
    // WebRTC Signaling
    // ============================================

    /**
     * Answer an offer
     */
    async answerOffer(serviceFqn: string, offerId: string, sdp: string): Promise<void> {
        const request: RpcRequest = {
            method: 'answerOffer',
            params: { serviceFqn, offerId, sdp },
        }
        const authHeaders = await this.generateAuthHeaders(request)
        await this.rpc(request, authHeaders)
    }

    /**
     * Get answer for a specific offer (offerer polls this)
     */
    async getOfferAnswer(
        serviceFqn: string,
        offerId: string
    ): Promise<{ sdp: string; offerId: string; answererId: string; answeredAt: number } | null> {
        try {
            const request: RpcRequest = {
                method: 'getOfferAnswer',
                params: { serviceFqn, offerId },
            }
            const authHeaders = await this.generateAuthHeaders(request)
            return await this.rpc(request, authHeaders)
        } catch (err) {
            if ((err as Error).message.includes('not yet answered')) {
                return null
            }
            throw err
        }
    }

    /**
     * Combined polling for answers and ICE candidates
     */
    async poll(since?: number): Promise<{
        answers: Array<{
            offerId: string
            serviceId?: string
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
        const request: RpcRequest = {
            method: 'poll',
            params: { since },
        }
        const authHeaders = await this.generateAuthHeaders(request)
        return await this.rpc(request, authHeaders)
    }

    /**
     * Add ICE candidates to a specific offer
     */
    async addOfferIceCandidates(
        serviceFqn: string,
        offerId: string,
        candidates: RTCIceCandidateInit[]
    ): Promise<{ count: number; offerId: string }> {
        const request: RpcRequest = {
            method: 'addIceCandidates',
            params: { serviceFqn, offerId, candidates },
        }
        const authHeaders = await this.generateAuthHeaders(request)
        return await this.rpc(request, authHeaders)
    }

    /**
     * Get ICE candidates for a specific offer
     */
    async getOfferIceCandidates(
        serviceFqn: string,
        offerId: string,
        since: number = 0
    ): Promise<{ candidates: IceCandidate[]; offerId: string }> {
        const request: RpcRequest = {
            method: 'getIceCandidates',
            params: { serviceFqn, offerId, since },
        }
        const authHeaders = await this.generateAuthHeaders(request)
        const result = await this.rpc(request, authHeaders)

        return {
            candidates: result.candidates || [],
            offerId: result.offerId,
        }
    }
}
