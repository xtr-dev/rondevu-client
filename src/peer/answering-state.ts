import { PeerState } from './state.js';
import type { PeerOptions } from './types.js';
import type RondevuPeer from './index.js';

/**
 * Answering an offer and sending to server
 */
export class AnsweringState extends PeerState {
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

      // Enable trickle ICE - set up handler before ICE gathering starts
      this.setupIceCandidateHandler();

      // Create answer
      const answer = await this.peer.pc.createAnswer();
      await this.peer.pc.setLocalDescription(answer); // ICE gathering starts here

      // Send answer to server immediately (don't wait for ICE)
      await this.peer.offersApi.answer(offerId, answer.sdp!);

      // Transition to exchanging ICE
      const { ExchangingIceState } = await import('./exchanging-ice-state.js');
      this.peer.setState(new ExchangingIceState(this.peer, offerId, options));
    } catch (error) {
      const { FailedState } = await import('./failed-state.js');
      this.peer.setState(new FailedState(this.peer, error as Error));
      throw error;
    }
  }
}
