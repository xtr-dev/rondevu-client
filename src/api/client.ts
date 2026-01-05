/**
 * Rondevu API Client - RPC interface
 */

import { CryptoAdapter, KeyPair } from '../crypto/adapter.js'
import { WebCryptoAdapter } from '../crypto/web.js'
import { RpcBatcher, BatcherOptions } from './batcher.js'

export type { KeyPair } from '../crypto/adapter.js'
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
    publicKey: string
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
    publicKey: string
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
 *
 * Uses Ed25519 public key cryptography for authentication.
 * The public key IS the identity (like Ethereum addresses).
 */
export class RondevuAPI {
    // Key length constants
    private static readonly PUBLIC_KEY_LENGTH = 64 // 32 bytes = 64 hex chars
    private static readonly PRIVATE_KEY_LENGTH = 64 // 32 bytes = 64 hex chars
    private static readonly MAX_CANONICALIZE_DEPTH = 100 // Prevent stack overflow

    private crypto: CryptoAdapter
    private batcher: RpcBatcher

    constructor(
        private baseUrl: string,
        private keyPair: KeyPair,
        cryptoAdapter?: CryptoAdapter,
        batcherOptions?: BatcherOptions
    ) {
        // Use WebCryptoAdapter by default (browser environment)
        this.crypto = cryptoAdapter || new WebCryptoAdapter()
        // Create batcher for request batching with throttling
        this.batcher = new RpcBatcher(baseUrl, batcherOptions)

        // Validate public key format
        if (!keyPair.publicKey || typeof keyPair.publicKey !== 'string') {
            throw new Error('Invalid keypair: publicKey must be a non-empty string')
        }
        if (keyPair.publicKey.length !== RondevuAPI.PUBLIC_KEY_LENGTH) {
            throw new Error(
                `Invalid keypair: publicKey must be ${RondevuAPI.PUBLIC_KEY_LENGTH} hex characters (32 bytes)`
            )
        }
        if (!/^[0-9a-fA-F]+$/.test(keyPair.publicKey)) {
            throw new Error('Invalid keypair: publicKey must contain only hexadecimal characters')
        }

        // Validate private key format
        if (!keyPair.privateKey || typeof keyPair.privateKey !== 'string') {
            throw new Error('Invalid keypair: privateKey must be a non-empty string')
        }
        if (keyPair.privateKey.length !== RondevuAPI.PRIVATE_KEY_LENGTH) {
            throw new Error(
                `Invalid keypair: privateKey must be ${RondevuAPI.PRIVATE_KEY_LENGTH} hex characters (32 bytes)`
            )
        }
        if (!/^[0-9a-fA-F]+$/.test(keyPair.privateKey)) {
            throw new Error('Invalid keypair: privateKey must contain only hexadecimal characters')
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
     * Uses Ed25519 signature with nonce for replay protection
     *
     * Security notes:
     * - Nonce: Cryptographically secure random value (UUID or 128-bit hex)
     * - Timestamp: Prevents replay attacks outside the server's time window
     *   - Server validates timestamp is within acceptable range (typically ±5 minutes)
     *   - Tolerates reasonable clock skew between client and server
     *   - Requests with stale timestamps are rejected
     * - Signature: Ed25519 ensures message integrity and authenticity
     * - Server validates nonce uniqueness to prevent replay within time window
     *   - Each nonce can only be used once within the timestamp validity window
     *   - Server maintains nonce cache with expiration matching timestamp window
     */
    private async generateAuthHeaders(request: RpcRequest): Promise<Record<string, string>> {
        const timestamp = Date.now()
        const nonce = this.generateNonce()

        // Build message and generate Ed25519 signature
        const message = this.buildSignatureMessage(timestamp, nonce, request.method, request.params)
        const signature = await this.crypto.signMessage(this.keyPair.privateKey, message)

        return {
            'X-PublicKey': this.keyPair.publicKey,
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
    // Identity Management (Ed25519 Public Key)
    // ============================================

    /**
     * Generate a new Ed25519 keypair locally
     * This is completely client-side - no server communication
     *
     * @param cryptoAdapter - Optional crypto adapter (defaults to WebCryptoAdapter)
     * @returns Generated keypair with publicKey and privateKey as hex strings
     */
    static async generateKeyPair(cryptoAdapter?: CryptoAdapter): Promise<KeyPair> {
        const adapter = cryptoAdapter || new WebCryptoAdapter()
        return adapter.generateKeyPair()
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
     * @param offerId The offer ID to answer
     * @param sdp The SDP answer
     * @param matchedTags Optional tags that were used to discover this offer
     */
    async answerOffer(offerId: string, sdp: string, matchedTags?: string[]): Promise<void> {
        const request: RpcRequest = {
            method: 'answerOffer',
            params: { offerId, sdp, matchedTags },
        }
        const authHeaders = await this.generateAuthHeaders(request)
        await this.rpc(request, authHeaders)
    }

    /**
     * Get answer for a specific offer (offerer polls this)
     */
    async getOfferAnswer(offerId: string): Promise<{
        sdp: string
        offerId: string
        answererPublicKey: string
        answeredAt: number
        matchedTags?: string[]
    } | null> {
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
            answererPublicKey: string
            sdp: string
            answeredAt: number
            matchedTags?: string[]
        }>
        iceCandidates: Record<
            string,
            Array<{
                candidate: RTCIceCandidateInit | null
                role: 'offerer' | 'answerer'
                peerPublicKey: string
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
