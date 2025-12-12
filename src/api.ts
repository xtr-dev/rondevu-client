/**
 * Rondevu API Client - RPC interface
 */

import { CryptoAdapter, Keypair } from './crypto-adapter.js'
import { WebCryptoAdapter } from './web-crypto-adapter.js'
import { RpcBatcher, BatcherOptions } from './rpc-batcher.js'

export type { Keypair } from './crypto-adapter.js'
export type { BatcherOptions } from './rpc-batcher.js'

export interface OfferRequest {
    sdp: string
}

export interface ServiceRequest {
    serviceFqn: string // Must include username: service:version@username
    offers: OfferRequest[]
    ttl?: number
    signature: string
    message: string
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
    createdAt: number
}

/**
 * RPC request format
 */
interface RpcRequest {
    method: string
    message: string
    signature: string
    publicKey?: string
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
     * Generate authentication parameters for RPC calls
     */
    private async generateAuth(method: string, params: string = ''): Promise<{
        message: string
        signature: string
    }> {
        const timestamp = Date.now()
        const message = params
            ? `${method}:${this.username}:${params}:${timestamp}`
            : `${method}:${this.username}:${timestamp}`

        const signature = await this.crypto.signMessage(message, this.keypair.privateKey)

        return { message, signature }
    }

    /**
     * Execute RPC call with optional batching
     */
    private async rpc(request: RpcRequest): Promise<any> {
        // Use batcher if enabled
        if (this.batcher) {
            return await this.batcher.add(request)
        }

        // Direct call without batching
        return await this.rpcDirect(request)
    }

    /**
     * Execute single RPC call directly (bypasses batcher)
     */
    private async rpcDirect(request: RpcRequest): Promise<any> {
        const response = await fetch(`${this.baseUrl}/rpc`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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
     */
    private async rpcBatchDirect(requests: RpcRequest[]): Promise<any[]> {
        const response = await fetch(`${this.baseUrl}/rpc`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requests),
        })

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }

        const results: RpcResponse[] = await response.json()

        // Validate response is an array
        if (!Array.isArray(results)) {
            console.error('Invalid RPC batch response:', results)
            throw new Error('Server returned invalid batch response (not an array)')
        }

        // Check response length matches request length
        if (results.length !== requests.length) {
            console.error(`Response length mismatch: expected ${requests.length}, got ${results.length}`)
        }

        return results.map((result, i) => {
            if (!result || typeof result !== 'object') {
                throw new Error(`Invalid response at index ${i}`)
            }
            if (!result.success) {
                throw new Error(result.error || `RPC call ${i} failed`)
            }
            return result.result
        })
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
        const auth = await this.generateAuth('getUser', username)
        const result = await this.rpc({
            method: 'getUser',
            message: auth.message,
            signature: auth.signature,
            params: { username },
        })
        return result.available
    }

    /**
     * Check if current username is claimed
     */
    async isUsernameClaimed(): Promise<boolean> {
        const auth = await this.generateAuth('getUser', this.username)
        const result = await this.rpc({
            method: 'getUser',
            message: auth.message,
            signature: auth.signature,
            params: { username: this.username },
        })
        return !result.available
    }

    // ============================================
    // Service Management
    // ============================================

    /**
     * Publish a service
     */
    async publishService(service: ServiceRequest): Promise<Service> {
        const auth = await this.generateAuth('publishService', service.serviceFqn)
        return await this.rpc({
            method: 'publishService',
            message: auth.message,
            signature: auth.signature,
            publicKey: this.keypair.publicKey,
            params: {
                serviceFqn: service.serviceFqn,
                offers: service.offers,
                ttl: service.ttl,
            },
        })
    }

    /**
     * Get service by FQN (direct lookup, random, or paginated)
     */
    async getService(
        serviceFqn: string,
        options?: { limit?: number; offset?: number }
    ): Promise<any> {
        const auth = await this.generateAuth('getService', serviceFqn)
        return await this.rpc({
            method: 'getService',
            message: auth.message,
            signature: auth.signature,
            publicKey: this.keypair.publicKey,
            params: {
                serviceFqn,
                ...options,
            },
        })
    }

    /**
     * Delete a service
     */
    async deleteService(serviceFqn: string): Promise<void> {
        const auth = await this.generateAuth('deleteService', serviceFqn)
        await this.rpc({
            method: 'deleteService',
            message: auth.message,
            signature: auth.signature,
            publicKey: this.keypair.publicKey,
            params: { serviceFqn },
        })
    }

    // ============================================
    // WebRTC Signaling
    // ============================================

    /**
     * Answer an offer
     */
    async answerOffer(serviceFqn: string, offerId: string, sdp: string): Promise<void> {
        const auth = await this.generateAuth('answerOffer', offerId)
        await this.rpc({
            method: 'answerOffer',
            message: auth.message,
            signature: auth.signature,
            publicKey: this.keypair.publicKey,
            params: { serviceFqn, offerId, sdp },
        })
    }

    /**
     * Get answer for a specific offer (offerer polls this)
     */
    async getOfferAnswer(
        serviceFqn: string,
        offerId: string
    ): Promise<{ sdp: string; offerId: string; answererId: string; answeredAt: number } | null> {
        try {
            const auth = await this.generateAuth('getOfferAnswer', offerId)
            return await this.rpc({
                method: 'getOfferAnswer',
                message: auth.message,
                signature: auth.signature,
                publicKey: this.keypair.publicKey,
                params: { serviceFqn, offerId },
            })
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
        const auth = await this.generateAuth('poll')
        return await this.rpc({
            method: 'poll',
            message: auth.message,
            signature: auth.signature,
            publicKey: this.keypair.publicKey,
            params: { since },
        })
    }

    /**
     * Add ICE candidates to a specific offer
     */
    async addOfferIceCandidates(
        serviceFqn: string,
        offerId: string,
        candidates: RTCIceCandidateInit[]
    ): Promise<{ count: number; offerId: string }> {
        const auth = await this.generateAuth('addIceCandidates', offerId)
        return await this.rpc({
            method: 'addIceCandidates',
            message: auth.message,
            signature: auth.signature,
            publicKey: this.keypair.publicKey,
            params: { serviceFqn, offerId, candidates },
        })
    }

    /**
     * Get ICE candidates for a specific offer
     */
    async getOfferIceCandidates(
        serviceFqn: string,
        offerId: string,
        since: number = 0
    ): Promise<{ candidates: IceCandidate[]; offerId: string }> {
        const auth = await this.generateAuth('getIceCandidates', `${offerId}:${since}`)
        const result = await this.rpc({
            method: 'getIceCandidates',
            message: auth.message,
            signature: auth.signature,
            publicKey: this.keypair.publicKey,
            params: { serviceFqn, offerId, since },
        })

        return {
            candidates: result.candidates || [],
            offerId: result.offerId,
        }
    }
}
