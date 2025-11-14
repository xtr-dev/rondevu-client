import { Credentials, FetchFunction } from './auth.js';
import { RondevuAuth } from './auth.js';

// Declare Buffer for Node.js compatibility
declare const Buffer: any;

export interface CreateOfferRequest {
  id?: string;
  sdp: string;
  topics: string[];
  ttl?: number;
}

export interface Offer {
  id: string;
  peerId: string;
  sdp: string;
  topics: string[];
  createdAt?: number;
  expiresAt: number;
  lastSeen: number;
  answererPeerId?: string;
  answerSdp?: string;
  answeredAt?: number;
}

export interface IceCandidate {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
  peerId: string;
  role: 'offerer' | 'answerer';
  createdAt: number;
}

export interface TopicInfo {
  topic: string;
  activePeers: number;
}

export class RondevuOffers {
  private fetchFn: FetchFunction;

  constructor(
    private baseUrl: string,
    private credentials: Credentials,
    fetchFn?: FetchFunction
  ) {
    // Use provided fetch or fall back to global fetch
    this.fetchFn = fetchFn || ((...args) => {
      if (typeof globalThis.fetch === 'function') {
        return globalThis.fetch(...args);
      }
      throw new Error(
        'fetch is not available. Please provide a fetch implementation in the constructor options.'
      );
    });
  }

  /**
   * Create one or more offers
   */
  async create(offers: CreateOfferRequest[]): Promise<Offer[]> {
    const response = await this.fetchFn(`${this.baseUrl}/offers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: RondevuAuth.createAuthHeader(this.credentials),
      },
      body: JSON.stringify({ offers }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(`Failed to create offers: ${error.error || response.statusText}`);
    }

    const data = await response.json();
    return data.offers;
  }

  /**
   * Find offers by topic with optional bloom filter
   */
  async findByTopic(
    topic: string,
    options?: {
      bloomFilter?: Uint8Array;
      limit?: number;
    }
  ): Promise<Offer[]> {
    const params = new URLSearchParams();

    if (options?.bloomFilter) {
      // Convert to base64
      const binaryString = String.fromCharCode(...Array.from(options.bloomFilter));
      const base64 = typeof btoa !== 'undefined'
        ? btoa(binaryString)
        : (typeof Buffer !== 'undefined' ? Buffer.from(options.bloomFilter).toString('base64') : '');
      params.set('bloom', base64);
    }

    if (options?.limit) {
      params.set('limit', options.limit.toString());
    }

    const url = `${this.baseUrl}/offers/by-topic/${encodeURIComponent(topic)}${
      params.toString() ? '?' + params.toString() : ''
    }`;

    const response = await this.fetchFn(url, {
      method: 'GET',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(`Failed to find offers: ${error.error || response.statusText}`);
    }

    const data = await response.json();
    return data.offers;
  }

  /**
   * Get all offers from a specific peer
   */
  async getByPeerId(peerId: string): Promise<{
    offers: Offer[];
    topics: string[];
  }> {
    const response = await this.fetchFn(`${this.baseUrl}/peers/${encodeURIComponent(peerId)}/offers`, {
      method: 'GET',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(`Failed to get peer offers: ${error.error || response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Get topics with active peer counts (paginated)
   */
  async getTopics(options?: {
    limit?: number;
    offset?: number;
  }): Promise<{
    topics: TopicInfo[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const params = new URLSearchParams();

    if (options?.limit) {
      params.set('limit', options.limit.toString());
    }

    if (options?.offset) {
      params.set('offset', options.offset.toString());
    }

    const url = `${this.baseUrl}/topics${
      params.toString() ? '?' + params.toString() : ''
    }`;

    const response = await this.fetchFn(url, {
      method: 'GET',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(`Failed to get topics: ${error.error || response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Get own offers
   */
  async getMine(): Promise<Offer[]> {
    const response = await this.fetchFn(`${this.baseUrl}/offers/mine`, {
      method: 'GET',
      headers: {
        Authorization: RondevuAuth.createAuthHeader(this.credentials),
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(`Failed to get own offers: ${error.error || response.statusText}`);
    }

    const data = await response.json();
    return data.offers;
  }

  /**
   * Update offer heartbeat
   */
  async heartbeat(offerId: string): Promise<void> {
    const response = await this.fetchFn(`${this.baseUrl}/offers/${encodeURIComponent(offerId)}/heartbeat`, {
      method: 'PUT',
      headers: {
        Authorization: RondevuAuth.createAuthHeader(this.credentials),
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(`Failed to update heartbeat: ${error.error || response.statusText}`);
    }
  }

  /**
   * Delete an offer
   */
  async delete(offerId: string): Promise<void> {
    const response = await this.fetchFn(`${this.baseUrl}/offers/${encodeURIComponent(offerId)}`, {
      method: 'DELETE',
      headers: {
        Authorization: RondevuAuth.createAuthHeader(this.credentials),
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(`Failed to delete offer: ${error.error || response.statusText}`);
    }
  }

  /**
   * Answer an offer
   */
  async answer(offerId: string, sdp: string): Promise<void> {
    const response = await this.fetchFn(`${this.baseUrl}/offers/${encodeURIComponent(offerId)}/answer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: RondevuAuth.createAuthHeader(this.credentials),
      },
      body: JSON.stringify({ sdp }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(`Failed to answer offer: ${error.error || response.statusText}`);
    }
  }

  /**
   * Get answers to your offers
   */
  async getAnswers(): Promise<Array<{
    offerId: string;
    answererId: string;
    sdp: string;
    answeredAt: number;
    topics: string[];
  }>> {
    const response = await this.fetchFn(`${this.baseUrl}/offers/answers`, {
      method: 'GET',
      headers: {
        Authorization: RondevuAuth.createAuthHeader(this.credentials),
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(`Failed to get answers: ${error.error || response.statusText}`);
    }

    const data = await response.json();
    return data.answers;
  }

  /**
   * Post ICE candidates for an offer
   */
  async addIceCandidates(
    offerId: string,
    candidates: Array<{
      candidate: string;
      sdpMid?: string | null;
      sdpMLineIndex?: number | null;
    }>
  ): Promise<void> {
    const response = await this.fetchFn(`${this.baseUrl}/offers/${encodeURIComponent(offerId)}/ice-candidates`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: RondevuAuth.createAuthHeader(this.credentials),
      },
      body: JSON.stringify({ candidates }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(`Failed to add ICE candidates: ${error.error || response.statusText}`);
    }
  }

  /**
   * Get ICE candidates for an offer
   */
  async getIceCandidates(offerId: string, since?: number): Promise<IceCandidate[]> {
    const params = new URLSearchParams();
    if (since !== undefined) {
      params.set('since', since.toString());
    }

    const url = `${this.baseUrl}/offers/${encodeURIComponent(offerId)}/ice-candidates${
      params.toString() ? '?' + params.toString() : ''
    }`;

    const response = await this.fetchFn(url, {
      method: 'GET',
      headers: {
        Authorization: RondevuAuth.createAuthHeader(this.credentials),
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(`Failed to get ICE candidates: ${error.error || response.statusText}`);
    }

    const data = await response.json();
    return data.candidates;
  }
}
