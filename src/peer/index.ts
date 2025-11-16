import { RondevuOffers } from '../offers.js';
import { EventEmitter } from '../event-emitter.js';

/**
 * Timeout configurations for different connection phases
 */
export interface PeerTimeouts {
  /** Timeout for ICE gathering (default: 10000ms) */
  iceGathering?: number;
  /** Timeout for waiting for answer (default: 30000ms) */
  waitingForAnswer?: number;
  /** Timeout for creating answer (default: 10000ms) */
  creatingAnswer?: number;
  /** Timeout for ICE connection (default: 30000ms) */
  iceConnection?: number;
}

/**
 * Options for creating a peer connection
 */
export interface PeerOptions {
  /** RTCConfiguration for the peer connection */
  rtcConfig?: RTCConfiguration;
  /** Topics to advertise this connection under */
  topics: string[];
  /** How long the offer should live (milliseconds) */
  ttl?: number;
  /** Whether to create a data channel automatically (for offerer) */
  createDataChannel?: boolean;
  /** Label for the automatically created data channel */
  dataChannelLabel?: string;
  /** Timeout configurations */
  timeouts?: PeerTimeouts;
}

/**
 * Events emitted by RondevuPeer
 */
export interface PeerEvents extends Record<string, (...args: any[]) => void> {
  'state': (state: string) => void;
  'connected': () => void;
  'disconnected': () => void;
  'failed': (error: Error) => void;
  'datachannel': (channel: RTCDataChannel) => void;
  'track': (event: RTCTrackEvent) => void;
}

/**
 * Base class for peer connection states
 */
abstract class PeerState {
  constructor(protected peer: RondevuPeer) {}

  abstract get name(): string;

  async createOffer(options: PeerOptions): Promise<string> {
    throw new Error(`Cannot create offer in ${this.name} state`);
  }

  async answer(offerId: string, offerSdp: string, options: PeerOptions): Promise<void> {
    throw new Error(`Cannot answer in ${this.name} state`);
  }

  async handleAnswer(sdp: string): Promise<void> {
    throw new Error(`Cannot handle answer in ${this.name} state`);
  }

  async handleIceCandidate(candidate: any): Promise<void> {
    // ICE candidates can arrive in multiple states, so default is to add them
    if (this.peer.pc.remoteDescription) {
      await this.peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
  }

  cleanup(): void {
    // Override in states that need cleanup
  }

  close(): void {
    this.cleanup();
    this.peer.setState(new ClosedState(this.peer));
  }
}

/**
 * Initial idle state
 */
class IdleState extends PeerState {
  get name() { return 'idle'; }

  async createOffer(options: PeerOptions): Promise<string> {
    this.peer.setState(new CreatingOfferState(this.peer, options));
    return this.peer.state.createOffer(options);
  }

  async answer(offerId: string, offerSdp: string, options: PeerOptions): Promise<void> {
    this.peer.setState(new AnsweringState(this.peer));
    return this.peer.state.answer(offerId, offerSdp, options);
  }
}

/**
 * Creating offer and sending to server
 */
class CreatingOfferState extends PeerState {
  constructor(peer: RondevuPeer, private options: PeerOptions) {
    super(peer);
  }

  get name() { return 'creating-offer'; }

  async createOffer(options: PeerOptions): Promise<string> {
    try {
      this.peer.role = 'offerer';

      // Create data channel if requested
      if (options.createDataChannel !== false) {
        const channel = this.peer.pc.createDataChannel(
          options.dataChannelLabel || 'data'
        );
        this.peer.emitEvent('datachannel', channel);
      }

      // Create WebRTC offer
      const offer = await this.peer.pc.createOffer();
      await this.peer.pc.setLocalDescription(offer);

      // Send offer to server immediately (don't wait for ICE)
      const offers = await this.peer.offersApi.create([{
        sdp: offer.sdp!,
        topics: options.topics,
        ttl: options.ttl || 300000
      }]);

      const offerId = offers[0].id;
      this.peer.offerId = offerId;

      // Enable trickle ICE - send candidates as they arrive
      this.peer.pc.onicecandidate = async (event) => {
        if (event.candidate && offerId) {
          const candidateData = event.candidate.toJSON();
          if (candidateData.candidate && candidateData.candidate !== '') {
            try {
              await this.peer.offersApi.addIceCandidates(offerId, [candidateData]);
            } catch (err) {
              console.error('Error sending ICE candidate:', err);
            }
          }
        }
      };

      // Transition to waiting for answer
      this.peer.setState(new WaitingForAnswerState(this.peer, offerId, options));

      return offerId;
    } catch (error) {
      this.peer.setState(new FailedState(this.peer, error as Error));
      throw error;
    }
  }
}

/**
 * Waiting for answer from another peer
 */
class WaitingForAnswerState extends PeerState {
  private pollingInterval?: ReturnType<typeof setInterval>;
  private timeout?: ReturnType<typeof setTimeout>;

  constructor(
    peer: RondevuPeer,
    private offerId: string,
    private options: PeerOptions
  ) {
    super(peer);
    this.startPolling();
  }

  get name() { return 'waiting-for-answer'; }

  private startPolling(): void {
    const answerTimeout = this.options.timeouts?.waitingForAnswer || 30000;

    this.timeout = setTimeout(() => {
      this.cleanup();
      this.peer.setState(new FailedState(
        this.peer,
        new Error('Timeout waiting for answer')
      ));
    }, answerTimeout);

    this.pollingInterval = setInterval(async () => {
      try {
        const answers = await this.peer.offersApi.getAnswers();
        const myAnswer = answers.find(a => a.offerId === this.offerId);

        if (myAnswer) {
          this.cleanup();
          await this.handleAnswer(myAnswer.sdp);
        }
      } catch (err) {
        console.error('Error polling for answers:', err);
        if (err instanceof Error && err.message.includes('not found')) {
          this.cleanup();
          this.peer.setState(new FailedState(
            this.peer,
            new Error('Offer expired or not found')
          ));
        }
      }
    }, 2000);
  }

  async handleAnswer(sdp: string): Promise<void> {
    try {
      await this.peer.pc.setRemoteDescription({
        type: 'answer',
        sdp
      });

      // Transition to exchanging ICE
      this.peer.setState(new ExchangingIceState(this.peer, this.offerId, this.options));
    } catch (error) {
      this.peer.setState(new FailedState(this.peer, error as Error));
    }
  }

  cleanup(): void {
    if (this.pollingInterval) clearInterval(this.pollingInterval);
    if (this.timeout) clearTimeout(this.timeout);
  }
}

/**
 * Answering an offer and sending to server
 */
class AnsweringState extends PeerState {
  constructor(peer: RondevuPeer) {
    super(peer);
  }

  get name() { return 'answering'; }

  async answer(offerId: string, offerSdp: string, options: PeerOptions): Promise<void> {
    try {
      this.peer.role = 'answerer';
      this.peer.offerId = offerId;

      // Set remote description
      await this.peer.pc.setRemoteDescription({
        type: 'offer',
        sdp: offerSdp
      });

      // Create answer
      const answer = await this.peer.pc.createAnswer();
      await this.peer.pc.setLocalDescription(answer);

      // Send answer to server immediately (don't wait for ICE)
      await this.peer.offersApi.answer(offerId, answer.sdp!);

      // Enable trickle ICE - send candidates as they arrive
      this.peer.pc.onicecandidate = async (event) => {
        if (event.candidate && offerId) {
          const candidateData = event.candidate.toJSON();
          if (candidateData.candidate && candidateData.candidate !== '') {
            try {
              await this.peer.offersApi.addIceCandidates(offerId, [candidateData]);
            } catch (err) {
              console.error('Error sending ICE candidate:', err);
            }
          }
        }
      };

      // Transition to exchanging ICE
      this.peer.setState(new ExchangingIceState(this.peer, offerId, options));
    } catch (error) {
      this.peer.setState(new FailedState(this.peer, error as Error));
      throw error;
    }
  }
}

/**
 * Exchanging ICE candidates and waiting for connection
 */
class ExchangingIceState extends PeerState {
  private pollingInterval?: ReturnType<typeof setInterval>;
  private timeout?: ReturnType<typeof setTimeout>;
  private lastIceTimestamp = 0;

  constructor(
    peer: RondevuPeer,
    private offerId: string,
    private options: PeerOptions
  ) {
    super(peer);
    this.startPolling();
  }

  get name() { return 'exchanging-ice'; }

  private startPolling(): void {
    const connectionTimeout = this.options.timeouts?.iceConnection || 30000;

    this.timeout = setTimeout(() => {
      this.cleanup();
      this.peer.setState(new FailedState(
        this.peer,
        new Error('ICE connection timeout')
      ));
    }, connectionTimeout);

    this.pollingInterval = setInterval(async () => {
      try {
        const candidates = await this.peer.offersApi.getIceCandidates(
          this.offerId,
          this.lastIceTimestamp
        );

        for (const cand of candidates) {
          if (cand.candidate && cand.candidate.candidate && cand.candidate.candidate !== '') {
            try {
              await this.peer.pc.addIceCandidate(new RTCIceCandidate(cand.candidate));
              this.lastIceTimestamp = cand.createdAt;
            } catch (err) {
              console.warn('Failed to add ICE candidate:', err);
              this.lastIceTimestamp = cand.createdAt;
            }
          } else {
            this.lastIceTimestamp = cand.createdAt;
          }
        }
      } catch (err) {
        console.error('Error polling for ICE candidates:', err);
        if (err instanceof Error && err.message.includes('not found')) {
          this.cleanup();
          this.peer.setState(new FailedState(
            this.peer,
            new Error('Offer expired or not found')
          ));
        }
      }
    }, 1000);
  }

  cleanup(): void {
    if (this.pollingInterval) clearInterval(this.pollingInterval);
    if (this.timeout) clearTimeout(this.timeout);
  }
}

/**
 * Successfully connected state
 */
class ConnectedState extends PeerState {
  get name() { return 'connected'; }

  cleanup(): void {
    // Keep connection alive, but stop any polling
    // The peer connection will handle disconnects via onconnectionstatechange
  }
}

/**
 * Failed state
 */
class FailedState extends PeerState {
  constructor(peer: RondevuPeer, private error: Error) {
    super(peer);
    peer.emitEvent('failed', error);
  }

  get name() { return 'failed'; }

  cleanup(): void {
    // Connection is failed, clean up resources
    this.peer.pc.close();
  }
}

/**
 * Closed state
 */
class ClosedState extends PeerState {
  get name() { return 'closed'; }

  cleanup(): void {
    this.peer.pc.close();
  }
}

/**
 * High-level WebRTC peer connection manager with state-based lifecycle
 * Handles offer/answer exchange, ICE candidates, timeouts, and error recovery
 */
export default class RondevuPeer extends EventEmitter<PeerEvents> {
  pc: RTCPeerConnection;
  offersApi: RondevuOffers;
  offerId?: string;
  role?: 'offerer' | 'answerer';

  private _state: PeerState;

  /**
   * Current connection state name
   */
  get stateName(): string {
    return this._state.name;
  }

  /**
   * Current state object (internal use)
   */
  get state(): PeerState {
    return this._state;
  }

  /**
   * RTCPeerConnection state
   */
  get connectionState(): RTCPeerConnectionState {
    return this.pc.connectionState;
  }

  constructor(
    offersApi: RondevuOffers,
    rtcConfig: RTCConfiguration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    }
  ) {
    super();
    this.offersApi = offersApi;
    this.pc = new RTCPeerConnection(rtcConfig);
    this._state = new IdleState(this);

    this.setupPeerConnection();
  }

  /**
   * Set up peer connection event handlers
   */
  private setupPeerConnection(): void {
    this.pc.onconnectionstatechange = () => {
      switch (this.pc.connectionState) {
        case 'connected':
          this.setState(new ConnectedState(this));
          this.emitEvent('connected');
          break;
        case 'disconnected':
          this.emitEvent('disconnected');
          break;
        case 'failed':
          this.setState(new FailedState(this, new Error('Connection failed')));
          break;
        case 'closed':
          this.setState(new ClosedState(this));
          this.emitEvent('disconnected');
          break;
      }
    };

    this.pc.ondatachannel = (event) => {
      this.emitEvent('datachannel', event.channel);
    };

    this.pc.ontrack = (event) => {
      this.emitEvent('track', event);
    };

    this.pc.onicecandidateerror = (event) => {
      console.error('ICE candidate error:', event);
    };
  }

  /**
   * Set new state and emit state change event
   */
  setState(newState: PeerState): void {
    this._state.cleanup();
    this._state = newState;
    this.emitEvent('state', newState.name);
  }

  /**
   * Emit event (exposed for PeerState classes)
   * @internal
   */
  emitEvent<K extends keyof PeerEvents>(
    event: K,
    ...args: Parameters<PeerEvents[K]>
  ): void {
    this.emit(event, ...args);
  }

  /**
   * Create an offer and advertise on topics
   */
  async createOffer(options: PeerOptions): Promise<string> {
    return this._state.createOffer(options);
  }

  /**
   * Answer an existing offer
   */
  async answer(offerId: string, offerSdp: string, options: PeerOptions): Promise<void> {
    return this._state.answer(offerId, offerSdp, options);
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
    this._state.close();
    this.removeAllListeners();
  }
}
