import { RondevuAPI } from './client.js';
import { RondevuConnection } from './connection.js';
import { RondevuOptions, RondevuConnectionParams, WebRTCPolyfill } from './types.js';

/**
 * Main Rondevu WebRTC client with automatic connection management
 */
export class Rondevu {
  readonly peerId: string;
  readonly api: RondevuAPI;

  private baseUrl: string;
  private fetchImpl?: typeof fetch;
  private rtcConfig?: RTCConfiguration;
  private pollingInterval: number;
  private connectionTimeout: number;
  private wrtc?: WebRTCPolyfill;
  private RTCPeerConnection: typeof RTCPeerConnection;
  private RTCIceCandidate: typeof RTCIceCandidate;

  /**
   * Creates a new Rondevu client instance
   * @param options - Client configuration options
   */
  constructor(options: RondevuOptions = {}) {
    this.baseUrl = options.baseUrl || 'https://api.ronde.vu';
    this.fetchImpl = options.fetch;
    this.wrtc = options.wrtc;

    this.api = new RondevuAPI({
      baseUrl: this.baseUrl,
      fetch: options.fetch,
    });

    // Auto-generate peer ID if not provided
    this.peerId = options.peerId || this.generatePeerId();
    this.rtcConfig = options.rtcConfig;
    this.pollingInterval = options.pollingInterval || 1000;
    this.connectionTimeout = options.connectionTimeout || 30000;

    // Use injected WebRTC polyfill or fall back to global
    this.RTCPeerConnection = options.wrtc?.RTCPeerConnection || globalThis.RTCPeerConnection;
    this.RTCIceCandidate = options.wrtc?.RTCIceCandidate || globalThis.RTCIceCandidate;

    if (!this.RTCPeerConnection) {
      throw new Error(
        'RTCPeerConnection not available. ' +
        'In Node.js, provide a WebRTC polyfill via the wrtc option. ' +
        'Install: npm install @roamhq/wrtc or npm install wrtc'
      );
    }

    // Check server version compatibility (async, don't block constructor)
    this.checkServerVersion().catch(() => {
      // Silently fail version check - connection will work even if version check fails
    });
  }

  /**
   * Check server version compatibility
   */
  private async checkServerVersion(): Promise<void> {
    try {
      const { version: serverVersion } = await this.api.health();
      const clientVersion = '0.3.4'; // Should match package.json

      if (!this.isVersionCompatible(clientVersion, serverVersion)) {
        console.warn(
          `[Rondevu] Version mismatch: client v${clientVersion}, server v${serverVersion}. ` +
          'This may cause compatibility issues.'
        );
      }
    } catch (error) {
      // Version check failed - server might not support /health endpoint
      console.debug('[Rondevu] Could not check server version');
    }
  }

  /**
   * Check if client and server versions are compatible
   * For now, just check major version compatibility
   */
  private isVersionCompatible(clientVersion: string, serverVersion: string): boolean {
    const clientMajor = parseInt(clientVersion.split('.')[0]);
    const serverMajor = parseInt(serverVersion.split('.')[0]);

    // Major versions must match
    return clientMajor === serverMajor;
  }

  /**
   * Generate a unique peer ID
   */
  private generatePeerId(): string {
    return `rdv_${Math.random().toString(36).substring(2, 14)}`;
  }

  /**
   * Update the peer ID (useful when user identity changes)
   */
  updatePeerId(newPeerId: string): void {
    (this as any).peerId = newPeerId;
  }

  /**
   * Create an offer (offerer role)
   * @param id - Offer identifier (custom code)
   * @returns Promise that resolves to RondevuConnection
   */
  async offer(id: string): Promise<RondevuConnection> {
    // Create peer connection
    const pc = new this.RTCPeerConnection(this.rtcConfig);

    // Create initial data channel for negotiation (required for offer creation)
    pc.createDataChannel('_negotiation');

    // Generate offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // Wait for ICE gathering to complete
    await this.waitForIceGathering(pc);

    // Create offer on server with custom code
    await this.api.createOffer({
      peerId: this.peerId,
      offer: pc.localDescription!.sdp,
      code: id,
    });

    // Create connection object
    const connectionParams: RondevuConnectionParams = {
      id,
      role: 'offerer',
      pc,
      localPeerId: this.peerId,
      remotePeerId: '', // Will be populated when answer is received
      pollingInterval: this.pollingInterval,
      connectionTimeout: this.connectionTimeout,
      wrtc: this.wrtc,
    };

    const connection = new RondevuConnection(connectionParams, this.api);

    // Start polling for answer
    connection.startPolling();

    return connection;
  }

  /**
   * Answer an existing offer by ID (answerer role)
   * @param id - Offer code
   * @returns Promise that resolves to RondevuConnection
   */
  async answer(id: string): Promise<RondevuConnection> {
    // Poll server to get offer by ID
    const offerData = await this.findOfferById(id);

    if (!offerData) {
      throw new Error(`Offer ${id} not found or expired`);
    }

    // Create peer connection
    const pc = new this.RTCPeerConnection(this.rtcConfig);

    // Set remote offer
    await pc.setRemoteDescription({
      type: 'offer',
      sdp: offerData.offer,
    });

    // Generate answer
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    // Wait for ICE gathering
    await this.waitForIceGathering(pc);

    // Send answer to server
    await this.api.sendAnswer({
      code: id,
      answer: pc.localDescription!.sdp,
      side: 'answerer',
    });

    // Create connection object
    const connectionParams: RondevuConnectionParams = {
      id,
      role: 'answerer',
      pc,
      localPeerId: this.peerId,
      remotePeerId: '', // Will be determined from peerId in offer
      pollingInterval: this.pollingInterval,
      connectionTimeout: this.connectionTimeout,
      wrtc: this.wrtc,
    };

    const connection = new RondevuConnection(connectionParams, this.api);

    // Start polling for ICE candidates
    connection.startPolling();

    return connection;
  }

  /**
   * Wait for ICE gathering to complete
   */
  private async waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
    if (pc.iceGatheringState === 'complete') {
      return;
    }

    return new Promise((resolve) => {
      const checkState = () => {
        if (pc.iceGatheringState === 'complete') {
          pc.removeEventListener('icegatheringstatechange', checkState);
          resolve();
        }
      };

      pc.addEventListener('icegatheringstatechange', checkState);

      // Also set a timeout in case gathering takes too long
      setTimeout(() => {
        pc.removeEventListener('icegatheringstatechange', checkState);
        resolve();
      }, 5000);
    });
  }

  /**
   * Find an offer by code
   */
  private async findOfferById(id: string): Promise<{
    offer: string;
  } | null> {
    try {
      // Poll for the offer directly
      const response = await this.api.poll(id, 'answerer');
      const answererResponse = response as { offer: string; offerCandidates: string[] };

      if (answererResponse.offer) {
        return {
          offer: answererResponse.offer,
        };
      }

      return null;
    } catch (err) {
      throw new Error(`Failed to find offer ${id}: ${(err as Error).message}`);
    }
  }
}
