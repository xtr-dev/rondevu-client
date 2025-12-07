import { RondevuOffers, Offer } from './offers.js';
import { RondevuUsername } from './usernames.js';
import RondevuPeer from './peer/index.js';
import { OfferPool, AnsweredOffer } from './offer-pool.js';

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
 * Service handle with pool-specific methods
 */
export interface PooledServiceHandle {
  /** Service ID */
  serviceId: string;

  /** Service UUID */
  uuid: string;

  /** Offer ID */
  offerId: string;

  /** Unpublish the service */
  unpublish: () => Promise<void>;

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
  private peerConnections: Map<string, RTCPeerConnection> = new Map();
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
    const additionalPeerConnections: RTCPeerConnection[] = [];
    const additionalDataChannels: RTCDataChannel[] = [];
    if (poolSize > 1) {
      try {
        const result = await this.createOffers(poolSize - 1);
        additionalOffers.push(...result.offers);
        additionalPeerConnections.push(...result.peerConnections);
        additionalDataChannels.push(...result.dataChannels);
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

    // Add all offers to pool with their peer connections and data channels
    const allOffers = [
      { id: service.offerId, peerId: this.credentials.peerId, sdp: service.offerSdp, topics: [], expiresAt: service.expiresAt, lastSeen: Date.now() },
      ...additionalOffers
    ];
    const allPeerConnections = [
      service.peerConnection,
      ...additionalPeerConnections
    ];
    const allDataChannels = [
      service.dataChannel,
      ...additionalDataChannels
    ];
    await this.offerPool.addOffers(allOffers, allPeerConnections, allDataChannels);

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

    // 2. Close peer connections from the pool
    if (this.offerPool) {
      const poolPeerConnections = this.offerPool.getActivePeerConnections();
      poolPeerConnections.forEach(pc => {
        try {
          pc.close();
        } catch {
          // Ignore errors during cleanup
        }
      });
    }

    // 3. Delete remaining offers
    if (this.offerPool) {
      const offerIds = this.offerPool.getActiveOfferIds();
      await Promise.allSettled(
        offerIds.map(id => this.offersApi.delete(id).catch(() => {}))
      );
    }

    // 4. Close active connections
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

    // 5. Delete service if we have a serviceId
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
      // Use the existing peer connection from the pool
      const peer = new RondevuPeer(
        this.offersApi,
        this.options.rtcConfig || {
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        },
        answer.peerConnection // Use the existing peer connection
      );

      peer.role = 'offerer';
      peer.offerId = answer.offerId;

      // Verify peer connection is in correct state
      if (peer.pc.signalingState !== 'have-local-offer') {
        console.error('Peer connection state info:', {
          signalingState: peer.pc.signalingState,
          connectionState: peer.pc.connectionState,
          iceConnectionState: peer.pc.iceConnectionState,
          iceGatheringState: peer.pc.iceGatheringState,
          hasLocalDescription: !!peer.pc.localDescription,
          hasRemoteDescription: !!peer.pc.remoteDescription,
          localDescriptionType: peer.pc.localDescription?.type,
          remoteDescriptionType: peer.pc.remoteDescription?.type,
          offerId: answer.offerId
        });
        throw new Error(
          `Invalid signaling state: ${peer.pc.signalingState}. Expected 'have-local-offer' to set remote answer.`
        );
      }

      // Set remote description (the answer)
      await peer.pc.setRemoteDescription({
        type: 'answer',
        sdp: answer.sdp
      });

      // Use the data channel we created when making the offer
      if (!answer.dataChannel) {
        throw new Error('No data channel found for answered offer');
      }

      const channel = answer.dataChannel;

      // Wait for the channel to open (it was created when we made the offer)
      if (channel.readyState !== 'open') {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error('Timeout waiting for data channel to open')),
            30000
          );

          channel.onopen = () => {
            clearTimeout(timeout);
            resolve();
          };

          channel.onerror = (error) => {
            clearTimeout(timeout);
            reject(new Error('Data channel error'));
          };
        });
      }

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
  private async createOffers(count: number): Promise<{ offers: Offer[], peerConnections: RTCPeerConnection[], dataChannels: RTCDataChannel[] }> {
    if (count <= 0) {
      return { offers: [], peerConnections: [], dataChannels: [] };
    }

    // Server supports max 10 offers per request
    const batchSize = Math.min(count, 10);
    const offers: Offer[] = [];
    const peerConnections: RTCPeerConnection[] = [];
    const dataChannels: RTCDataChannel[] = [];

    try {
      // Create peer connections and generate offers
      const offerRequests = [];
      const pendingCandidates: RTCIceCandidateInit[][] = []; // Store candidates before we have offer IDs

      for (let i = 0; i < batchSize; i++) {
        const pc = new RTCPeerConnection(this.options.rtcConfig || {
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });

        // Create data channel (required for offers) and save reference
        const channel = pc.createDataChannel('rondevu-service');
        dataChannels.push(channel);

        // Set up temporary candidate collector BEFORE setLocalDescription
        const candidatesForThisOffer: RTCIceCandidateInit[] = [];
        pendingCandidates.push(candidatesForThisOffer);

        pc.onicecandidate = (event) => {
          if (event.candidate) {
            const candidateData = event.candidate.toJSON();
            if (candidateData.candidate && candidateData.candidate !== '') {
              const type = candidateData.candidate.includes('typ host') ? 'host' :
                           candidateData.candidate.includes('typ srflx') ? 'srflx' :
                           candidateData.candidate.includes('typ relay') ? 'relay' : 'unknown';
              console.log(`🧊 Service pool generated ${type} ICE candidate:`, candidateData.candidate);
              candidatesForThisOffer.push(candidateData);
            }
          } else {
            console.log('🧊 Service pool ICE gathering complete');
          }
        };

        // Create offer
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer); // ICE gathering starts here, candidates go to collector

        if (!offer.sdp) {
          pc.close();
          throw new Error('Failed to generate SDP');
        }

        offerRequests.push({
          sdp: offer.sdp,
          topics: [], // V2 doesn't use topics
          ttl: this.options.ttl
        });

        // Keep peer connection alive - DO NOT CLOSE
        peerConnections.push(pc);
      }

      // Batch create offers
      const createdOffers = await this.offersApi.create(offerRequests);
      offers.push(...createdOffers);

      // Now send all pending candidates and set up handlers for future ones
      for (let i = 0; i < peerConnections.length; i++) {
        const pc = peerConnections[i];
        const offerId = createdOffers[i].id;
        const candidates = pendingCandidates[i];

        // Send any candidates that were collected while waiting for offer ID
        if (candidates.length > 0) {
          console.log(`📤 Sending ${candidates.length} pending ICE candidate(s) for offer ${offerId}`);
          try {
            await this.offersApi.addIceCandidates(offerId, candidates);
            console.log(`✅ Sent ${candidates.length} pending ICE candidate(s)`);
          } catch (err) {
            console.error('❌ Error sending pending ICE candidates:', err);
          }
        }

        // Replace temporary handler with permanent one for any future candidates
        pc.onicecandidate = async (event) => {
          if (event.candidate) {
            const candidateData = event.candidate.toJSON();
            if (candidateData.candidate && candidateData.candidate !== '') {
              const type = candidateData.candidate.includes('typ host') ? 'host' :
                           candidateData.candidate.includes('typ srflx') ? 'srflx' :
                           candidateData.candidate.includes('typ relay') ? 'relay' : 'unknown';
              console.log(`🧊 Service pool generated late ${type} ICE candidate:`, candidateData.candidate);
              try {
                await this.offersApi.addIceCandidates(offerId, [candidateData]);
                console.log(`✅ Sent late ${type} ICE candidate`);
              } catch (err) {
                console.error(`❌ Error sending ${type} ICE candidate:`, err);
              }
            }
          }
        };
      }

    } catch (error) {
      // Close any created peer connections on error
      peerConnections.forEach(pc => pc.close());
      this.status.failedOfferCreations++;
      this.handleError(error as Error, 'offer-creation');
      throw error;
    }

    return { offers, peerConnections, dataChannels };
  }

  /**
   * Publish the initial service (creates first offer)
   */
  private async publishInitialService(): Promise<{
    serviceId: string;
    uuid: string;
    offerId: string;
    offerSdp: string;
    expiresAt: number;
    peerConnection: RTCPeerConnection;
    dataChannel: RTCDataChannel;
  }> {
    const { username, privateKey, serviceFqn, rtcConfig, isPublic, metadata, ttl } = this.options;

    // Create peer connection for initial offer
    const pc = new RTCPeerConnection(rtcConfig || {
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    const dataChannel = pc.createDataChannel('rondevu-service');

    // Collect candidates before we have offer ID
    const pendingCandidates: RTCIceCandidateInit[] = [];

    // Set up temporary candidate collector BEFORE setLocalDescription
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const candidateData = event.candidate.toJSON();
        if (candidateData.candidate && candidateData.candidate !== '') {
          const type = candidateData.candidate.includes('typ host') ? 'host' :
                       candidateData.candidate.includes('typ srflx') ? 'srflx' :
                       candidateData.candidate.includes('typ relay') ? 'relay' : 'unknown';
          console.log(`🧊 Initial service generated ${type} ICE candidate:`, candidateData.candidate);
          pendingCandidates.push(candidateData);
        }
      } else {
        console.log('🧊 Initial service ICE gathering complete');
      }
    };

    // Create offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer); // ICE gathering starts here

    if (!offer.sdp) {
      pc.close();
      throw new Error('Failed to generate SDP');
    }

    // Store the SDP
    const offerSdp = offer.sdp;

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
        sdp: offerSdp,
        ttl,
        isPublic,
        metadata,
        signature,
        message
      })
    });

    if (!response.ok) {
      pc.close();
      const error = await response.json();
      throw new Error(error.error || 'Failed to publish service');
    }

    const data = await response.json();

    // Send any pending candidates
    if (pendingCandidates.length > 0) {
      console.log(`📤 Sending ${pendingCandidates.length} pending ICE candidate(s) for initial service`);
      try {
        await this.offersApi.addIceCandidates(data.offerId, pendingCandidates);
        console.log(`✅ Sent ${pendingCandidates.length} pending ICE candidate(s)`);
      } catch (err) {
        console.error('❌ Error sending pending ICE candidates:', err);
      }
    }

    // Set up handler for any future candidates
    pc.onicecandidate = async (event) => {
      if (event.candidate) {
        const candidateData = event.candidate.toJSON();
        if (candidateData.candidate && candidateData.candidate !== '') {
          const type = candidateData.candidate.includes('typ host') ? 'host' :
                       candidateData.candidate.includes('typ srflx') ? 'srflx' :
                       candidateData.candidate.includes('typ relay') ? 'relay' : 'unknown';
          console.log(`🧊 Initial service generated late ${type} ICE candidate:`, candidateData.candidate);
          try {
            await this.offersApi.addIceCandidates(data.offerId, [candidateData]);
            console.log(`✅ Sent late ${type} ICE candidate`);
          } catch (err) {
            console.error(`❌ Error sending ${type} ICE candidate:`, err);
          }
        }
      }
    };

    return {
      serviceId: data.serviceId,
      uuid: data.uuid,
      offerId: data.offerId,
      offerSdp,
      expiresAt: data.expiresAt,
      peerConnection: pc, // Keep peer connection alive
      dataChannel // Keep data channel alive
    };
  }

  /**
   * Manually add offers to the pool
   */
  private async manualRefill(count: number): Promise<void> {
    if (!this.offerPool) {
      throw new Error('Pool not started');
    }

    const result = await this.createOffers(count);
    await this.offerPool.addOffers(result.offers, result.peerConnections, result.dataChannels);
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
