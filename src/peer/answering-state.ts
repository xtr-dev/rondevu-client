import { PeerState } from './state.js';
import type { PeerOptions } from './types.js';
import type RondevuPeer from './index.js';

/**
 * Answering an offer and sending to server
 */
export class AnsweringState extends PeerState {
  private iceCandidateHandler?: (event: RTCPeerConnectionIceEvent) => void;

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
      this.iceCandidateHandler = async (event: RTCPeerConnectionIceEvent) => {
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
      this.peer.pc.addEventListener('icecandidate', this.iceCandidateHandler);

      // Transition to exchanging ICE
      const { ExchangingIceState } = await import('./exchanging-ice-state.js');
      this.peer.setState(new ExchangingIceState(this.peer, offerId, options));
    } catch (error) {
      const { FailedState } = await import('./failed-state.js');
      this.peer.setState(new FailedState(this.peer, error as Error));
      throw error;
    }
  }

  cleanup(): void {
    if (this.iceCandidateHandler) {
      this.peer.pc.removeEventListener('icecandidate', this.iceCandidateHandler);
    }
  }
}
