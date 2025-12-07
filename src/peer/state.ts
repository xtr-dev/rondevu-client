import type { PeerOptions } from './types.js';
import type RondevuPeer from './index.js';

/**
 * Base class for peer connection states
 * Implements the State pattern for managing WebRTC connection lifecycle
 */
export abstract class PeerState {
  protected iceCandidateHandler?: (event: RTCPeerConnectionIceEvent) => void;

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
      await this.peer.pc.addIceCandidate(new this.peer.RTCIceCandidate(candidate));
    }
  }

  /**
   * Setup trickle ICE candidate handler
   * Sends local ICE candidates to server as they are discovered
   */
  protected setupIceCandidateHandler(): void {
    this.iceCandidateHandler = async (event: RTCPeerConnectionIceEvent) => {
      if (event.candidate && this.peer.offerId) {
        const candidateData = event.candidate.toJSON();
        if (candidateData.candidate && candidateData.candidate !== '') {
          const type = candidateData.candidate.includes('typ host') ? 'host' :
                       candidateData.candidate.includes('typ srflx') ? 'srflx' :
                       candidateData.candidate.includes('typ relay') ? 'relay' : 'unknown';
          console.log(`🧊 Generated ${type} ICE candidate:`, candidateData.candidate);
          try {
            await this.peer.offersApi.addIceCandidates(this.peer.offerId, [candidateData]);
            console.log(`✅ Sent ${type} ICE candidate to server`);
          } catch (err) {
            console.error(`❌ Error sending ${type} ICE candidate:`, err);
          }
        }
      } else if (!event.candidate) {
        console.log('🧊 ICE gathering complete (null candidate)');
      }
    };
    this.peer.pc.addEventListener('icecandidate', this.iceCandidateHandler);
  }

  cleanup(): void {
    // Clean up ICE candidate handler if it exists
    if (this.iceCandidateHandler) {
      this.peer.pc.removeEventListener('icecandidate', this.iceCandidateHandler);
    }
  }

  async close(): Promise<void> {
    this.cleanup();
    const { ClosedState } = await import('./closed-state.js');
    this.peer.setState(new ClosedState(this.peer));
  }
}
