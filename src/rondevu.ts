import { RondevuAuth, Credentials, FetchFunction } from './auth.js';
import { RondevuOffers } from './offers.js';
import { RondevuUsername } from './usernames.js';
import RondevuPeer from './peer/index.js';
import { DurableService } from './durable/service.js';
import { DurableConnection } from './durable/connection.js';
import { DurableChannel } from './durable/channel.js';
import type {
  DurableServiceConfig,
  DurableConnectionConfig,
  ConnectionInfo
} from './durable/types.js';

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
  readonly usernames: RondevuUsername;

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
    this.usernames = new RondevuUsername(this.baseUrl);

    if (options.credentials) {
      this.credentials = options.credentials;
      this._offers = new RondevuOffers(this.baseUrl, this.credentials, this.fetchFn);
    }
  }

  /**
   * Get offers API (low-level access, requires authentication)
   * For most use cases, use the durable connection APIs instead
   */
  get offers(): RondevuOffers {
    if (!this._offers) {
      throw new Error('Not authenticated. Call register() first or provide credentials.');
    }
    return this._offers;
  }

  /**
   * Register and initialize authenticated client
   * Generates a cryptographically random peer ID (128-bit)
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
      undefined, // No existing peer connection
      this.rtcPeerConnection,
      this.rtcSessionDescription,
      this.rtcIceCandidate
    );
  }

  /**
   * Expose a durable service with automatic reconnection and TTL refresh
   *
   * Creates a service that handles incoming connections with automatic
   * reconnection and message queuing during network interruptions.
   *
   * @param config Service configuration
   * @returns DurableService instance
   *
   * @example
   * ```typescript
   * const service = await client.exposeService({
   *   username: 'alice',
   *   privateKey: keypair.privateKey,
   *   serviceFqn: 'chat@1.0.0',
   *   poolSize: 10,
   *   handler: (channel, connectionId) => {
   *     channel.on('message', (data) => {
   *       console.log('Received:', data);
   *       channel.send(`Echo: ${data}`);
   *     });
   *   }
   * });
   *
   * await service.start();
   * ```
   */
  async exposeService(
    config: DurableServiceConfig & {
      handler: (channel: DurableChannel, connectionId: string) => void | Promise<void>;
    }
  ): Promise<DurableService> {
    if (!this._offers || !this.credentials) {
      throw new Error('Not authenticated. Call register() first or provide credentials.');
    }

    const service = new DurableService(
      this._offers,
      this.baseUrl,
      this.credentials,
      config.handler,
      config
    );

    return service;
  }

  /**
   * Create a durable connection to a service by username and service FQN
   *
   * Establishes a WebRTC connection with automatic reconnection and
   * message queuing during network interruptions.
   *
   * @param username Username of the service provider
   * @param serviceFqn Fully qualified service name
   * @param config Optional connection configuration
   * @returns DurableConnection instance
   *
   * @example
   * ```typescript
   * const connection = await client.connect('alice', 'chat@1.0.0', {
   *   maxReconnectAttempts: 5
   * });
   *
   * const channel = connection.createChannel('main');
   * channel.on('message', (data) => {
   *   console.log('Received:', data);
   * });
   *
   * await connection.connect();
   * channel.send('Hello!');
   * ```
   */
  async connect(
    username: string,
    serviceFqn: string,
    config?: DurableConnectionConfig
  ): Promise<DurableConnection> {
    if (!this._offers) {
      throw new Error('Not authenticated. Call register() first or provide credentials.');
    }

    const connectionInfo: ConnectionInfo = {
      username,
      serviceFqn
    };

    return new DurableConnection(this._offers, connectionInfo, config);
  }

  /**
   * Create a durable connection to a service by UUID
   *
   * Establishes a WebRTC connection with automatic reconnection and
   * message queuing during network interruptions.
   *
   * @param uuid Service UUID
   * @param config Optional connection configuration
   * @returns DurableConnection instance
   *
   * @example
   * ```typescript
   * const connection = await client.connectByUuid('service-uuid-here', {
   *   maxReconnectAttempts: 5
   * });
   *
   * const channel = connection.createChannel('main');
   * channel.on('message', (data) => {
   *   console.log('Received:', data);
   * });
   *
   * await connection.connect();
   * channel.send('Hello!');
   * ```
   */
  async connectByUuid(
    uuid: string,
    config?: DurableConnectionConfig
  ): Promise<DurableConnection> {
    if (!this._offers) {
      throw new Error('Not authenticated. Call register() first or provide credentials.');
    }

    const connectionInfo: ConnectionInfo = {
      uuid
    };

    return new DurableConnection(this._offers, connectionInfo, config);
  }
}
