/**
 * Rondevu API Client - Single class for all API endpoints
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
 * RondevuAPI - Complete API client for Rondevu signaling server
 */
export class RondevuAPI {
    constructor(
        private baseUrl: string,
        private username: string,
        private keypair: Keypair
    ) {}

    /**
     * Generate authentication parameters (username, signature, message) for API calls
     */
    private async generateAuthParams(action: string, params: string = ''): Promise<{
        username: string;
        signature: string;
        message: string;
    }> {
        const timestamp = Date.now();
        const message = params
            ? `${action}:${this.username}:${params}:${timestamp}`
            : `${action}:${this.username}:${timestamp}`;

        const signature = await RondevuAPI.signMessage(message, this.keypair.privateKey);

        return { username: this.username, signature, message };
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
    // Offers
    // ============================================

    /**
     * Create one or more offers
     */
    async createOffers(offers: OfferRequest[]): Promise<Offer[]> {
        const auth = await this.generateAuthParams('createOffers');

        const response = await fetch(`${this.baseUrl}/offers`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ offers, ...auth }),
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
        const auth = await this.generateAuthParams('getOffer', offerId);
        const url = new URL(`${this.baseUrl}/offers/${offerId}`);
        url.searchParams.set('username', auth.username);
        url.searchParams.set('signature', auth.signature);
        url.searchParams.set('message', auth.message);

        const response = await fetch(url.toString())

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Unknown error' }))
            throw new Error(`Failed to get offer: ${error.error || response.statusText}`)
        }

        return await response.json()
    }

    /**
     * Answer a specific offer from a service
     */
    async postOfferAnswer(serviceFqn: string, offerId: string, sdp: string): Promise<{ success: boolean; offerId: string }> {
        const auth = await this.generateAuthParams('answerOffer', `${serviceFqn}:${offerId}`);

        const response = await fetch(`${this.baseUrl}/services/${encodeURIComponent(serviceFqn)}/offers/${offerId}/answer`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ sdp, ...auth }),
        })

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Unknown error' }))
            throw new Error(`Failed to answer offer: ${error.error || response.statusText}`)
        }

        return await response.json()
    }

    /**
     * Get all answered offers (efficient batch polling for offerer)
     */
    async getAnsweredOffers(since?: number): Promise<{
        offers: Array<{
            offerId: string;
            serviceId?: string;
            answererId: string;
            sdp: string;
            answeredAt: number;
        }>;
    }> {
        const auth = await this.generateAuthParams('getAnsweredOffers', since?.toString() || '');
        const url = new URL(`${this.baseUrl}/offers/answered`);

        if (since) {
            url.searchParams.set('since', since.toString());
        }
        url.searchParams.set('username', auth.username);
        url.searchParams.set('signature', auth.signature);
        url.searchParams.set('message', auth.message);

        const response = await fetch(url.toString())

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Unknown error' }))
            throw new Error(`Failed to get answered offers: ${error.error || response.statusText}`)
        }

        return await response.json()
    }

    /**
     * Combined efficient polling for answers and ICE candidates
     * Returns all answered offers and ICE candidates since timestamp
     */
    async pollOffers(since?: number): Promise<{
        answers: Array<{
            offerId: string;
            serviceId?: string;
            answererId: string;
            sdp: string;
            answeredAt: number;
        }>;
        iceCandidates: Record<string, Array<{
            candidate: any;
            role: 'offerer' | 'answerer';
            peerId: string;
            createdAt: number;
        }>>;
    }> {
        const auth = await this.generateAuthParams('pollOffers', since?.toString() || '');
        const url = new URL(`${this.baseUrl}/offers/poll`);

        if (since) {
            url.searchParams.set('since', since.toString());
        }
        url.searchParams.set('username', auth.username);
        url.searchParams.set('signature', auth.signature);
        url.searchParams.set('message', auth.message);

        const response = await fetch(url.toString())

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Unknown error' }))
            throw new Error(`Failed to poll offers: ${error.error || response.statusText}`)
        }

        return await response.json()
    }

    /**
     * Get answer for a specific offer (offerer polls this)
     */
    async getOfferAnswer(serviceFqn: string, offerId: string): Promise<{ sdp: string; offerId: string; answererId: string; answeredAt: number } | null> {
        const auth = await this.generateAuthParams('getOfferAnswer', `${serviceFqn}:${offerId}`);
        const url = new URL(`${this.baseUrl}/services/${encodeURIComponent(serviceFqn)}/offers/${offerId}/answer`);
        url.searchParams.set('username', auth.username);
        url.searchParams.set('signature', auth.signature);
        url.searchParams.set('message', auth.message);

        const response = await fetch(url.toString())

        if (!response.ok) {
            // 404 means not yet answered
            if (response.status === 404) {
                return null
            }
            const error = await response.json().catch(() => ({ error: 'Unknown error' }))
            throw new Error(`Failed to get answer: ${error.error || response.statusText}`)
        }

        return await response.json()
    }

    /**
     * Search offers by topic
     */
    async searchOffers(topic: string): Promise<Offer[]> {
        const auth = await this.generateAuthParams('searchOffers', topic);
        const url = new URL(`${this.baseUrl}/offers`);
        url.searchParams.set('topic', topic);
        url.searchParams.set('username', auth.username);
        url.searchParams.set('signature', auth.signature);
        url.searchParams.set('message', auth.message);

        const response = await fetch(url.toString())

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
     * Add ICE candidates to a specific offer
     */
    async addOfferIceCandidates(serviceFqn: string, offerId: string, candidates: RTCIceCandidateInit[]): Promise<{ count: number; offerId: string }> {
        const auth = await this.generateAuthParams('addIceCandidates', `${serviceFqn}:${offerId}`);

        const response = await fetch(`${this.baseUrl}/services/${encodeURIComponent(serviceFqn)}/offers/${offerId}/ice-candidates`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ candidates, ...auth }),
        })

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Unknown error' }))
            throw new Error(`Failed to add ICE candidates: ${error.error || response.statusText}`)
        }

        return await response.json()
    }

    /**
     * Get ICE candidates for a specific offer (with polling support)
     */
    async getOfferIceCandidates(serviceFqn: string, offerId: string, since: number = 0): Promise<{ candidates: IceCandidate[]; offerId: string }> {
        const auth = await this.generateAuthParams('getIceCandidates', `${serviceFqn}:${offerId}:${since}`);
        const url = new URL(`${this.baseUrl}/services/${encodeURIComponent(serviceFqn)}/offers/${offerId}/ice-candidates`)
        url.searchParams.set('since', since.toString())
        url.searchParams.set('username', auth.username);
        url.searchParams.set('signature', auth.signature);
        url.searchParams.set('message', auth.message);

        const response = await fetch(url.toString())

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
     * Service FQN must include username: service:version@username
     */
    async publishService(service: ServiceRequest): Promise<Service> {
        const auth = await this.generateAuthParams('publishService', service.serviceFqn);

        const response = await fetch(`${this.baseUrl}/services`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ ...service, username: auth.username }),
        })

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Unknown error' }))
            throw new Error(`Failed to publish service: ${error.error || response.statusText}`)
        }

        return await response.json()
    }

    /**
     * Get service by FQN (with username) - Direct lookup
     * Example: chat:1.0.0@alice
     */
    async getService(serviceFqn: string): Promise<{ serviceId: string; username: string; serviceFqn: string; offerId: string; sdp: string; createdAt: number; expiresAt: number }> {
        const auth = await this.generateAuthParams('getService', serviceFqn);
        const url = new URL(`${this.baseUrl}/services/${encodeURIComponent(serviceFqn)}`);
        url.searchParams.set('username', auth.username);
        url.searchParams.set('signature', auth.signature);
        url.searchParams.set('message', auth.message);

        const response = await fetch(url.toString())

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Unknown error' }))
            throw new Error(`Failed to get service: ${error.error || response.statusText}`)
        }

        return await response.json()
    }

    /**
     * Discover a random available service without knowing the username
     * Example: chat:1.0.0 (without @username)
     */
    async discoverService(serviceVersion: string): Promise<{ serviceId: string; username: string; serviceFqn: string; offerId: string; sdp: string; createdAt: number; expiresAt: number }> {
        const auth = await this.generateAuthParams('discoverService', serviceVersion);
        const url = new URL(`${this.baseUrl}/services/${encodeURIComponent(serviceVersion)}`);
        url.searchParams.set('username', auth.username);
        url.searchParams.set('signature', auth.signature);
        url.searchParams.set('message', auth.message);

        const response = await fetch(url.toString())

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Unknown error' }))
            throw new Error(`Failed to discover service: ${error.error || response.statusText}`)
        }

        return await response.json()
    }

    /**
     * Discover multiple available services with pagination
     * Example: chat:1.0.0 (without @username)
     */
    async discoverServices(serviceVersion: string, limit: number = 10, offset: number = 0): Promise<{ services: Array<{ serviceId: string; username: string; serviceFqn: string; offerId: string; sdp: string; createdAt: number; expiresAt: number }>; count: number; limit: number; offset: number }> {
        const auth = await this.generateAuthParams('discoverServices', `${serviceVersion}:${limit}:${offset}`);
        const url = new URL(`${this.baseUrl}/services/${encodeURIComponent(serviceVersion)}`)
        url.searchParams.set('limit', limit.toString())
        url.searchParams.set('offset', offset.toString())
        url.searchParams.set('username', auth.username);
        url.searchParams.set('signature', auth.signature);
        url.searchParams.set('message', auth.message);

        const response = await fetch(url.toString())

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Unknown error' }))
            throw new Error(`Failed to discover services: ${error.error || response.statusText}`)
        }

        return await response.json()
    }


    // ============================================
    // Usernames
    // ============================================

    /**
     * Check if username is available
     */
    async checkUsername(username: string): Promise<{ available: boolean; publicKey?: string; claimedAt?: number; expiresAt?: number }> {
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
