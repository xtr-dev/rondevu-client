import { RondevuAuth, Credentials, FetchFunction } from './auth.js';
import { RondevuOffers } from './offers.js';
import RondevuPeer from './peer/index.js';

export interface RondevuOptions {
  /**
   * Base URL of the Rondevu server
   * @default 'https://api.ronde.vu'
   */
  baseUrl?: string;

  /**
   * Existing credentials (peerId + secret) to skip registration
   */
  credentials?: Credentials;

  /**
   * Custom fetch implementation for environments without native fetch
   * (Node.js < 18, some Workers environments, etc.)
   *
   * @example Node.js
   * ```typescript
   * import fetch from 'node-fetch';
   * const client = new Rondevu({ fetch });
   * ```
   */
  fetch?: FetchFunction;

  /**
   * Custom RTCPeerConnection implementation for Node.js environments
   * Required when using in Node.js with wrtc or similar polyfills
   *
   * @example Node.js with wrtc
   * ```typescript
   * import { RTCPeerConnection } from 'wrtc';
   * const client = new Rondevu({ RTCPeerConnection });
   * ```
   */
  RTCPeerConnection?: typeof RTCPeerConnection;

  /**
   * Custom RTCSessionDescription implementation for Node.js environments
   * Required when using in Node.js with wrtc or similar polyfills
   *
   * @example Node.js with wrtc
   * ```typescript
   * import { RTCSessionDescription } from 'wrtc';
   * const client = new Rondevu({ RTCSessionDescription });
   * ```
   */
  RTCSessionDescription?: typeof RTCSessionDescription;

  /**
   * Custom RTCIceCandidate implementation for Node.js environments
   * Required when using in Node.js with wrtc or similar polyfills
   *
   * @example Node.js with wrtc
   * ```typescript
   * import { RTCIceCandidate } from 'wrtc';
   * const client = new Rondevu({ RTCIceCandidate });
   * ```
   */
  RTCIceCandidate?: typeof RTCIceCandidate;
}

export class Rondevu {
  readonly auth: RondevuAuth;
  private _offers?: RondevuOffers;
  private credentials?: Credentials;
  private baseUrl: string;
  private fetchFn?: FetchFunction;
  private rtcPeerConnection?: typeof RTCPeerConnection;
  private rtcSessionDescription?: typeof RTCSessionDescription;
  private rtcIceCandidate?: typeof RTCIceCandidate;

  constructor(options: RondevuOptions = {}) {
    this.baseUrl = options.baseUrl || 'https://api.ronde.vu';
    this.fetchFn = options.fetch;
    this.rtcPeerConnection = options.RTCPeerConnection;
    this.rtcSessionDescription = options.RTCSessionDescription;
    this.rtcIceCandidate = options.RTCIceCandidate;

    this.auth = new RondevuAuth(this.baseUrl, this.fetchFn);

    if (options.credentials) {
      this.credentials = options.credentials;
      this._offers = new RondevuOffers(this.baseUrl, this.credentials, this.fetchFn);
    }
  }

  /**
   * Get offers API (requires authentication)
   */
  get offers(): RondevuOffers {
    if (!this._offers) {
      throw new Error('Not authenticated. Call register() first or provide credentials.');
    }
    return this._offers;
  }

  /**
   * Register and initialize authenticated client
   * @param customPeerId - Optional custom peer ID (1-128 characters). If not provided, a random ID will be generated.
   */
  async register(customPeerId?: string): Promise<Credentials> {
    this.credentials = await this.auth.register(customPeerId);

    // Create offers API instance
    this._offers = new RondevuOffers(
      this.baseUrl,
      this.credentials,
      this.fetchFn
    );

    return this.credentials;
  }

  /**
   * Check if client is authenticated
   */
  isAuthenticated(): boolean {
    return !!this.credentials;
  }

  /**
   * Get current credentials
   */
  getCredentials(): Credentials | undefined {
    return this.credentials;
  }

  /**
   * Create a new WebRTC peer connection (requires authentication)
   * This is a high-level helper that creates and manages WebRTC connections with state management
   *
   * @param rtcConfig Optional RTCConfiguration for the peer connection
   * @returns RondevuPeer instance
   */
  createPeer(rtcConfig?: RTCConfiguration): RondevuPeer {
    if (!this._offers) {
      throw new Error('Not authenticated. Call register() first or provide credentials.');
    }

    return new RondevuPeer(
      this._offers,
      rtcConfig,
      this.rtcPeerConnection,
      this.rtcSessionDescription,
      this.rtcIceCandidate
    );
  }
}
