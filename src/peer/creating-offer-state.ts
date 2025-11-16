import { PeerState } from './state.js';
import type { PeerOptions } from './types.js';
import type RondevuPeer from './index.js';

/**
 * Creating offer and sending to server
 */
export class CreatingOfferState extends PeerState {
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
      this.setupIceCandidateHandler(offerId);

      // Transition to waiting for answer
      const { WaitingForAnswerState } = await import('./waiting-for-answer-state.js');
      this.peer.setState(new WaitingForAnswerState(this.peer, offerId, options));

      return offerId;
    } catch (error) {
      const { FailedState } = await import('./failed-state.js');
      this.peer.setState(new FailedState(this.peer, error as Error));
      throw error;
    }
  }
}
