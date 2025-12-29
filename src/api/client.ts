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
    }

    /**
     * Build signature message following server format
     * Format: timestamp:nonce:method:JSON.stringify(params || {})
     */
    private buildSignatureMessage(timestamp: number, nonce: string, method: string, params?: any): string {
        const paramsJson = JSON.stringify(params || {})
        return `${timestamp}:${nonce}:${method}:${paramsJson}`
    }

    /**
     * Generate authentication headers for RPC request
     * Uses HMAC-SHA256 signature with nonce for replay protection
     *
     * Security notes:
     * - Nonce: crypto.randomUUID() uses crypto.getRandomValues() internally (cryptographically secure)
     * - Timestamp: Prevents replay attacks outside the server's time window
     * - Signature: HMAC-SHA256 ensures message integrity and authenticity
     * - Server validates nonce uniqueness to prevent replay within time window
     */
    private async generateAuthHeaders(request: RpcRequest): Promise<Record<string, string>> {
        const timestamp = Date.now()
        // crypto.randomUUID() is cryptographically secure (uses crypto.getRandomValues internally)
        // Generates UUIDv4 with 122 bits of entropy - sufficient for replay protection
        const nonce = crypto.randomUUID()

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
     * @returns Generated credential with name and secret
     */
    static async generateCredentials(
        baseUrl: string,
        expiresAt?: number
    ): Promise<Credential> {
        const request: RpcRequest = {
            method: 'generateCredentials',
            params: expiresAt ? { expiresAt } : undefined,
        }

        const response = await fetch(`${baseUrl}/rpc`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(request),
        })

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }

        const result: RpcResponse = await response.json()

        if (!result.success) {
            throw new Error(result.error || 'Failed to generate credentials')
        }

        return result.result as Credential
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
