import { RondevuOffers, Offer } from './offers.js';
import { RondevuUsername } from './usernames.js';
import RondevuPeer from './peer/index.js';
import { OfferPool, AnsweredOffer } from './offer-pool.js';
import { ServiceHandle } from './services.js';

/**
 * Connection information for tracking active connections
 */
interface ConnectionInfo {
  peer: RondevuPeer;
  channel: RTCDataChannel;
  connectedAt: number;
  offerId: string;
}

/**
 * Status information about the pool
 */
export interface PoolStatus {
  /** Number of active offers in the pool */
  activeOffers: number;

  /** Number of currently connected peers */
  activeConnections: number;

  /** Total number of connections handled since start */
  totalConnectionsHandled: number;

  /** Number of failed offer creation attempts */
  failedOfferCreations: number;
}

/**
 * Configuration options for a pooled service
 */
export interface ServicePoolOptions {
  /** Username that owns the service */
  username: string;

  /** Private key for signing service operations */
  privateKey: string;

  /** Fully qualified service name (e.g., com.example.chat@1.0.0) */
  serviceFqn: string;

  /** WebRTC configuration */
  rtcConfig?: RTCConfiguration;

  /** Whether the service is publicly discoverable */
  isPublic?: boolean;

  /** Optional metadata for the service */
  metadata?: Record<string, any>;

  /** Time-to-live for offers in milliseconds */
  ttl?: number;

  /** Handler invoked for each new connection */
  handler: (channel: RTCDataChannel, peer: RondevuPeer, connectionId: string) => void;

  /** Number of simultaneous open offers to maintain (default: 1) */
  poolSize?: number;

  /** Polling interval in milliseconds (default: 2000ms) */
  pollingInterval?: number;

  /** Callback for pool status updates */
  onPoolStatus?: (status: PoolStatus) => void;

  /** Error handler for pool operations */
  onError?: (error: Error, context: string) => void;
}

/**
 * Extended service handle with pool-specific methods
 */
export interface PooledServiceHandle extends ServiceHandle {
  /** Get current pool status */
  getStatus: () => PoolStatus;

  /** Manually add offers to the pool */
  addOffers: (count: number) => Promise<void>;
}

/**
 * Manages a pooled service with multiple concurrent connections
 *
 * ServicePool coordinates offer creation, answer polling, and connection
 * management for services that need to handle multiple simultaneous connections.
 */
export class ServicePool {
  private offerPool?: OfferPool;
  private connections: Map<string, ConnectionInfo> = new Map();
  private status: PoolStatus = {
    activeOffers: 0,
    activeConnections: 0,
    totalConnectionsHandled: 0,
    failedOfferCreations: 0
  };
  private serviceId?: string;
  private uuid?: string;
  private offersApi: RondevuOffers;
  private usernameApi: RondevuUsername;

  constructor(
    private baseUrl: string,
    private credentials: { peerId: string; secret: string },
    private options: ServicePoolOptions
  ) {
    this.offersApi = new RondevuOffers(baseUrl, credentials);
    this.usernameApi = new RondevuUsername(baseUrl);
  }

  /**
   * Start the pooled service
   */
  async start(): Promise<PooledServiceHandle> {
    const poolSize = this.options.poolSize || 1;

    // 1. Create initial service (publishes first offer)
    const service = await this.publishInitialService();
    this.serviceId = service.serviceId;
    this.uuid = service.uuid;

    // 2. Create additional offers for pool (poolSize - 1)
    const additionalOffers: Offer[] = [];
    if (poolSize > 1) {
      try {
        const offers = await this.createOffers(poolSize - 1);
        additionalOffers.push(...offers);
      } catch (error) {
        this.handleError(error as Error, 'initial-offer-creation');
      }
    }

    // 3. Initialize OfferPool with all offers
    this.offerPool = new OfferPool(this.offersApi, {
      poolSize,
      pollingInterval: this.options.pollingInterval || 2000,
      onAnswered: (answer) => this.handleConnection(answer),
      onRefill: (count) => this.createOffers(count),
      onError: (err, ctx) => this.handleError(err, ctx)
    });

    // Add all offers to pool
    const allOffers = [
      { id: service.offerId, peerId: this.credentials.peerId, sdp: '', topics: [], expiresAt: service.expiresAt, lastSeen: Date.now() },
      ...additionalOffers
    ];
    await this.offerPool.addOffers(allOffers);

    // 4. Start polling
    await this.offerPool.start();

    // Update status
    this.updateStatus();

    // 5. Return handle
    return {
      serviceId: this.serviceId,
      uuid: this.uuid,
      offerId: service.offerId,
      unpublish: () => this.stop(),
      getStatus: () => this.getStatus(),
      addOffers: (count) => this.manualRefill(count)
    };
  }

  /**
   * Stop the pooled service and clean up
   */
  async stop(): Promise<void> {
    // 1. Stop accepting new connections
    if (this.offerPool) {
      await this.offerPool.stop();
    }

    // 2. Delete remaining offers
    if (this.offerPool) {
      const offerIds = this.offerPool.getActiveOfferIds();
      await Promise.allSettled(
        offerIds.map(id => this.offersApi.delete(id).catch(() => {}))
      );
    }

    // 3. Close active connections
    const closePromises = Array.from(this.connections.values()).map(
      async (conn) => {
        try {
          // Give a brief moment for graceful closure
          await new Promise(resolve => setTimeout(resolve, 100));
          conn.peer.pc.close();
        } catch {
          // Ignore errors during cleanup
        }
      }
    );
    await Promise.allSettled(closePromises);

    // 4. Delete service if we have a serviceId
    if (this.serviceId) {
      try {
        const response = await fetch(`${this.baseUrl}/services/${this.serviceId}`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.credentials.peerId}:${this.credentials.secret}`
          },
          body: JSON.stringify({ username: this.options.username })
        });

        if (!response.ok) {
          console.error('Failed to delete service:', await response.text());
        }
      } catch (error) {
        console.error('Error deleting service:', error);
      }
    }

    // Clear all state
    this.connections.clear();
    this.offerPool = undefined;
  }

  /**
   * Handle an answered offer by setting up the connection
   */
  private async handleConnection(answer: AnsweredOffer): Promise<void> {
    const connectionId = this.generateConnectionId();

    try {
      // Create peer connection
      const peer = new RondevuPeer(
        this.offersApi,
        this.options.rtcConfig || {
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        }
      );

      peer.role = 'offerer';
      peer.offerId = answer.offerId;

      // Set remote description (the answer)
      await peer.pc.setRemoteDescription({
        type: 'answer',
        sdp: answer.sdp
      });

      // Wait for data channel (answerer creates it, we receive it)
      const channel = await new Promise<RTCDataChannel>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('Timeout waiting for data channel')),
          30000
        );

        peer.on('datachannel', (ch: RTCDataChannel) => {
          clearTimeout(timeout);
          resolve(ch);
        });

        // Also check if channel already exists
        if (peer.pc.ondatachannel) {
          const existingHandler = peer.pc.ondatachannel;
          peer.pc.ondatachannel = (event) => {
            clearTimeout(timeout);
            resolve(event.channel);
            if (existingHandler) existingHandler.call(peer.pc, event);
          };
        } else {
          peer.pc.ondatachannel = (event) => {
            clearTimeout(timeout);
            resolve(event.channel);
          };
        }
      });

      // Register connection
      this.connections.set(connectionId, {
        peer,
        channel,
        connectedAt: Date.now(),
        offerId: answer.offerId
      });

      this.status.activeConnections++;
      this.status.totalConnectionsHandled++;

      // Setup cleanup on disconnect
      peer.on('disconnected', () => {
        this.connections.delete(connectionId);
        this.status.activeConnections--;
        this.updateStatus();
      });

      peer.on('failed', () => {
        this.connections.delete(connectionId);
        this.status.activeConnections--;
        this.updateStatus();
      });

      // Update status
      this.updateStatus();

      // Invoke user handler (wrapped in try-catch)
      try {
        this.options.handler(channel, peer, connectionId);
      } catch (handlerError) {
        this.handleError(handlerError as Error, 'handler');
      }

    } catch (error) {
      this.handleError(error as Error, 'connection-setup');
    }
  }

  /**
   * Create multiple offers
   */
  private async createOffers(count: number): Promise<Offer[]> {
    if (count <= 0) {
      return [];
    }

    // Server supports max 10 offers per request
    const batchSize = Math.min(count, 10);
    const offers: Offer[] = [];

    try {
      // Create peer connections and generate offers
      const offerRequests = [];
      for (let i = 0; i < batchSize; i++) {
        const pc = new RTCPeerConnection(this.options.rtcConfig || {
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });

        // Create data channel (required for offers)
        pc.createDataChannel('rondevu-service');

        // Create offer
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        if (!offer.sdp) {
          pc.close();
          throw new Error('Failed to generate SDP');
        }

        offerRequests.push({
          sdp: offer.sdp,
          topics: [], // V2 doesn't use topics
          ttl: this.options.ttl
        });

        // Close the PC immediately - we only needed the SDP
        pc.close();
      }

      // Batch create offers
      const createdOffers = await this.offersApi.create(offerRequests);
      offers.push(...createdOffers);

    } catch (error) {
      this.status.failedOfferCreations++;
      this.handleError(error as Error, 'offer-creation');
      throw error;
    }

    return offers;
  }

  /**
   * Publish the initial service (creates first offer)
   */
  private async publishInitialService(): Promise<{
    serviceId: string;
    uuid: string;
    offerId: string;
    expiresAt: number;
  }> {
    const { username, privateKey, serviceFqn, rtcConfig, isPublic, metadata, ttl } = this.options;

    // Create peer connection for initial offer
    const pc = new RTCPeerConnection(rtcConfig || {
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    pc.createDataChannel('rondevu-service');

    // Create offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    if (!offer.sdp) {
      pc.close();
      throw new Error('Failed to generate SDP');
    }

    // Create signature
    const timestamp = Date.now();
    const message = `publish:${username}:${serviceFqn}:${timestamp}`;
    const signature = await this.usernameApi.signMessage(message, privateKey);

    // Publish service
    const response = await fetch(`${this.baseUrl}/services`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.credentials.peerId}:${this.credentials.secret}`
      },
      body: JSON.stringify({
        username,
        serviceFqn,
        sdp: offer.sdp,
        ttl,
        isPublic,
        metadata,
        signature,
        message
      })
    });

    pc.close();

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to publish service');
    }

    const data = await response.json();

    return {
      serviceId: data.serviceId,
      uuid: data.uuid,
      offerId: data.offerId,
      expiresAt: data.expiresAt
    };
  }

  /**
   * Manually add offers to the pool
   */
  private async manualRefill(count: number): Promise<void> {
    if (!this.offerPool) {
      throw new Error('Pool not started');
    }

    const offers = await this.createOffers(count);
    await this.offerPool.addOffers(offers);
    this.updateStatus();
  }

  /**
   * Get current pool status
   */
  private getStatus(): PoolStatus {
    return { ...this.status };
  }

  /**
   * Update status and notify listeners
   */
  private updateStatus(): void {
    if (this.offerPool) {
      this.status.activeOffers = this.offerPool.getActiveOfferCount();
    }

    if (this.options.onPoolStatus) {
      this.options.onPoolStatus(this.getStatus());
    }
  }

  /**
   * Handle errors
   */
  private handleError(error: Error, context: string): void {
    if (this.options.onError) {
      this.options.onError(error, context);
    } else {
      console.error(`ServicePool error (${context}):`, error);
    }
  }

  /**
   * Generate a unique connection ID
   */
  private generateConnectionId(): string {
    return `conn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
