import { PeerState } from './state.js';

/**
 * Closed state - connection has been terminated
 */
export class ClosedState extends PeerState {
  get name() { return 'closed'; }

  cleanup(): void {
    this.peer.pc.close();
  }
}
