import { RondevuAuth, Credentials, FetchFunction } from './auth.js';
import { RondevuOffers } from './offers.js';
import { RondevuConnection, ConnectionOptions } from './connection.js';

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
}

export class Rondevu {
  readonly auth: RondevuAuth;
  private _offers?: RondevuOffers;
  private credentials?: Credentials;
  private baseUrl: string;
  private fetchFn?: FetchFunction;

  constructor(options: RondevuOptions = {}) {
    this.baseUrl = options.baseUrl || 'https://api.ronde.vu';
    this.fetchFn = options.fetch;

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
   */
  async register(): Promise<Credentials> {
    this.credentials = await this.auth.register();

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
   * Create a new WebRTC connection (requires authentication)
   * This is a high-level helper that creates and manages WebRTC connections
   *
   * @param rtcConfig Optional RTCConfiguration for the peer connection
   * @returns RondevuConnection instance
   */
  createConnection(rtcConfig?: RTCConfiguration): RondevuConnection {
    if (!this._offers) {
      throw new Error('Not authenticated. Call register() first or provide credentials.');
    }

    return new RondevuConnection(this._offers, rtcConfig);
  }
}
