import type { PeerOptions } from './types.js';
import type RondevuPeer from './index.js';

/**
 * Base class for peer connection states
 * Implements the State pattern for managing WebRTC connection lifecycle
 */
export abstract class PeerState {
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

  async close(): Promise<void> {
    this.cleanup();
    const { ClosedState } = await import('./closed-state.js');
    this.peer.setState(new ClosedState(this.peer));
  }
}
