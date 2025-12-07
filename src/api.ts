/**
 * Rondevu API Client - Single class for all API endpoints
 */

import * as ed25519 from '@noble/ed25519'

// Set SHA-512 hash function for ed25519 (required in @noble/ed25519 v3+)
ed25519.hashes.sha512Async = async (message: Uint8Array) => {
    return new Uint8Array(await crypto.subtle.digest('SHA-512', message as BufferSource))
}

export interface Credentials {
    peerId: string
    secret: string
}

export interface Keypair {
    publicKey: string
    privateKey: string
}

export interface OfferRequest {
    sdp: string
    topics?: string[]
    ttl?: number
    secret?: string
}

export interface Offer {
    id: string
    peerId: string
    sdp: string
    topics: string[]
    ttl: number
    createdAt: number
    expiresAt: number
    answererPeerId?: string
}

export interface OfferRequest {
    sdp: string
}

export interface ServiceRequest {
    username: string
    serviceFqn: string
    offers: OfferRequest[]
    ttl?: number
    isPublic?: boolean
    metadata?: Record<string, any>
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
    uuid: string
    offers: ServiceOffer[]
    username: string
    serviceFqn: string
    isPublic: boolean
    metadata?: Record<string, any>
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
 * RondevuAPI - Complete API client for Rondevu signaling server
 */
export class RondevuAPI {
    constructor(
        private baseUrl: string,
        private credentials?: Credentials
    ) {}

    /**
     * Set credentials for authentication
     */
    setCredentials(credentials: Credentials): void {
        this.credentials = credentials
    }

    /**
     * Authentication header
     */
    private getAuthHeader(): Record<string, string> {
        if (!this.credentials) {
            return {}
        }
        return {
            Authorization: `Bearer ${this.credentials.peerId}:${this.credentials.secret}`,
        }
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
     * Verify a signature
     */
    static async verifySignature(
        message: string,
        signatureBase64: string,
        publicKeyBase64: string
    ): Promise<boolean> {
        const publicKey = base64ToBytes(publicKeyBase64)
        const signature = base64ToBytes(signatureBase64)
        const encoder = new TextEncoder()
        const messageBytes = encoder.encode(message)

        return await ed25519.verifyAsync(signature, messageBytes, publicKey)
    }

    // ============================================
    // Authentication
    // ============================================

    /**
     * Register a new peer and get credentials
     */
    async register(): Promise<Credentials> {
        const response = await fetch(`${this.baseUrl}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        })

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Unknown error' }))
            throw new Error(`Registration failed: ${error.error || response.statusText}`)
        }

        return await response.json()
    }

    // ============================================
    // Offers
    // ============================================

    /**
     * Create one or more offers
     */
    async createOffers(offers: OfferRequest[]): Promise<Offer[]> {
        const response = await fetch(`${this.baseUrl}/offers`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...this.getAuthHeader(),
            },
            body: JSON.stringify({ offers }),
        })

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Unknown error' }))
            throw new Error(`Failed to create offers: ${error.error || response.statusText}`)
        }

        return await response.json()
    }

    /**
     * Get offer by ID
     */
    async getOffer(offerId: string): Promise<Offer> {
        const response = await fetch(`${this.baseUrl}/offers/${offerId}`, {
            headers: this.getAuthHeader(),
        })

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Unknown error' }))
            throw new Error(`Failed to get offer: ${error.error || response.statusText}`)
        }

        return await response.json()
    }

    /**
     * Answer a service
     */
    async answerService(serviceUuid: string, sdp: string): Promise<{ offerId: string }> {
        const response = await fetch(`${this.baseUrl}/services/${serviceUuid}/answer`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...this.getAuthHeader(),
            },
            body: JSON.stringify({ sdp }),
        })

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Unknown error' }))
            throw new Error(`Failed to answer service: ${error.error || response.statusText}`)
        }

        return await response.json()
    }

    /**
     * Get answer for a service (offerer polls this)
     */
    async getServiceAnswer(serviceUuid: string): Promise<{ sdp: string; offerId: string } | null> {
        const response = await fetch(`${this.baseUrl}/services/${serviceUuid}/answer`, {
            headers: this.getAuthHeader(),
        })

        if (!response.ok) {
            // 404 means not yet answered
            if (response.status === 404) {
                return null
            }
            const error = await response.json().catch(() => ({ error: 'Unknown error' }))
            throw new Error(`Failed to get answer: ${error.error || response.statusText}`)
        }

        const data = await response.json()
        return { sdp: data.sdp, offerId: data.offerId }
    }

    /**
     * Search offers by topic
     */
    async searchOffers(topic: string): Promise<Offer[]> {
        const response = await fetch(`${this.baseUrl}/offers?topic=${encodeURIComponent(topic)}`, {
            headers: this.getAuthHeader(),
        })

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Unknown error' }))
            throw new Error(`Failed to search offers: ${error.error || response.statusText}`)
        }

        return await response.json()
    }

    // ============================================
    // ICE Candidates
    // ============================================

    /**
     * Add ICE candidates to a service
     */
    async addServiceIceCandidates(serviceUuid: string, candidates: RTCIceCandidateInit[], offerId?: string): Promise<{ offerId: string }> {
        const response = await fetch(`${this.baseUrl}/services/${serviceUuid}/ice-candidates`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...this.getAuthHeader(),
            },
            body: JSON.stringify({ candidates, offerId }),
        })

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Unknown error' }))
            throw new Error(`Failed to add ICE candidates: ${error.error || response.statusText}`)
        }

        return await response.json()
    }

    /**
     * Get ICE candidates for a service (with polling support)
     */
    async getServiceIceCandidates(serviceUuid: string, since: number = 0, offerId?: string): Promise<{ candidates: IceCandidate[]; offerId: string }> {
        const url = new URL(`${this.baseUrl}/services/${serviceUuid}/ice-candidates`)
        url.searchParams.set('since', since.toString())
        if (offerId) {
            url.searchParams.set('offerId', offerId)
        }

        const response = await fetch(url.toString(), { headers: this.getAuthHeader() })

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Unknown error' }))
            throw new Error(`Failed to get ICE candidates: ${error.error || response.statusText}`)
        }

        const data = await response.json()
        return {
            candidates: data.candidates || [],
            offerId: data.offerId
        }
    }

    // ============================================
    // Services
    // ============================================

    /**
     * Publish a service
     */
    async publishService(service: ServiceRequest): Promise<Service> {
        const response = await fetch(`${this.baseUrl}/users/${encodeURIComponent(service.username)}/services`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...this.getAuthHeader(),
            },
            body: JSON.stringify(service),
        })

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Unknown error' }))
            throw new Error(`Failed to publish service: ${error.error || response.statusText}`)
        }

        return await response.json()
    }

    /**
     * Get service by UUID
     */
    async getService(uuid: string): Promise<Service & { offerId: string; sdp: string }> {
        const response = await fetch(`${this.baseUrl}/services/${uuid}`, {
            headers: this.getAuthHeader(),
        })

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Unknown error' }))
            throw new Error(`Failed to get service: ${error.error || response.statusText}`)
        }

        return await response.json()
    }

    /**
     * Search services by username - lists all services for a username
     */
    async searchServicesByUsername(username: string): Promise<Service[]> {
        const response = await fetch(
            `${this.baseUrl}/users/${encodeURIComponent(username)}/services`,
            { headers: this.getAuthHeader() }
        )

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Unknown error' }))
            throw new Error(`Failed to search services: ${error.error || response.statusText}`)
        }

        const data = await response.json()
        return data.services || []
    }

    /**
     * Search services by username AND FQN - returns full service details
     */
    async searchServices(username: string, serviceFqn: string): Promise<Service[]> {
        const response = await fetch(
            `${this.baseUrl}/users/${encodeURIComponent(username)}/services/${encodeURIComponent(serviceFqn)}`,
            { headers: this.getAuthHeader() }
        )

        if (!response.ok) {
            if (response.status === 404) {
                return []
            }
            const error = await response.json().catch(() => ({ error: 'Unknown error' }))
            throw new Error(`Failed to search services: ${error.error || response.statusText}`)
        }

        const service = await response.json()
        return [service]
    }

    // ============================================
    // Usernames
    // ============================================

    /**
     * Check if username is available
     */
    async checkUsername(username: string): Promise<{ available: boolean; owner?: string }> {
        const response = await fetch(
            `${this.baseUrl}/users/${encodeURIComponent(username)}`
        )

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Unknown error' }))
            throw new Error(`Failed to check username: ${error.error || response.statusText}`)
        }

        return await response.json()
    }

    /**
     * Claim a username (requires Ed25519 signature)
     */
    async claimUsername(
        username: string,
        publicKey: string,
        signature: string,
        message: string
    ): Promise<{ success: boolean; username: string }> {
        const response = await fetch(`${this.baseUrl}/users/${encodeURIComponent(username)}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...this.getAuthHeader(),
            },
            body: JSON.stringify({
                publicKey,
                signature,
                message,
            }),
        })

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Unknown error' }))
            throw new Error(`Failed to claim username: ${error.error || response.statusText}`)
        }

        return await response.json()
    }
}
