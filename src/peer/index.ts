import { RondevuOffers } from '../offers.js';
import { EventEmitter } from '../event-emitter.js';
import type { PeerOptions, PeerEvents } from './types.js';
import { PeerState } from './state.js';
import { IdleState } from './idle-state.js';
import { CreatingOfferState } from './creating-offer-state.js';
import { WaitingForAnswerState } from './waiting-for-answer-state.js';
import { AnsweringState } from './answering-state.js';
import { ExchangingIceState } from './exchanging-ice-state.js';
import { ConnectedState } from './connected-state.js';
import { FailedState } from './failed-state.js';
import { ClosedState } from './closed-state.js';

// Re-export types for external consumers
export type { PeerTimeouts, PeerOptions, PeerEvents } from './types.js';

/**
 * High-level WebRTC peer connection manager with state-based lifecycle
 * Handles offer/answer exchange, ICE candidates, timeouts, and error recovery
 */
export default class RondevuPeer extends EventEmitter<PeerEvents> {
  pc: RTCPeerConnection;
  offersApi: RondevuOffers;
  offerId?: string;
  role?: 'offerer' | 'answerer';

  // WebRTC polyfills for Node.js compatibility
  RTCPeerConnection: typeof RTCPeerConnection;
  RTCSessionDescription: typeof RTCSessionDescription;
  RTCIceCandidate: typeof RTCIceCandidate;

  private _state: PeerState;

  // Event handler references for cleanup
  private connectionStateChangeHandler?: () => void;
  private dataChannelHandler?: (event: RTCDataChannelEvent) => void;
  private trackHandler?: (event: RTCTrackEvent) => void;
  private iceCandidateErrorHandler?: (event: Event) => void;

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
    },
    rtcPeerConnection?: typeof RTCPeerConnection,
    rtcSessionDescription?: typeof RTCSessionDescription,
    rtcIceCandidate?: typeof RTCIceCandidate
  ) {
    super();
    this.offersApi = offersApi;

    // Use provided polyfills or fall back to globals
    this.RTCPeerConnection = rtcPeerConnection || (typeof globalThis.RTCPeerConnection !== 'undefined'
      ? globalThis.RTCPeerConnection
      : (() => {
          throw new Error('RTCPeerConnection is not available. Please provide it in the Rondevu constructor options for Node.js environments.');
        }) as any);

    this.RTCSessionDescription = rtcSessionDescription || (typeof globalThis.RTCSessionDescription !== 'undefined'
      ? globalThis.RTCSessionDescription
      : (() => {
          throw new Error('RTCSessionDescription is not available. Please provide it in the Rondevu constructor options for Node.js environments.');
        }) as any);

    this.RTCIceCandidate = rtcIceCandidate || (typeof globalThis.RTCIceCandidate !== 'undefined'
      ? globalThis.RTCIceCandidate
      : (() => {
          throw new Error('RTCIceCandidate is not available. Please provide it in the Rondevu constructor options for Node.js environments.');
        }) as any);

    this.pc = new this.RTCPeerConnection(rtcConfig);
    this._state = new IdleState(this);

    this.setupPeerConnection();
  }

  /**
   * Set up peer connection event handlers
   */
  private setupPeerConnection(): void {
    this.connectionStateChangeHandler = () => {
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
    this.pc.addEventListener('connectionstatechange', this.connectionStateChangeHandler);

    this.dataChannelHandler = (event: RTCDataChannelEvent) => {
      this.emitEvent('datachannel', event.channel);
    };
    this.pc.addEventListener('datachannel', this.dataChannelHandler);

    this.trackHandler = (event: RTCTrackEvent) => {
      this.emitEvent('track', event);
    };
    this.pc.addEventListener('track', this.trackHandler);

    this.iceCandidateErrorHandler = (event: Event) => {
      console.error('ICE candidate error:', event);
    };
    this.pc.addEventListener('icecandidateerror', this.iceCandidateErrorHandler);
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
   * Create a data channel for sending and receiving arbitrary data
   * This should typically be called by the offerer before creating the offer
   * The answerer will receive the channel via the 'datachannel' event
   */
  createDataChannel(label: string, options?: RTCDataChannelInit): RTCDataChannel {
    return this.pc.createDataChannel(label, options);
  }

  /**
   * Close the connection and clean up
   */
  async close(): Promise<void> {
    // Remove RTCPeerConnection event listeners
    if (this.connectionStateChangeHandler) {
      this.pc.removeEventListener('connectionstatechange', this.connectionStateChangeHandler);
    }
    if (this.dataChannelHandler) {
      this.pc.removeEventListener('datachannel', this.dataChannelHandler);
    }
    if (this.trackHandler) {
      this.pc.removeEventListener('track', this.trackHandler);
    }
    if (this.iceCandidateErrorHandler) {
      this.pc.removeEventListener('icecandidateerror', this.iceCandidateErrorHandler);
    }

    await this._state.close();
    this.removeAllListeners();
  }
}
