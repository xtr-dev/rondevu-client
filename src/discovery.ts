import RondevuPeer from './peer/index.js';
import { RondevuOffers } from './offers.js';

/**
 * Service info from discovery
 */
export interface ServiceInfo {
  uuid: string;
  isPublic: boolean;
  serviceFqn?: string;
  metadata?: Record<string, any>;
}

/**
 * Service list result
 */
export interface ServiceListResult {
  username: string;
  services: ServiceInfo[];
}

/**
 * Service query result
 */
export interface ServiceQueryResult {
  uuid: string;
  allowed: boolean;
}

/**
 * Service details
 */
export interface ServiceDetails {
  serviceId: string;
  username: string;
  serviceFqn: string;
  offerId: string;
  sdp: string;
  isPublic: boolean;
  metadata?: Record<string, any>;
  createdAt: number;
  expiresAt: number;
}

/**
 * Connect result
 */
export interface ConnectResult {
  peer: RondevuPeer;
  channel: RTCDataChannel;
}

/**
 * Rondevu Discovery API
 * Handles service discovery and connections
 */
export class RondevuDiscovery {
  private offersApi: RondevuOffers;

  constructor(
    private baseUrl: string,
    private credentials: { peerId: string; secret: string }
  ) {
    this.offersApi = new RondevuOffers(baseUrl, credentials);
  }

  /**
   * Lists all services for a username
   * Returns UUIDs only for private services, full details for public
   */
  async listServices(username: string): Promise<ServiceListResult> {
    const response = await fetch(`${this.baseUrl}/usernames/${username}/services`);

    if (!response.ok) {
      throw new Error('Failed to list services');
    }

    const data = await response.json();

    return {
      username: data.username,
      services: data.services
    };
  }

  /**
   * Queries a service by FQN
   * Returns UUID if service exists and is allowed
   */
  async queryService(username: string, serviceFqn: string): Promise<ServiceQueryResult> {
    const response = await fetch(`${this.baseUrl}/index/${username}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serviceFqn })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Service not found');
    }

    const data = await response.json();

    return {
      uuid: data.uuid,
      allowed: data.allowed
    };
  }

  /**
   * Gets service details by UUID
   */
  async getServiceDetails(uuid: string): Promise<ServiceDetails> {
    const response = await fetch(`${this.baseUrl}/services/${uuid}`);

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Service not found');
    }

    const data = await response.json();

    return {
      serviceId: data.serviceId,
      username: data.username,
      serviceFqn: data.serviceFqn,
      offerId: data.offerId,
      sdp: data.sdp,
      isPublic: data.isPublic,
      metadata: data.metadata,
      createdAt: data.createdAt,
      expiresAt: data.expiresAt
    };
  }

  /**
   * Connects to a service by UUID
   */
  async connectToService(
    uuid: string,
    options?: {
      rtcConfig?: RTCConfiguration;
      onConnected?: () => void;
      onData?: (data: any) => void;
    }
  ): Promise<RondevuPeer> {
    // Get service details
    const service = await this.getServiceDetails(uuid);

    // Create peer with the offer
    const peer = new RondevuPeer(
      this.offersApi,
      options?.rtcConfig || {
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      }
    );

    // Set up event handlers
    if (options?.onConnected) {
      peer.on('connected', options.onConnected);
    }

    if (options?.onData) {
      peer.on('datachannel', (channel: RTCDataChannel) => {
        channel.onmessage = (e) => options.onData!(e.data);
      });
    }

    // Answer the offer
    await peer.answer(service.offerId, service.sdp, {
      topics: [],  // V2 doesn't use topics
      rtcConfig: options?.rtcConfig
    });

    return peer;
  }

  /**
   * Convenience method: Query and connect in one call
   * Returns both peer and data channel
   */
  async connect(
    username: string,
    serviceFqn: string,
    options?: {
      rtcConfig?: RTCConfiguration;
    }
  ): Promise<ConnectResult> {
    // Query service
    const query = await this.queryService(username, serviceFqn);

    if (!query.allowed) {
      throw new Error('Service access denied');
    }

    // Get service details
    const service = await this.getServiceDetails(query.uuid);

    // Create peer
    const peer = new RondevuPeer(
      this.offersApi,
      options?.rtcConfig || {
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      }
    );

    // Answer the offer
    await peer.answer(service.offerId, service.sdp, {
      topics: [],  // V2 doesn't use topics
      rtcConfig: options?.rtcConfig
    });

    // Wait for data channel
    const channel = await new Promise<RTCDataChannel>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for data channel'));
      }, 30000);

      peer.on('datachannel', (ch: RTCDataChannel) => {
        clearTimeout(timeout);
        resolve(ch);
      });

      peer.on('failed', (error: Error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    return { peer, channel };
  }

  /**
   * Convenience method: Connect to service by UUID with channel
   */
  async connectByUuid(
    uuid: string,
    options?: { rtcConfig?: RTCConfiguration }
  ): Promise<ConnectResult> {
    // Get service details
    const service = await this.getServiceDetails(uuid);

    // Create peer
    const peer = new RondevuPeer(
      this.offersApi,
      options?.rtcConfig || {
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      }
    );

    // Answer the offer
    await peer.answer(service.offerId, service.sdp, {
      topics: [],  // V2 doesn't use topics
      rtcConfig: options?.rtcConfig
    });

    // Wait for data channel
    const channel = await new Promise<RTCDataChannel>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for data channel'));
      }, 30000);

      peer.on('datachannel', (ch: RTCDataChannel) => {
        clearTimeout(timeout);
        resolve(ch);
      });

      peer.on('failed', (error: Error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    return { peer, channel };
  }
}
