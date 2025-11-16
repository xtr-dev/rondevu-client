import { PeerState } from './state.js';

/**
 * Connected state - peer connection is established
 */
export class ConnectedState extends PeerState {
  get name() { return 'connected'; }

  cleanup(): void {
    // Keep connection alive, but stop any polling
    // The peer connection will handle disconnects via onconnectionstatechange
  }
}
