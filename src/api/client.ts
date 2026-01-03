/**
 * Rondevu API Client - RPC interface
 */

import { CryptoAdapter, Credential } from '../crypto/adapter.js'
import { WebCryptoAdapter } from '../crypto/web.js'
import { RpcBatcher, BatcherOptions } from './batcher.js'

export type { Credential } from '../crypto/adapter.js'
export type { BatcherOptions } from './batcher.js'

export interface OfferRequest {
    sdp: string
}

// ===== Tags-based API (v2) =====

export interface PublishRequest {
    tags: string[]
    offers: OfferRequest[]
    ttl?: number
}

export interface DiscoverRequest {
    tags: string[]
    limit?: number
    offset?: number
}

export interface TaggedOffer {
    offerId: string
    username: string
    tags: string[]
    sdp: string
    createdAt: number
    expiresAt: number
}

export interface DiscoverResponse {
    offers: TaggedOffer[]
    count: number
    limit: number
    offset: number
}

export interface PublishResponse {
    username: string
    tags: string[]
    offers: Array<{
        offerId: string
        sdp: string
        createdAt: number
        expiresAt: number
    }>
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
    // Default values for credential generation
    private static readonly DEFAULT_MAX_RETRIES = 3
    private static readonly DEFAULT_TIMEOUT_MS = 30000 // 30 seconds
    private static readonly DEFAULT_CREDENTIAL_NAME_MAX_LENGTH = 128
    private static readonly DEFAULT_SECRET_MIN_LENGTH = 64 // 256 bits
    private static readonly MAX_BACKOFF_MS = 60000 // 60 seconds max backoff
    private static readonly MAX_CANONICALIZE_DEPTH = 100 // Prevent stack overflow

    private crypto: CryptoAdapter
    private batcher: RpcBatcher

    constructor(
        private baseUrl: string,
        private credential: Credential,
        cryptoAdapter?: CryptoAdapter,
        batcherOptions?: BatcherOptions
    ) {
        // Use WebCryptoAdapter by default (browser environment)
        this.crypto = cryptoAdapter || new WebCryptoAdapter()
        // Create batcher for request batching with throttling
        this.batcher = new RpcBatcher(baseUrl, batcherOptions)

        // Validate credential format early to provide clear error messages
        if (!credential.name || typeof credential.name !== 'string') {
            throw new Error('Invalid credential: name must be a non-empty string')
        }
        // Validate name format (alphanumeric, dots, underscores, hyphens only)
        // Limit to prevent HTTP header size issues
        if (credential.name.length > RondevuAPI.DEFAULT_CREDENTIAL_NAME_MAX_LENGTH) {
            throw new Error(
                `Invalid credential: name must not exceed ${RondevuAPI.DEFAULT_CREDENTIAL_NAME_MAX_LENGTH} characters`
            )
        }
        if (!/^[a-zA-Z0-9._-]+$/.test(credential.name)) {
            throw new Error(
                'Invalid credential: name must contain only alphanumeric characters, dots, underscores, and hyphens'
            )
        }

        // Validate secret
        if (!credential.secret || typeof credential.secret !== 'string') {
            throw new Error('Invalid credential: secret must be a non-empty string')
        }
        // Minimum 256 bits (64 hex characters) for security
        if (credential.secret.length < RondevuAPI.DEFAULT_SECRET_MIN_LENGTH) {
            throw new Error(
                `Invalid credential: secret must be at least 256 bits (${RondevuAPI.DEFAULT_SECRET_MIN_LENGTH} hex characters)`
            )
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
    private canonicalJSON(obj: any, depth: number = 0): string {
        // Prevent stack overflow from deeply nested objects
        if (depth > RondevuAPI.MAX_CANONICALIZE_DEPTH) {
            throw new Error('Object nesting too deep for canonicalization')
        }

        // Handle null
        if (obj === null) {
            return 'null'
        }

        // Handle undefined
        if (obj === undefined) {
            return JSON.stringify(undefined)
        }

        // Validate primitive types
        const type = typeof obj

        // Reject unsupported types
        if (type === 'function') {
            throw new Error('Functions are not supported in RPC parameters')
        }
        if (type === 'symbol' || type === 'bigint') {
            throw new Error(`${type} is not supported in RPC parameters`)
        }

        // Validate numbers (reject NaN and Infinity)
        if (type === 'number' && !Number.isFinite(obj)) {
            throw new Error('NaN and Infinity are not supported in RPC parameters')
        }

        // Handle primitives (string, number, boolean)
        if (type !== 'object') {
            return JSON.stringify(obj)
        }

        // Handle arrays recursively
        if (Array.isArray(obj)) {
            return '[' + obj.map(item => this.canonicalJSON(item, depth + 1)).join(',') + ']'
        }

        // Handle objects - sort keys alphabetically for deterministic output
        const sortedKeys = Object.keys(obj).sort()
        const pairs = sortedKeys.map(key => {
            return JSON.stringify(key) + ':' + this.canonicalJSON(obj[key], depth + 1)
        })
        return '{' + pairs.join(',') + '}'
    }

    /**
     * Build signature message following server format
     * Format: timestamp:nonce:method:canonicalJSON(params || {})
     *
     * Uses canonical JSON (sorted keys) to ensure deterministic serialization
     * across different JavaScript engines and platforms.
     *
     * Note: When params is undefined, it's serialized as "{}" (empty object).
     * This matches the server's expectation for parameterless RPC calls.
     */
    private buildSignatureMessage(
        timestamp: number,
        nonce: string,
        method: string,
        params?: any
    ): string {
        if (!method || typeof method !== 'string') {
            throw new Error('Invalid method: must be a non-empty string')
        }
        const paramsJson = this.canonicalJSON(params || {})
        return `${timestamp}:${nonce}:${method}:${paramsJson}`
    }

    /**
     * Generate cryptographically secure nonce
     * Uses crypto.randomUUID() if available, falls back to secure random bytes
     *
     * Note: this.crypto is always initialized in constructor (WebCryptoAdapter or NodeCryptoAdapter)
     * and TypeScript enforces that both implement randomBytes(), so the fallback is always safe.
     */
    private generateNonce(): string {
        // Get crypto object from global scope (supports various contexts)
        // In browsers: window.crypto or self.crypto
        // In modern environments: global crypto
        const globalCrypto =
            typeof crypto !== 'undefined'
                ? crypto
                : (typeof window !== 'undefined' && window.crypto) ||
                  (typeof self !== 'undefined' && self.crypto) ||
                  undefined

        // Prefer crypto.randomUUID() for widespread support and standard format
        // UUIDv4 provides 122 bits of entropy (6 fixed version/variant bits)
        if (globalCrypto && typeof globalCrypto.randomUUID === 'function') {
            return globalCrypto.randomUUID()
        }

        // Fallback: 16 random bytes (128 bits entropy) as hex string
        // Slightly more entropy than UUID, but both are cryptographically secure
        // Safe because this.crypto is guaranteed to implement CryptoAdapter interface
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
     * Execute RPC call via batcher
     * Requests are batched with throttling for efficiency
     */
    private async rpc(request: RpcRequest, authHeaders: Record<string, string>): Promise<any> {
        return this.batcher.add(request, authHeaders)
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
        options?: {
            name?: string // Optional: claim specific username
            expiresAt?: number
            maxRetries?: number
            timeout?: number
        }
    ): Promise<Credential> {
        const maxRetries = options?.maxRetries ?? RondevuAPI.DEFAULT_MAX_RETRIES
        const timeout = options?.timeout ?? RondevuAPI.DEFAULT_TIMEOUT_MS
        let lastError: Error | null = null

        // Build params object with optional name and expiresAt
        const params: { name?: string; expiresAt?: number } = {}
        if (options?.name) params.name = options.name
        if (options?.expiresAt) params.expiresAt = options.expiresAt

        const request: RpcRequest = {
            method: 'generateCredentials',
            params: Object.keys(params).length > 0 ? params : undefined,
        }

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            // httpStatus is scoped to each iteration intentionally - resets on each retry
            let httpStatus: number | null = null

            try {
                // Create abort controller for timeout
                if (typeof AbortController === 'undefined') {
                    throw new Error('AbortController not supported in this environment')
                }
                const controller = new AbortController()
                const timeoutId = setTimeout(() => controller.abort(), timeout)

                try {
                    const response = await fetch(`${baseUrl}/rpc`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify([request]), // Server expects array (batch format)
                        signal: controller.signal,
                    })

                    httpStatus = response.status

                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
                    }

                    // Server returns array of responses
                    const results: RpcResponse[] = await response.json()
                    const result = results[0]

                    if (!result || !result.success) {
                        throw new Error(result?.error || 'Failed to generate credentials')
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
                    // Always clear timeout to prevent memory leaks
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

                // Retry with exponential backoff + jitter for network/server errors (5xx or network failures)
                // Jitter prevents thundering herd when many clients retry simultaneously
                // Cap backoff to prevent excessive waits
                if (attempt < maxRetries - 1) {
                    const backoffMs = Math.min(
                        1000 * Math.pow(2, attempt) + Math.random() * 1000,
                        RondevuAPI.MAX_BACKOFF_MS
                    )
                    await new Promise(resolve => setTimeout(resolve, backoffMs))
                }
            }
        }

        throw new Error(
            `Failed to generate credentials after ${maxRetries} attempts: ${lastError?.message || 'Unknown error'}`
        )
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
    // Tags-based Offer Management (v2)
    // ============================================

    /**
     * Publish offers with tags
     */
    async publish(request: PublishRequest): Promise<PublishResponse> {
        const rpcRequest: RpcRequest = {
            method: 'publishOffer',
            params: {
                tags: request.tags,
                offers: request.offers,
                ttl: request.ttl,
            },
        }
        const authHeaders = await this.generateAuthHeaders(rpcRequest)
        return await this.rpc(rpcRequest, authHeaders)
    }

    /**
     * Discover offers by tags
     * @param request - Discovery request with tags and optional pagination
     * @returns Paginated response if limit provided, single offer if not
     */
    async discover(request: DiscoverRequest): Promise<DiscoverResponse | TaggedOffer> {
        const rpcRequest: RpcRequest = {
            method: 'discover',
            params: {
                tags: request.tags,
                limit: request.limit,
                offset: request.offset,
            },
        }
        const authHeaders = await this.generateAuthHeaders(rpcRequest)
        return await this.rpc(rpcRequest, authHeaders)
    }

    /**
     * Delete an offer by ID
     */
    async deleteOffer(offerId: string): Promise<{ success: boolean }> {
        const request: RpcRequest = {
            method: 'deleteOffer',
            params: { offerId },
        }
        const authHeaders = await this.generateAuthHeaders(request)
        return await this.rpc(request, authHeaders)
    }

    // ============================================
    // WebRTC Signaling
    // ============================================

    /**
     * Answer an offer
     */
    async answerOffer(offerId: string, sdp: string): Promise<void> {
        const request: RpcRequest = {
            method: 'answerOffer',
            params: { offerId, sdp },
        }
        const authHeaders = await this.generateAuthHeaders(request)
        await this.rpc(request, authHeaders)
    }

    /**
     * Get answer for a specific offer (offerer polls this)
     */
    async getOfferAnswer(
        offerId: string
    ): Promise<{ sdp: string; offerId: string; answererId: string; answeredAt: number } | null> {
        try {
            const request: RpcRequest = {
                method: 'getOfferAnswer',
                params: { offerId },
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
        offerId: string,
        candidates: RTCIceCandidateInit[]
    ): Promise<{ count: number; offerId: string }> {
        const request: RpcRequest = {
            method: 'addIceCandidates',
            params: { offerId, candidates },
        }
        const authHeaders = await this.generateAuthHeaders(request)
        return await this.rpc(request, authHeaders)
    }

    /**
     * Get ICE candidates for a specific offer
     */
    async getOfferIceCandidates(
        offerId: string,
        since: number = 0
    ): Promise<{ candidates: IceCandidate[]; offerId: string }> {
        const request: RpcRequest = {
            method: 'getIceCandidates',
            params: { offerId, since },
        }
        const authHeaders = await this.generateAuthHeaders(request)
        const result = await this.rpc(request, authHeaders)

        return {
            candidates: result.candidates || [],
            offerId: result.offerId,
        }
    }
}
