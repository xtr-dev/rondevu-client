/**
 * Rondevu API Client - Single class for all API endpoints
 */

export interface Credentials {
    peerId: string;
    secret: string;
}

export interface OfferRequest {
    sdp: string;
    topics?: string[];
    ttl?: number;
    secret?: string;
}

export interface Offer {
    id: string;
    peerId: string;
    sdp: string;
    topics: string[];
    ttl: number;
    createdAt: number;
    expiresAt: number;
    answererPeerId?: string;
}

export interface ServiceRequest {
    username: string;
    serviceFqn: string;
    sdp: string;
    ttl?: number;
    isPublic?: boolean;
    metadata?: Record<string, any>;
    signature: string;
    message: string;
}

export interface Service {
    serviceId: string;
    uuid: string;
    offerId: string;
    username: string;
    serviceFqn: string;
    isPublic: boolean;
    metadata?: Record<string, any>;
    createdAt: number;
    expiresAt: number;
}

export interface IceCandidate {
    candidate: RTCIceCandidateInit;
    createdAt: number;
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
     * Authentication header
     */
    private getAuthHeader(): Record<string, string> {
        if (!this.credentials) {
            return {};
        }
        return {
            'Authorization': `Bearer ${this.credentials.peerId}:${this.credentials.secret}`
        };
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
            headers: { 'Content-Type': 'application/json' }
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Unknown error' }));
            throw new Error(`Registration failed: ${error.error || response.statusText}`);
        }

        return await response.json();
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
                ...this.getAuthHeader()
            },
            body: JSON.stringify({ offers })
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Unknown error' }));
            throw new Error(`Failed to create offers: ${error.error || response.statusText}`);
        }

        return await response.json();
    }

    /**
     * Get offer by ID
     */
    async getOffer(offerId: string): Promise<Offer> {
        const response = await fetch(`${this.baseUrl}/offers/${offerId}`, {
            headers: this.getAuthHeader()
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Unknown error' }));
            throw new Error(`Failed to get offer: ${error.error || response.statusText}`);
        }

        return await response.json();
    }

    /**
     * Answer an offer
     */
    async answerOffer(offerId: string, sdp: string, secret?: string): Promise<void> {
        const response = await fetch(`${this.baseUrl}/offers/${offerId}/answer`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...this.getAuthHeader()
            },
            body: JSON.stringify({ sdp, secret })
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Unknown error' }));
            throw new Error(`Failed to answer offer: ${error.error || response.statusText}`);
        }
    }

    /**
     * Get answer for an offer (offerer polls this)
     */
    async getAnswer(offerId: string): Promise<{ sdp: string } | null> {
        const response = await fetch(`${this.baseUrl}/offers/${offerId}/answer`, {
            headers: this.getAuthHeader()
        });

        if (response.status === 404) {
            return null; // No answer yet
        }

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Unknown error' }));
            throw new Error(`Failed to get answer: ${error.error || response.statusText}`);
        }

        return await response.json();
    }

    /**
     * Search offers by topic
     */
    async searchOffers(topic: string): Promise<Offer[]> {
        const response = await fetch(`${this.baseUrl}/offers?topic=${encodeURIComponent(topic)}`, {
            headers: this.getAuthHeader()
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Unknown error' }));
            throw new Error(`Failed to search offers: ${error.error || response.statusText}`);
        }

        return await response.json();
    }

    // ============================================
    // ICE Candidates
    // ============================================

    /**
     * Add ICE candidates to an offer
     */
    async addIceCandidates(offerId: string, candidates: RTCIceCandidateInit[]): Promise<void> {
        const response = await fetch(`${this.baseUrl}/offers/${offerId}/ice-candidates`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...this.getAuthHeader()
            },
            body: JSON.stringify({ candidates })
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Unknown error' }));
            throw new Error(`Failed to add ICE candidates: ${error.error || response.statusText}`);
        }
    }

    /**
     * Get ICE candidates for an offer (with polling support)
     */
    async getIceCandidates(offerId: string, since: number = 0): Promise<IceCandidate[]> {
        const response = await fetch(
            `${this.baseUrl}/offers/${offerId}/ice-candidates?since=${since}`,
            { headers: this.getAuthHeader() }
        );

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Unknown error' }));
            throw new Error(`Failed to get ICE candidates: ${error.error || response.statusText}`);
        }

        return await response.json();
    }

    // ============================================
    // Services
    // ============================================

    /**
     * Publish a service
     */
    async publishService(service: ServiceRequest): Promise<Service> {
        const response = await fetch(`${this.baseUrl}/services`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...this.getAuthHeader()
            },
            body: JSON.stringify(service)
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Unknown error' }));
            throw new Error(`Failed to publish service: ${error.error || response.statusText}`);
        }

        return await response.json();
    }

    /**
     * Get service by UUID
     */
    async getService(uuid: string): Promise<Service & { offerId: string; sdp: string }> {
        const response = await fetch(`${this.baseUrl}/services/${uuid}`, {
            headers: this.getAuthHeader()
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Unknown error' }));
            throw new Error(`Failed to get service: ${error.error || response.statusText}`);
        }

        return await response.json();
    }

    /**
     * Search services by username
     */
    async searchServicesByUsername(username: string): Promise<Service[]> {
        const response = await fetch(
            `${this.baseUrl}/services?username=${encodeURIComponent(username)}`,
            { headers: this.getAuthHeader() }
        );

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Unknown error' }));
            throw new Error(`Failed to search services: ${error.error || response.statusText}`);
        }

        return await response.json();
    }

    /**
     * Search services by FQN
     */
    async searchServicesByFqn(serviceFqn: string): Promise<Service[]> {
        const response = await fetch(
            `${this.baseUrl}/services?serviceFqn=${encodeURIComponent(serviceFqn)}`,
            { headers: this.getAuthHeader() }
        );

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Unknown error' }));
            throw new Error(`Failed to search services: ${error.error || response.statusText}`);
        }

        return await response.json();
    }

    /**
     * Search services by username AND FQN
     */
    async searchServices(username: string, serviceFqn: string): Promise<Service[]> {
        const response = await fetch(
            `${this.baseUrl}/services?username=${encodeURIComponent(username)}&serviceFqn=${encodeURIComponent(serviceFqn)}`,
            { headers: this.getAuthHeader() }
        );

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Unknown error' }));
            throw new Error(`Failed to search services: ${error.error || response.statusText}`);
        }

        return await response.json();
    }

    // ============================================
    // Usernames
    // ============================================

    /**
     * Check if username is available
     */
    async checkUsername(username: string): Promise<{ available: boolean; owner?: string }> {
        const response = await fetch(
            `${this.baseUrl}/usernames/${encodeURIComponent(username)}/check`
        );

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Unknown error' }));
            throw new Error(`Failed to check username: ${error.error || response.statusText}`);
        }

        return await response.json();
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
        const response = await fetch(`${this.baseUrl}/usernames/${encodeURIComponent(username)}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...this.getAuthHeader()
            },
            body: JSON.stringify({
                publicKey,
                signature,
                message
            })
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Unknown error' }));
            throw new Error(`Failed to claim username: ${error.error || response.statusText}`);
        }

        return await response.json();
    }
}
