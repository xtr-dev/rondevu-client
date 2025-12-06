import { RondevuOffers, Offer } from './offers.js';

/**
 * Represents an offer that has been answered
 */
export interface AnsweredOffer {
  offerId: string;
  answererId: string;
  sdp: string; // Answer SDP
  peerConnection: RTCPeerConnection; // Original peer connection
  dataChannel?: RTCDataChannel; // Data channel created with offer
  answeredAt: number;
}

/**
 * Configuration options for the offer pool
 */
export interface OfferPoolOptions {
  /** Number of simultaneous open offers to maintain */
  poolSize: number;

  /** Polling interval in milliseconds (default: 2000ms) */
  pollingInterval?: number;

  /** Callback invoked when an offer is answered */
  onAnswered: (answer: AnsweredOffer) => Promise<void>;

  /** Callback to create new offers when refilling the pool */
  onRefill: (count: number) => Promise<{ offers: Offer[], peerConnections: RTCPeerConnection[], dataChannels: RTCDataChannel[] }>;

  /** Error handler for pool operations */
  onError: (error: Error, context: string) => void;
}

/**
 * Manages a pool of offers with automatic polling and refill
 *
 * The OfferPool maintains a configurable number of simultaneous offers,
 * polls for answers periodically, and automatically refills the pool
 * when offers are consumed.
 */
export class OfferPool {
  private offers: Map<string, Offer> = new Map();
  private peerConnections: Map<string, RTCPeerConnection> = new Map();
  private dataChannels: Map<string, RTCDataChannel> = new Map();
  private polling: boolean = false;
  private pollingTimer?: ReturnType<typeof setInterval>;
  private lastPollTime: number = 0;
  private readonly pollingInterval: number;

  constructor(
    private offersApi: RondevuOffers,
    private options: OfferPoolOptions
  ) {
    this.pollingInterval = options.pollingInterval || 2000;
  }

  /**
   * Add offers to the pool with their peer connections and data channels
   */
  async addOffers(offers: Offer[], peerConnections?: RTCPeerConnection[], dataChannels?: RTCDataChannel[]): Promise<void> {
    for (let i = 0; i < offers.length; i++) {
      const offer = offers[i];
      this.offers.set(offer.id, offer);
      if (peerConnections && peerConnections[i]) {
        this.peerConnections.set(offer.id, peerConnections[i]);
      }
      if (dataChannels && dataChannels[i]) {
        this.dataChannels.set(offer.id, dataChannels[i]);
      }
    }
  }

  /**
   * Start polling for answers
   */
  async start(): Promise<void> {
    if (this.polling) {
      return;
    }

    this.polling = true;

    // Do an immediate poll
    await this.poll().catch((error) => {
      this.options.onError(error, 'initial-poll');
    });

    // Start polling interval
    this.pollingTimer = setInterval(async () => {
      if (this.polling) {
        await this.poll().catch((error) => {
          this.options.onError(error, 'poll');
        });
      }
    }, this.pollingInterval);
  }

  /**
   * Stop polling for answers
   */
  async stop(): Promise<void> {
    this.polling = false;

    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = undefined;
    }
  }

  /**
   * Poll for answers and refill the pool if needed
   */
  private async poll(): Promise<void> {
    try {
      // Get all answers from server
      const answers = await this.offersApi.getAnswers();

      // Filter for our pool's offers
      const myAnswers = answers.filter(a => this.offers.has(a.offerId));

      // Process each answer
      for (const answer of myAnswers) {
        // Get the original offer, peer connection, and data channel
        const offer = this.offers.get(answer.offerId);
        const pc = this.peerConnections.get(answer.offerId);
        const channel = this.dataChannels.get(answer.offerId);

        if (!offer || !pc) {
          continue; // Offer or peer connection already consumed, skip
        }

        // Remove from pool BEFORE processing to prevent duplicate processing
        this.offers.delete(answer.offerId);
        this.peerConnections.delete(answer.offerId);
        this.dataChannels.delete(answer.offerId);

        // Notify ServicePool with answer, original peer connection, and data channel
        await this.options.onAnswered({
          offerId: answer.offerId,
          answererId: answer.answererId,
          sdp: answer.sdp,
          peerConnection: pc,
          dataChannel: channel,
          answeredAt: answer.answeredAt
        });
      }

      // Immediate refill if below pool size
      if (this.offers.size < this.options.poolSize) {
        const needed = this.options.poolSize - this.offers.size;

        try {
          const result = await this.options.onRefill(needed);
          await this.addOffers(result.offers, result.peerConnections, result.dataChannels);
        } catch (refillError) {
          this.options.onError(
            refillError as Error,
            'refill'
          );
        }
      }

      this.lastPollTime = Date.now();
    } catch (error) {
      // Don't crash the pool on errors - let error handler deal with it
      this.options.onError(error as Error, 'poll');
    }
  }

  /**
   * Get the current number of active offers in the pool
   */
  getActiveOfferCount(): number {
    return this.offers.size;
  }

  /**
   * Get all active offer IDs
   */
  getActiveOfferIds(): string[] {
    return Array.from(this.offers.keys());
  }

  /**
   * Get all active peer connections
   */
  getActivePeerConnections(): RTCPeerConnection[] {
    return Array.from(this.peerConnections.values());
  }

  /**
   * Get the last poll timestamp
   */
  getLastPollTime(): number {
    return this.lastPollTime;
  }

  /**
   * Check if the pool is currently polling
   */
  isPolling(): boolean {
    return this.polling;
  }
}
