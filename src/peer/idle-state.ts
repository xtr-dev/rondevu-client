import { PeerState } from './state.js';
import type { PeerOptions } from './types.js';

export class IdleState extends PeerState {
  get name() { return 'idle'; }

  async createOffer(options: PeerOptions): Promise<string> {
    const { CreatingOfferState } = await import('./creating-offer-state.js');
    this.peer.setState(new CreatingOfferState(this.peer, options));
    return this.peer.state.createOffer(options);
  }

  async answer(offerId: string, offerSdp: string, options: PeerOptions): Promise<void> {
    const { AnsweringState } = await import('./answering-state.js');
    this.peer.setState(new AnsweringState(this.peer));
    return this.peer.state.answer(offerId, offerSdp, options);
  }
}
