import { RondevuUsername } from './usernames.js';
import RondevuPeer from './peer/index.js';
import { RondevuOffers } from './offers.js';
import { ServicePool, ServicePoolOptions, PooledServiceHandle, PoolStatus } from './service-pool.js';

/**
 * Service publish result
 */
export interface ServicePublishResult {
  serviceId: string;
  uuid: string;
  offerId: string;
  expiresAt: number;
}

/**
 * Service publish options
 */
export interface PublishServiceOptions {
  username: string;
  privateKey: string;
  serviceFqn: string;
  rtcConfig?: RTCConfiguration;
  isPublic?: boolean;
  metadata?: Record<string, any>;
  ttl?: number;
  onConnection?: (peer: RondevuPeer) => void;
}

/**
 * Service handle for managing an exposed service
 */
export interface ServiceHandle {
  serviceId: string;
  uuid: string;
  offerId: string;
  unpublish: () => Promise<void>;
}

/**
 * Rondevu Services API
 * Handles service publishing and management
 */
export class RondevuServices {
  private usernameApi: RondevuUsername;
  private offersApi: RondevuOffers;

  constructor(
    private baseUrl: string,
    private credentials: { peerId: string; secret: string }
  ) {
    this.usernameApi = new RondevuUsername(baseUrl);
    this.offersApi = new RondevuOffers(baseUrl, credentials);
  }

  /**
   * Publishes a service
   */
  async publishService(options: PublishServiceOptions): Promise<ServicePublishResult> {
    const {
      username,
      privateKey,
      serviceFqn,
      rtcConfig,
      isPublic = false,
      metadata,
      ttl
    } = options;

    // Validate FQN format
    this.validateServiceFqn(serviceFqn);

    // Create WebRTC peer connection to generate offer
    const pc = new RTCPeerConnection(rtcConfig || {
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    // Add a data channel (required for datachannel-based services)
    pc.createDataChannel('rondevu-service');

    // Create offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    if (!offer.sdp) {
      throw new Error('Failed to generate SDP');
    }

    // Create signature for username verification
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

    if (!response.ok) {
      const error = await response.json();
      pc.close();
      throw new Error(error.error || 'Failed to publish service');
    }

    const data = await response.json();

    // Close the connection for now (would be kept open in a real implementation)
    pc.close();

    return {
      serviceId: data.serviceId,
      uuid: data.uuid,
      offerId: data.offerId,
      expiresAt: data.expiresAt
    };
  }

  /**
   * Unpublishes a service
   */
  async unpublishService(serviceId: string, username: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/services/${serviceId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.credentials.peerId}:${this.credentials.secret}`
      },
      body: JSON.stringify({ username })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to unpublish service');
    }
  }

  /**
   * Exposes a service with an automatic connection handler
   * This is a convenience method that publishes the service and manages connections
   *
   * Set poolSize > 1 to enable offer pooling for handling multiple concurrent connections
   */
  async exposeService(options: Omit<PublishServiceOptions, 'onConnection'> & {
    handler: (channel: RTCDataChannel, peer: RondevuPeer, connectionId?: string) => void;
    poolSize?: number;
    pollingInterval?: number;
    onPoolStatus?: (status: PoolStatus) => void;
    onError?: (error: Error, context: string) => void;
  }): Promise<ServiceHandle | PooledServiceHandle> {
    const {
      username,
      privateKey,
      serviceFqn,
      rtcConfig,
      isPublic,
      metadata,
      ttl,
      handler,
      poolSize,
      pollingInterval,
      onPoolStatus,
      onError
    } = options;

    // If poolSize > 1, use pooled implementation
    if (poolSize && poolSize > 1) {
      const pool = new ServicePool(this.baseUrl, this.credentials, {
        username,
        privateKey,
        serviceFqn,
        rtcConfig,
        isPublic,
        metadata,
        ttl,
        handler: (channel, peer, connectionId) => handler(channel, peer, connectionId),
        poolSize,
        pollingInterval,
        onPoolStatus,
        onError
      });
      return await pool.start();
    }

    // Otherwise, use existing single-offer logic (UNCHANGED)
    // Validate FQN
    this.validateServiceFqn(serviceFqn);

    // Create peer connection
    const pc = new RTCPeerConnection(rtcConfig || {
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    // Create data channel
    const channel = pc.createDataChannel('rondevu-service');

    // Set up handler
    channel.onopen = () => {
      const peer = new RondevuPeer(
        this.offersApi,
        rtcConfig || {
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        }
      );
      handler(channel, peer);
    };

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

    if (!response.ok) {
      const error = await response.json();
      pc.close();
      throw new Error(error.error || 'Failed to expose service');
    }

    const data = await response.json();

    return {
      serviceId: data.serviceId,
      uuid: data.uuid,
      offerId: data.offerId,
      unpublish: () => this.unpublishService(data.serviceId, username)
    };
  }

  /**
   * Validates service FQN format
   */
  private validateServiceFqn(fqn: string): void {
    const parts = fqn.split('@');
    if (parts.length !== 2) {
      throw new Error('Service FQN must be in format: service-name@version');
    }

    const [serviceName, version] = parts;

    // Validate service name (reverse domain notation)
    const serviceNameRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
    if (!serviceNameRegex.test(serviceName)) {
      throw new Error('Service name must be reverse domain notation (e.g., com.example.service)');
    }

    if (serviceName.length < 3 || serviceName.length > 128) {
      throw new Error('Service name must be 3-128 characters');
    }

    // Validate version (semantic versioning)
    const versionRegex = /^[0-9]+\.[0-9]+\.[0-9]+(-[a-z0-9.-]+)?$/;
    if (!versionRegex.test(version)) {
      throw new Error('Version must be semantic versioning (e.g., 1.0.0, 2.1.3-beta)');
    }
  }

  /**
   * Parses a service FQN into name and version
   */
  parseServiceFqn(fqn: string): { name: string; version: string } {
    const parts = fqn.split('@');
    if (parts.length !== 2) {
      throw new Error('Invalid FQN format');
    }
    return { name: parts[0], version: parts[1] };
  }
}
