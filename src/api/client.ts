/**
 * Rondevu API Client - RPC interface
 */

import { CryptoAdapter, Keypair } from '../crypto/adapter.js'
import { WebCryptoAdapter } from '../crypto/web.js'
import { RpcBatcher, BatcherOptions } from './batcher.js'

export type { Keypair } from '../crypto/adapter.js'
export type { BatcherOptions } from './batcher.js'

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
    private batcher: RpcBatcher | null = null

    constructor(
        private baseUrl: string,
        private username: string,
        private keypair: Keypair,
        cryptoAdapter?: CryptoAdapter,
        batcherOptions?: BatcherOptions | false
    ) {
        // Use WebCryptoAdapter by default (browser environment)
        this.crypto = cryptoAdapter || new WebCryptoAdapter()

        // Create batcher if not explicitly disabled
        if (batcherOptions !== false) {
            this.batcher = new RpcBatcher(
                (requests) => this.rpcBatchDirect(requests),
                batcherOptions
            )
        }
    }

    /**
     * Create canonical JSON string with sorted keys for deterministic signing
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

        const sortedKeys = Object.keys(obj).sort()
        const pairs = sortedKeys.map(key => {
            return JSON.stringify(key) + ':' + this.canonicalJSON(obj[key])
        })
        return '{' + pairs.join(',') + '}'
    }

    /**
     * Generate authentication headers for RPC request
     * Signs the payload (method + params + timestamp + username)
     */
    private async generateAuthHeaders(request: RpcRequest, includePublicKey: boolean = false): Promise<Record<string, string>> {
        const timestamp = Date.now()

        // Create payload with timestamp and username for signing: { method, params, timestamp, username }
        const payload = { ...request, timestamp, username: this.username }

        // Create canonical JSON representation for signing
        const canonical = this.canonicalJSON(payload)

        // Sign the canonical representation
        const signature = await this.crypto.signMessage(canonical, this.keypair.privateKey)

        const headers: Record<string, string> = {
            'X-Signature': signature,
            'X-Timestamp': timestamp.toString(),
            'X-Username': this.username,
        }

        if (includePublicKey) {
            headers['X-Public-Key'] = this.keypair.publicKey
        }

        return headers
    }

    /**
     * Execute RPC call with optional batching
     */
    private async rpc(request: RpcRequest, authHeaders: Record<string, string>): Promise<any> {
        // Use batcher if enabled
        if (this.batcher) {
            return await this.batcher.add(request)
        }

        // Direct call without batching
        return await this.rpcDirect(request, authHeaders)
    }

    /**
     * Execute single RPC call directly (bypasses batcher)
     */
    private async rpcDirect(request: RpcRequest, authHeaders: Record<string, string>): Promise<any> {
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

    /**
     * Execute batch RPC calls directly (bypasses batcher)
     * Note: Batching with auth headers is complex - each request needs its own signature
     * For now, this will use the same auth headers for all requests in the batch
     */
    private async rpcBatchDirect(requests: RpcRequest[]): Promise<any[]> {
        // For batch requests, we'll need to handle auth differently
        // This is a limitation of moving to header-based auth
        throw new Error('Batch RPC calls not yet supported with header-based authentication')
    }

    // ============================================
    // Ed25519 Cryptography Helpers
    // ============================================

    /**
     * Generate an Ed25519 keypair for username claiming and service publishing
     * @param cryptoAdapter - Optional crypto adapter (defaults to WebCryptoAdapter)
     */
    static async generateKeypair(cryptoAdapter?: CryptoAdapter): Promise<Keypair> {
        const adapter = cryptoAdapter || new WebCryptoAdapter()
        return await adapter.generateKeypair()
    }

    /**
     * Sign a message with an Ed25519 private key
     * @param cryptoAdapter - Optional crypto adapter (defaults to WebCryptoAdapter)
     */
    static async signMessage(
        message: string,
        privateKeyBase64: string,
        cryptoAdapter?: CryptoAdapter
    ): Promise<string> {
        const adapter = cryptoAdapter || new WebCryptoAdapter()
        return await adapter.signMessage(message, privateKeyBase64)
    }

    /**
     * Verify an Ed25519 signature
     * @param cryptoAdapter - Optional crypto adapter (defaults to WebCryptoAdapter)
     */
    static async verifySignature(
        message: string,
        signatureBase64: string,
        publicKeyBase64: string,
        cryptoAdapter?: CryptoAdapter
    ): Promise<boolean> {
        const adapter = cryptoAdapter || new WebCryptoAdapter()
        return await adapter.verifySignature(message, signatureBase64, publicKeyBase64)
    }

    // ============================================
    // Username Management
    // ============================================

    /**
     * Check if a username is available
     */
    async isUsernameAvailable(username: string): Promise<boolean> {
        const request: RpcRequest = {
            method: 'getUser',
            params: { username },
        }
        const authHeaders = await this.generateAuthHeaders(request, false)
        const result = await this.rpc(request, authHeaders)
        return result.available
    }

    /**
     * Check if current username is claimed
     */
    async isUsernameClaimed(): Promise<boolean> {
        const request: RpcRequest = {
            method: 'getUser',
            params: { username: this.username },
        }
        const authHeaders = await this.generateAuthHeaders(request, false)
        const result = await this.rpc(request, authHeaders)
        return !result.available
    }

    // ============================================
    // Service Management
    // ============================================

    /**
     * Publish a service
     */
    async publishService(service: ServiceRequest): Promise<Service> {
        const request: RpcRequest = {
            method: 'publishService',
            params: {
                serviceFqn: service.serviceFqn,
                offers: service.offers,
                ttl: service.ttl,
            },
        }
        const authHeaders = await this.generateAuthHeaders(request, true)
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
            method: 'getService',
            params: {
                serviceFqn,
                ...options,
            },
        }
        const authHeaders = await this.generateAuthHeaders(request, true)
        return await this.rpc(request, authHeaders)
    }

    /**
     * Delete a service
     */
    async deleteService(serviceFqn: string): Promise<void> {
        const request: RpcRequest = {
            method: 'deleteService',
            params: { serviceFqn },
        }
        const authHeaders = await this.generateAuthHeaders(request, true)
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
        const authHeaders = await this.generateAuthHeaders(request, true)
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
            const authHeaders = await this.generateAuthHeaders(request, true)
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
        const authHeaders = await this.generateAuthHeaders(request, true)
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
        const authHeaders = await this.generateAuthHeaders(request, true)
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
        const authHeaders = await this.generateAuthHeaders(request, true)
        const result = await this.rpc(request, authHeaders)

        return {
            candidates: result.candidates || [],
            offerId: result.offerId,
        }
    }
}
