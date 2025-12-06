/**
 * DurableService - Service with automatic TTL refresh
 *
 * Manages service publishing with automatic reconnection for incoming
 * connections and TTL auto-refresh to prevent expiration.
 */

import { EventEmitter } from '../event-emitter.js';
import { ServicePool, type PoolStatus } from '../service-pool.js';
import type { RondevuOffers } from '../offers.js';
import { DurableChannel } from './channel.js';
import type {
  DurableServiceConfig,
  DurableServiceEvents,
  ServiceInfo
} from './types.js';

/**
 * Connection handler callback
 */
export type ConnectionHandler = (
  channel: DurableChannel,
  connectionId: string
) => void | Promise<void>;

/**
 * Default configuration for durable services
 */
const DEFAULT_CONFIG = {
  isPublic: false,
  ttlRefreshMargin: 0.2,
  poolSize: 1,
  pollingInterval: 2000,
  maxReconnectAttempts: 10,
  reconnectBackoffBase: 1000,
  reconnectBackoffMax: 30000,
  reconnectJitter: 0.2,
  connectionTimeout: 30000,
  maxQueueSize: 1000,
  maxMessageAge: 60000,
  rtcConfig: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  }
};

/**
 * Durable service that automatically refreshes TTL and handles reconnections
 *
 * The DurableService manages service publishing and provides:
 * - Automatic TTL refresh before expiration
 * - Durable connections for incoming peers
 * - Connection pooling for multiple simultaneous connections
 * - High-level connection lifecycle events
 *
 * @example
 * ```typescript
 * const service = new DurableService(
 *   offersApi,
 *   (channel, connectionId) => {
 *     channel.on('message', (data) => {
 *       console.log(`Message from ${connectionId}:`, data);
 *       channel.send(`Echo: ${data}`);
 *     });
 *   },
 *   {
 *     username: 'alice',
 *     privateKey: keypair.privateKey,
 *     serviceFqn: 'chat@1.0.0',
 *     poolSize: 10
 *   }
 * );
 *
 * service.on('published', (serviceId, uuid) => {
 *   console.log(`Service published: ${uuid}`);
 * });
 *
 * service.on('connection', (connectionId) => {
 *   console.log(`New connection: ${connectionId}`);
 * });
 *
 * await service.start();
 * ```
 */
export class DurableService extends EventEmitter<DurableServiceEvents> {
  readonly config: Required<DurableServiceConfig>;

  private serviceId?: string;
  private uuid?: string;
  private expiresAt?: number;
  private ttlRefreshTimer?: ReturnType<typeof setTimeout>;
  private servicePool?: ServicePool;
  private activeChannels: Map<string, DurableChannel> = new Map();

  constructor(
    private offersApi: RondevuOffers,
    private baseUrl: string,
    private credentials: { peerId: string; secret: string },
    private handler: ConnectionHandler,
    config: DurableServiceConfig
  ) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config } as Required<DurableServiceConfig>;
  }

  /**
   * Start the service
   *
   * Publishes the service and begins accepting connections.
   *
   * @returns Service information
   */
  async start(): Promise<ServiceInfo> {
    if (this.servicePool) {
      throw new Error('Service already started');
    }

    // Create and start service pool
    this.servicePool = new ServicePool(
      this.baseUrl,
      this.credentials,
      {
        username: this.config.username,
        privateKey: this.config.privateKey,
        serviceFqn: this.config.serviceFqn,
        rtcConfig: this.config.rtcConfig,
        isPublic: this.config.isPublic,
        metadata: this.config.metadata,
        ttl: this.config.ttl,
        poolSize: this.config.poolSize,
        pollingInterval: this.config.pollingInterval,
        handler: (channel, peer, connectionId) => {
          this.handleNewConnection(channel, connectionId);
        },
        onPoolStatus: (status) => {
          // Could emit pool status event if needed
        },
        onError: (error, context) => {
          this.emit('error', error, context);
        }
      }
    );

    const handle = await this.servicePool.start();

    // Store service info
    this.serviceId = handle.serviceId;
    this.uuid = handle.uuid;
    this.expiresAt = Date.now() + (this.config.ttl || 300000); // Default 5 minutes

    this.emit('published', this.serviceId, this.uuid);

    // Schedule TTL refresh
    this.scheduleRefresh();

    return {
      serviceId: this.serviceId,
      uuid: this.uuid,
      expiresAt: this.expiresAt
    };
  }

  /**
   * Stop the service
   *
   * Unpublishes the service and closes all active connections.
   */
  async stop(): Promise<void> {
    // Cancel TTL refresh
    if (this.ttlRefreshTimer) {
      clearTimeout(this.ttlRefreshTimer);
      this.ttlRefreshTimer = undefined;
    }

    // Close all active channels
    for (const channel of this.activeChannels.values()) {
      channel.close();
    }
    this.activeChannels.clear();

    // Stop service pool
    if (this.servicePool) {
      await this.servicePool.stop();
      this.servicePool = undefined;
    }

    this.emit('closed');
  }

  /**
   * Get list of active connection IDs
   */
  getActiveConnections(): string[] {
    return Array.from(this.activeChannels.keys());
  }

  /**
   * Get service information
   */
  getServiceInfo(): ServiceInfo | null {
    if (!this.serviceId || !this.uuid || !this.expiresAt) {
      return null;
    }

    return {
      serviceId: this.serviceId,
      uuid: this.uuid,
      expiresAt: this.expiresAt
    };
  }

  /**
   * Schedule TTL refresh
   */
  private scheduleRefresh(): void {
    if (!this.expiresAt || !this.config.ttl) {
      return;
    }

    // Cancel existing timer
    if (this.ttlRefreshTimer) {
      clearTimeout(this.ttlRefreshTimer);
    }

    // Calculate refresh time (default: refresh at 80% of TTL)
    const timeUntilExpiry = this.expiresAt - Date.now();
    const refreshMargin = timeUntilExpiry * this.config.ttlRefreshMargin;
    const refreshTime = Math.max(0, timeUntilExpiry - refreshMargin);

    // Schedule refresh
    this.ttlRefreshTimer = setTimeout(() => {
      this.refreshServiceTTL().catch(error => {
        this.emit('error', error, 'ttl-refresh');
        // Retry after short delay
        setTimeout(() => this.scheduleRefresh(), 5000);
      });
    }, refreshTime);
  }

  /**
   * Refresh service TTL
   */
  private async refreshServiceTTL(): Promise<void> {
    if (!this.serviceId || !this.uuid) {
      return;
    }

    // Delete old service
    await this.servicePool?.stop();

    // Recreate service pool (this republishes the service)
    this.servicePool = new ServicePool(
      this.baseUrl,
      this.credentials,
      {
        username: this.config.username,
        privateKey: this.config.privateKey,
        serviceFqn: this.config.serviceFqn,
        rtcConfig: this.config.rtcConfig,
        isPublic: this.config.isPublic,
        metadata: this.config.metadata,
        ttl: this.config.ttl,
        poolSize: this.config.poolSize,
        pollingInterval: this.config.pollingInterval,
        handler: (channel, peer, connectionId) => {
          this.handleNewConnection(channel, connectionId);
        },
        onPoolStatus: (status) => {
          // Could emit pool status event if needed
        },
        onError: (error, context) => {
          this.emit('error', error, context);
        }
      }
    );

    const handle = await this.servicePool.start();

    // Update service info
    this.serviceId = handle.serviceId;
    this.uuid = handle.uuid;
    this.expiresAt = Date.now() + (this.config.ttl || 300000);

    this.emit('ttl-refreshed', this.expiresAt);

    // Schedule next refresh
    this.scheduleRefresh();
  }

  /**
   * Handle new incoming connection
   */
  private handleNewConnection(channel: RTCDataChannel, connectionId: string): void {
    // Create durable channel
    const durableChannel = new DurableChannel(channel.label, {
      maxQueueSize: this.config.maxQueueSize,
      maxMessageAge: this.config.maxMessageAge
    });

    // Attach to underlying channel
    durableChannel.attachToChannel(channel);

    // Track channel
    this.activeChannels.set(connectionId, durableChannel);

    // Setup cleanup on close
    durableChannel.on('close', () => {
      this.activeChannels.delete(connectionId);
      this.emit('disconnection', connectionId);
    });

    // Emit connection event
    this.emit('connection', connectionId);

    // Invoke user handler
    try {
      const result = this.handler(durableChannel, connectionId);
      if (result && typeof result.then === 'function') {
        result.catch(error => {
          this.emit('error', error, 'handler');
        });
      }
    } catch (error) {
      this.emit('error', error as Error, 'handler');
    }
  }
}
