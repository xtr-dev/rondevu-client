import { PeerState } from './state.js';

/**
 * Failed state - connection attempt failed
 */
export class FailedState extends PeerState {
  constructor(peer: any, private error: Error) {
    super(peer);
    peer.emitEvent('failed', error);
  }

  get name() { return 'failed'; }

  cleanup(): void {
    // Connection is failed, clean up resources
    this.peer.pc.close();
  }
}
