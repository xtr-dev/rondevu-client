import { Signaler } from './types.js'
import { Binnable } from './bin.js'
import { RondevuAPI } from './api.js'

/**
 * RondevuSignaler - Handles ICE candidate exchange via Rondevu API
 * Uses polling to retrieve remote candidates
 */
export class RondevuSignaler implements Signaler {
    constructor(
        private api: RondevuAPI,
        private offerId: string
    ) {}

    addOfferListener(callback: (offer: RTCSessionDescriptionInit) => void): Binnable {
        throw new Error('Method not implemented.')
    }
    addAnswerListener(callback: (answer: RTCSessionDescriptionInit) => void): Binnable {
        throw new Error('Method not implemented.')
    }
    setOffer(offer: RTCSessionDescriptionInit): Promise<void> {
        throw new Error('Method not implemented.')
    }
    setAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
        throw new Error('Method not implemented.')
    }

    /**
     * Send a local ICE candidate to signaling server
     */
    async addIceCandidate(candidate: RTCIceCandidate): Promise<void> {
        const candidateData = candidate.toJSON()

        // Skip empty candidates
        if (!candidateData.candidate || candidateData.candidate === '') {
            return
        }

        await this.api.addIceCandidates(this.offerId, [candidateData])
    }

    /**
     * Poll for remote ICE candidates and call callback for each one
     * Returns cleanup function to stop polling
     */
    addListener(callback: (candidate: RTCIceCandidate) => void): Binnable {
        let lastTimestamp = 0
        let polling = true

        const poll = async () => {
            while (polling) {
                try {
                    const candidates = await this.api.getIceCandidates(this.offerId, lastTimestamp)

                    // Process each candidate
                    for (const item of candidates) {
                        if (
                            item.candidate &&
                            item.candidate.candidate &&
                            item.candidate.candidate !== ''
                        ) {
                            try {
                                const rtcCandidate = new RTCIceCandidate(item.candidate)
                                callback(rtcCandidate)
                                lastTimestamp = item.createdAt
                            } catch (err) {
                                console.warn('Failed to process ICE candidate:', err)
                                lastTimestamp = item.createdAt
                            }
                        } else {
                            lastTimestamp = item.createdAt
                        }
                    }
                } catch (err) {
                    // If offer not found or expired, stop polling
                    if (
                        err instanceof Error &&
                        (err.message.includes('404') || err.message.includes('410'))
                    ) {
                        console.warn('Offer not found or expired, stopping ICE polling')
                        polling = false
                        break
                    }
                    console.error('Error polling for ICE candidates:', err)
                }

                // Poll every second
                if (polling) {
                    await new Promise(resolve => setTimeout(resolve, 1000))
                }
            }
        }

        // Start polling in the background
        poll().then(() => {
            console.log('ICE polling started')
        })

        // Return cleanup function
        return () => {
            polling = false
        }
    }
}
