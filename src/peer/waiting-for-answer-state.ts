import { PeerState } from './state.js';
import type { PeerOptions } from './types.js';
import type RondevuPeer from './index.js';

/**
 * Waiting for answer from another peer
 */
export class WaitingForAnswerState extends PeerState {
  private pollingInterval?: ReturnType<typeof setInterval>;
  private timeout?: ReturnType<typeof setTimeout>;

  constructor(
    peer: RondevuPeer,
    private offerId: string,
    private options: PeerOptions
  ) {
    super(peer);
    this.startPolling();
  }

  get name() { return 'waiting-for-answer'; }

  private startPolling(): void {
    const answerTimeout = this.options.timeouts?.waitingForAnswer || 30000;

    this.timeout = setTimeout(async () => {
      this.cleanup();
      const { FailedState } = await import('./failed-state.js');
      this.peer.setState(new FailedState(
        this.peer,
        new Error('Timeout waiting for answer')
      ));
    }, answerTimeout);

    this.pollingInterval = setInterval(async () => {
      try {
        const answers = await this.peer.offersApi.getAnswers();
        const myAnswer = answers.find((a: any) => a.offerId === this.offerId);

        if (myAnswer) {
          this.cleanup();
          await this.handleAnswer(myAnswer.sdp);
        }
      } catch (err) {
        console.error('Error polling for answers:', err);
        if (err instanceof Error && err.message.includes('not found')) {
          this.cleanup();
          const { FailedState } = await import('./failed-state.js');
          this.peer.setState(new FailedState(
            this.peer,
            new Error('Offer expired or not found')
          ));
        }
      }
    }, 2000);
  }

  async handleAnswer(sdp: string): Promise<void> {
    try {
      await this.peer.pc.setRemoteDescription({
        type: 'answer',
        sdp
      });

      // Transition to exchanging ICE
      const { ExchangingIceState } = await import('./exchanging-ice-state.js');
      this.peer.setState(new ExchangingIceState(this.peer, this.offerId, this.options));
    } catch (error) {
      const { FailedState } = await import('./failed-state.js');
      this.peer.setState(new FailedState(this.peer, error as Error));
    }
  }

  cleanup(): void {
    if (this.pollingInterval) clearInterval(this.pollingInterval);
    if (this.timeout) clearTimeout(this.timeout);
  }
}
