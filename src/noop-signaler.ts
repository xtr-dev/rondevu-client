import { Signaler } from './types.js'
import { Binnable } from './bin.js'

/**
 * NoOpSignaler - A signaler that does nothing
 * Used as a placeholder during connection setup before the real signaler is available
 */
export class NoOpSignaler implements Signaler {
    addIceCandidate(_candidate: RTCIceCandidate): void {
        // No-op
    }

    addListener(_callback: (candidate: RTCIceCandidate) => void): Binnable {
        // Return no-op cleanup function
        return () => {}
    }

    addOfferListener(_callback: (offer: RTCSessionDescriptionInit) => void): Binnable {
        // Return no-op cleanup function
        return () => {}
    }

    addAnswerListener(_callback: (answer: RTCSessionDescriptionInit) => void): Binnable {
        // Return no-op cleanup function
        return () => {}
    }

    async setOffer(_offer: RTCSessionDescriptionInit): Promise<void> {
        // No-op
    }

    async setAnswer(_answer: RTCSessionDescriptionInit): Promise<void> {
        // No-op
    }
}
