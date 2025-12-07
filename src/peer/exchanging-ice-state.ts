import { PeerState } from './state.js';
import type { PeerOptions } from './types.js';
import type RondevuPeer from './index.js';

/**
 * Exchanging ICE candidates and waiting for connection
 */
export class ExchangingIceState extends PeerState {
  private pollingInterval?: ReturnType<typeof setInterval>;
  private timeout?: ReturnType<typeof setTimeout>;
  private lastIceTimestamp = 0;

  constructor(
    peer: RondevuPeer,
    private offerId: string,
    private options: PeerOptions
  ) {
    super(peer);
    this.startPolling();
  }

  get name() { return 'exchanging-ice'; }

  private startPolling(): void {
    const connectionTimeout = this.options.timeouts?.iceConnection || 30000;

    this.timeout = setTimeout(async () => {
      this.cleanup();
      const { FailedState } = await import('./failed-state.js');
      this.peer.setState(new FailedState(
        this.peer,
        new Error('ICE connection timeout')
      ));
    }, connectionTimeout);

    this.pollingInterval = setInterval(async () => {
      try {
        const candidates = await this.peer.offersApi.getIceCandidates(
          this.offerId,
          this.lastIceTimestamp
        );

        if (candidates.length > 0) {
          console.log(`📥 Received ${candidates.length} remote ICE candidate(s)`);
        }

        for (const cand of candidates) {
          if (cand.candidate && cand.candidate.candidate && cand.candidate.candidate !== '') {
            const type = cand.candidate.candidate.includes('typ host') ? 'host' :
                         cand.candidate.candidate.includes('typ srflx') ? 'srflx' :
                         cand.candidate.candidate.includes('typ relay') ? 'relay' : 'unknown';
            console.log(`🧊 Adding remote ${type} ICE candidate:`, cand.candidate.candidate);
            try {
              await this.peer.pc.addIceCandidate(new this.peer.RTCIceCandidate(cand.candidate));
              console.log(`✅ Added remote ${type} ICE candidate`);
              this.lastIceTimestamp = cand.createdAt;
            } catch (err) {
              console.warn(`⚠️ Failed to add remote ${type} ICE candidate:`, err);
              this.lastIceTimestamp = cand.createdAt;
            }
          } else {
            this.lastIceTimestamp = cand.createdAt;
          }
        }
      } catch (err) {
        console.error('❌ Error polling for ICE candidates:', err);
        if (err instanceof Error && err.message.includes('not found')) {
          this.cleanup();
          const { FailedState } = await import('./failed-state.js');
          this.peer.setState(new FailedState(
            this.peer,
            new Error('Offer expired or not found')
          ));
        }
      }
    }, 1000);
  }

  cleanup(): void {
    if (this.pollingInterval) clearInterval(this.pollingInterval);
    if (this.timeout) clearTimeout(this.timeout);
  }
}
