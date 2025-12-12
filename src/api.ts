/**
 * Rondevu API Client - RPC interface
 */

import * as ed25519 from '@noble/ed25519'

// Set SHA-512 hash function for ed25519 (required in @noble/ed25519 v3+)
ed25519.hashes.sha512Async = async (message: Uint8Array) => {
    return new Uint8Array(await crypto.subtle.digest('SHA-512', message as BufferSource))
}

export interface Keypair {
    publicKey: string
    privateKey: string
}

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
    candidate: RTCIceCandidateInit
    createdAt: number
}

/**
 * Helper: Convert Uint8Array to base64 string
 */
function bytesToBase64(bytes: Uint8Array): string {
    const binString = Array.from(bytes, byte => String.fromCodePoint(byte)).join('')
    return btoa(binString)
}

/**
 * Helper: Convert base64 string to Uint8Array
 */
function base64ToBytes(base64: string): Uint8Array {
    const binString = atob(base64)
    return Uint8Array.from(binString, char => char.codePointAt(0)!)
}

/**
 * RPC request format
 */
interface RpcRequest {
    method: string
    message: string
    signature: string
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
    constructor(
        private baseUrl: string,
        private username: string,
        private keypair: Keypair
    ) {}

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

        const signature = await RondevuAPI.signMessage(message, this.keypair.privateKey)

        return { message, signature }
    }

    /**
     * Execute RPC call
     */
    private async rpc(request: RpcRequest): Promise<any> {
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
     * Execute batch RPC calls
     */
    private async rpcBatch(requests: RpcRequest[]): Promise<any[]> {
        const response = await fetch(`${this.baseUrl}/rpc`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requests),
        })

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }

        const results: RpcResponse[] = await response.json()

        return results.map((result, i) => {
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
     */
    static async generateKeypair(): Promise<Keypair> {
        const privateKey = ed25519.utils.randomSecretKey()
        const publicKey = await ed25519.getPublicKeyAsync(privateKey)

        return {
            publicKey: bytesToBase64(publicKey),
            privateKey: bytesToBase64(privateKey),
        }
    }

    /**
     * Sign a message with an Ed25519 private key
     */
    static async signMessage(message: string, privateKeyBase64: string): Promise<string> {
        const privateKey = base64ToBytes(privateKeyBase64)
        const encoder = new TextEncoder()
        const messageBytes = encoder.encode(message)
        const signature = await ed25519.signAsync(messageBytes, privateKey)

        return bytesToBase64(signature)
    }

    /**
     * Verify an Ed25519 signature
     */
    static async verifySignature(
        message: string,
        signatureBase64: string,
        publicKeyBase64: string
    ): Promise<boolean> {
        try {
            const signature = base64ToBytes(signatureBase64)
            const publicKey = base64ToBytes(publicKeyBase64)
            const encoder = new TextEncoder()
            const messageBytes = encoder.encode(message)

            return await ed25519.verifyAsync(signature, messageBytes, publicKey)
        } catch {
            return false
        }
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
     * Claim a username
     */
    async claimUsername(username: string, publicKey: string): Promise<void> {
        const auth = await this.generateAuth('claim', username)
        await this.rpc({
            method: 'claimUsername',
            message: auth.message,
            signature: auth.signature,
            params: { username, publicKey },
        })
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
                candidate: any
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
            params: { serviceFqn, offerId, since },
        })

        return {
            candidates: result.candidates || [],
            offerId: result.offerId,
        }
    }
}
