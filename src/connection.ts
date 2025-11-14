import { RondevuOffers } from './offers.js';

/**
 * Events emitted by RondevuConnection
 */
export interface RondevuConnectionEvents {
  'connecting': () => void;
  'connected': () => void;
  'disconnected': () => void;
  'error': (error: Error) => void;
  'datachannel': (channel: RTCDataChannel) => void;
  'track': (event: RTCTrackEvent) => void;
}

/**
 * Options for creating a WebRTC connection
 */
export interface ConnectionOptions {
  /**
   * RTCConfiguration for the peer connection
   * @default { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
   */
  rtcConfig?: RTCConfiguration;

  /**
   * Topics to advertise this connection under
   */
  topics: string[];

  /**
   * How long the offer should live (milliseconds)
   * @default 300000 (5 minutes)
   */
  ttl?: number;

  /**
   * Whether to create a data channel automatically (for offerer)
   * @default true
   */
  createDataChannel?: boolean;

  /**
   * Label for the automatically created data channel
   * @default 'data'
   */
  dataChannelLabel?: string;
}

/**
 * High-level WebRTC connection manager for Rondevu
 * Handles offer/answer exchange, ICE candidates, and connection lifecycle
 */
export class RondevuConnection {
  private pc: RTCPeerConnection;
  private offersApi: RondevuOffers;
  private offerId?: string;
  private role?: 'offerer' | 'answerer';
  private icePollingInterval?: ReturnType<typeof setInterval>;
  private answerPollingInterval?: ReturnType<typeof setInterval>;
  private lastIceTimestamp: number = Date.now();
  private eventListeners: Map<keyof RondevuConnectionEvents, Set<Function>> = new Map();
  private dataChannel?: RTCDataChannel;
  private pendingIceCandidates: Array<{
    candidate: string;
    sdpMid: string | null;
    sdpMLineIndex: number | null;
  }> = [];

  /**
   * Current connection state
   */
  get connectionState(): RTCPeerConnectionState {
    return this.pc.connectionState;
  }

  /**
   * The offer ID for this connection
   */
  get id(): string | undefined {
    return this.offerId;
  }

  /**
   * Get the primary data channel (if created)
   */
  get channel(): RTCDataChannel | undefined {
    return this.dataChannel;
  }

  constructor(
    offersApi: RondevuOffers,
    private rtcConfig: RTCConfiguration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    }
  ) {
    this.offersApi = offersApi;
    this.pc = new RTCPeerConnection(rtcConfig);
    this.setupPeerConnection();
  }

  /**
   * Set up peer connection event handlers
   */
  private setupPeerConnection(): void {
    this.pc.onicecandidate = async (event) => {
      if (event.candidate) {
        const candidateData = {
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid,
          sdpMLineIndex: event.candidate.sdpMLineIndex,
        };

        if (this.offerId) {
          // offerId is set, send immediately (trickle ICE)
          try {
            await this.offersApi.addIceCandidates(this.offerId, [candidateData]);
          } catch (err) {
            console.error('Error sending ICE candidate:', err);
          }
        } else {
          // offerId not set yet, buffer the candidate
          this.pendingIceCandidates.push(candidateData);
        }
      }
    };

    this.pc.onconnectionstatechange = () => {
      switch (this.pc.connectionState) {
        case 'connecting':
          this.emit('connecting');
          break;
        case 'connected':
          this.emit('connected');
          break;
        case 'disconnected':
        case 'failed':
        case 'closed':
          this.emit('disconnected');
          this.stopPolling();
          break;
      }
    };

    this.pc.ondatachannel = (event) => {
      this.dataChannel = event.channel;
      this.emit('datachannel', event.channel);
    };

    this.pc.ontrack = (event) => {
      this.emit('track', event);
    };

    this.pc.onicecandidateerror = (event) => {
      console.error('ICE candidate error:', event);
    };
  }

  /**
   * Flush buffered ICE candidates (trickle ICE support)
   */
  private async flushPendingIceCandidates(): Promise<void> {
    if (this.pendingIceCandidates.length > 0 && this.offerId) {
      try {
        await this.offersApi.addIceCandidates(this.offerId, this.pendingIceCandidates);
        this.pendingIceCandidates = [];
      } catch (err) {
        console.error('Error flushing pending ICE candidates:', err);
      }
    }
  }

  /**
   * Create an offer and advertise on topics
   */
  async createOffer(options: ConnectionOptions): Promise<string> {
    this.role = 'offerer';

    // Create data channel if requested
    if (options.createDataChannel !== false) {
      this.dataChannel = this.pc.createDataChannel(
        options.dataChannelLabel || 'data'
      );
      this.emit('datachannel', this.dataChannel);
    }

    // Create WebRTC offer
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    // Create offer on Rondevu server
    const offers = await this.offersApi.create([{
      sdp: offer.sdp!,
      topics: options.topics,
      ttl: options.ttl || 300000
    }]);

    this.offerId = offers[0].id;

    // Flush any ICE candidates that were generated during offer creation
    await this.flushPendingIceCandidates();

    // Start polling for answers
    this.startAnswerPolling();

    return this.offerId;
  }

  /**
   * Answer an existing offer
   */
  async answer(offerId: string, offerSdp: string): Promise<void> {
    this.role = 'answerer';

    // Set remote description
    await this.pc.setRemoteDescription({
      type: 'offer',
      sdp: offerSdp
    });

    // Create answer
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);

    // Send answer to server FIRST
    // This registers us as the answerer before ICE candidates arrive
    await this.offersApi.answer(offerId, answer.sdp!);

    // Now set offerId to enable ICE candidate sending
    // This prevents a race condition where ICE candidates arrive before answer is registered
    this.offerId = offerId;

    // Flush any ICE candidates that were generated during answer creation
    await this.flushPendingIceCandidates();

    // Start polling for ICE candidates
    this.startIcePolling();
  }

  /**
   * Start polling for answers (offerer only)
   */
  private startAnswerPolling(): void {
    if (this.role !== 'offerer' || !this.offerId) return;

    this.answerPollingInterval = setInterval(async () => {
      try {
        const answers = await this.offersApi.getAnswers();
        const myAnswer = answers.find(a => a.offerId === this.offerId);

        if (myAnswer) {
          // Set remote description
          await this.pc.setRemoteDescription({
            type: 'answer',
            sdp: myAnswer.sdp
          });

          // Stop answer polling, start ICE polling
          this.stopAnswerPolling();
          this.startIcePolling();
        }
      } catch (err) {
        console.error('Error polling for answers:', err);
      }
    }, 2000);
  }

  /**
   * Start polling for ICE candidates
   */
  private startIcePolling(): void {
    if (!this.offerId) return;

    this.icePollingInterval = setInterval(async () => {
      if (!this.offerId) return;

      try {
        const candidates = await this.offersApi.getIceCandidates(
          this.offerId,
          this.lastIceTimestamp
        );

        for (const candidate of candidates) {
          // Create ICE candidate with all fields
          await this.pc.addIceCandidate(new RTCIceCandidate({
            candidate: candidate.candidate,
            sdpMid: candidate.sdpMid ?? undefined,
            sdpMLineIndex: candidate.sdpMLineIndex ?? undefined,
          }));
          this.lastIceTimestamp = candidate.createdAt;
        }
      } catch (err) {
        console.error('Error polling for ICE candidates:', err);
      }
    }, 1000);
  }

  /**
   * Stop answer polling
   */
  private stopAnswerPolling(): void {
    if (this.answerPollingInterval) {
      clearInterval(this.answerPollingInterval);
      this.answerPollingInterval = undefined;
    }
  }

  /**
   * Stop ICE polling
   */
  private stopIcePolling(): void {
    if (this.icePollingInterval) {
      clearInterval(this.icePollingInterval);
      this.icePollingInterval = undefined;
    }
  }

  /**
   * Stop all polling
   */
  private stopPolling(): void {
    this.stopAnswerPolling();
    this.stopIcePolling();
  }

  /**
   * Add event listener
   */
  on<K extends keyof RondevuConnectionEvents>(
    event: K,
    listener: RondevuConnectionEvents[K]
  ): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(listener);
  }

  /**
   * Remove event listener
   */
  off<K extends keyof RondevuConnectionEvents>(
    event: K,
    listener: RondevuConnectionEvents[K]
  ): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.delete(listener);
    }
  }

  /**
   * Emit event
   */
  private emit<K extends keyof RondevuConnectionEvents>(
    event: K,
    ...args: Parameters<RondevuConnectionEvents[K]>
  ): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach(listener => {
        (listener as any)(...args);
      });
    }
  }

  /**
   * Add a media track to the connection
   */
  addTrack(track: MediaStreamTrack, ...streams: MediaStream[]): RTCRtpSender {
    return this.pc.addTrack(track, ...streams);
  }

  /**
   * Close the connection and clean up
   */
  close(): void {
    this.stopPolling();
    this.pc.close();
    this.eventListeners.clear();
  }
}
