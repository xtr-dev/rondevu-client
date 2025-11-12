import { RondevuAPI } from './client.js';
import { RondevuConnection } from './connection.js';
import { RondevuOptions, JoinOptions, RondevuConnectionParams, WebRTCPolyfill } from './types.js';

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
    this.baseUrl = options.baseUrl || 'https://rondevu.xtrdev.workers.dev';
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
   * Create a new connection (offerer role)
   * @param id - Connection identifier
   * @param topic - Topic name for grouping connections
   * @returns Promise that resolves to RondevuConnection
   */
  async create(id: string, topic: string): Promise<RondevuConnection> {
    // Create peer connection
    const pc = new this.RTCPeerConnection(this.rtcConfig);

    // Create initial data channel for negotiation (required for offer creation)
    pc.createDataChannel('_negotiation');

    // Generate offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // Wait for ICE gathering to complete
    await this.waitForIceGathering(pc);

    // Create session on server with custom code
    await this.api.createOffer(topic, {
      peerId: this.peerId,
      offer: pc.localDescription!.sdp,
      code: id,
    });

    // Create connection object
    const connectionParams: RondevuConnectionParams = {
      id,
      topic,
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
   * Connect to an existing connection by ID (answerer role)
   * @param id - Connection identifier
   * @returns Promise that resolves to RondevuConnection
   */
  async connect(id: string): Promise<RondevuConnection> {
    // Poll server to get session by ID
    const sessionData = await this.findSessionByIdWithClient(id, this.api);

    if (!sessionData) {
      throw new Error(`Connection ${id} not found or expired`);
    }

    // Create peer connection
    const pc = new this.RTCPeerConnection(this.rtcConfig);

    // Set remote offer
    await pc.setRemoteDescription({
      type: 'offer',
      sdp: sessionData.offer,
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
      topic: sessionData.topic || 'unknown',
      role: 'answerer',
      pc,
      localPeerId: this.peerId,
      remotePeerId: sessionData.peerId,
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
   * Join a topic and discover available peers (answerer role)
   * @param topic - Topic name
   * @param options - Optional join options for filtering and selection
   * @returns Promise that resolves to RondevuConnection
   */
  async join(topic: string, options?: JoinOptions): Promise<RondevuConnection> {
    // List sessions in topic
    const { sessions } = await this.api.listSessions(topic);

    // Filter out self (sessions with our peer ID)
    let availableSessions = sessions.filter(
      session => session.peerId !== this.peerId
    );

    // Apply custom filter if provided
    if (options?.filter) {
      availableSessions = availableSessions.filter(options.filter);
    }

    if (availableSessions.length === 0) {
      throw new Error(`No available peers in topic: ${topic}`);
    }

    // Select session based on strategy
    const selectedSession = this.selectSession(
      availableSessions,
      options?.select || 'first'
    );

    // Connect to selected session
    return this.connect(selectedSession.code);
  }

  /**
   * Select a session based on strategy
   */
  private selectSession(
    sessions: Array<{ code: string; peerId: string; createdAt: number }>,
    strategy: 'first' | 'newest' | 'oldest' | 'random'
  ): { code: string; peerId: string; createdAt: number } {
    switch (strategy) {
      case 'first':
        return sessions[0];
      case 'newest':
        return sessions.reduce((newest, session) =>
          session.createdAt > newest.createdAt ? session : newest
        );
      case 'oldest':
        return sessions.reduce((oldest, session) =>
          session.createdAt < oldest.createdAt ? session : oldest
        );
      case 'random':
        return sessions[Math.floor(Math.random() * sessions.length)];
      default:
        return sessions[0];
    }
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
   * Find a session by connection ID
   * This requires polling since we don't know which topic it's in
   */
  private async findSessionByIdWithClient(
    id: string,
    client: RondevuAPI
  ): Promise<{
    code: string;
    peerId: string;
    offer: string;
    topic?: string;
  } | null> {
    try {
      // Try to poll for the session directly
      // The poll endpoint should return the session data
      const response = await client.poll(id, 'answerer');
      const answererResponse = response as { offer: string; offerCandidates: string[] };

      if (answererResponse.offer) {
        return {
          code: id,
          peerId: '', // Will be populated from session data
          offer: answererResponse.offer,
          topic: undefined,
        };
      }

      return null;
    } catch (err) {
      throw new Error(`Failed to find session ${id}: ${(err as Error).message}`);
    }
  }
}
