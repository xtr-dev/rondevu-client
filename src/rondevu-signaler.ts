import { Signaler, Binnable } from './types.js'
import { Rondevu } from './rondevu.js'

export interface PollingConfig {
    initialInterval?: number     // Default: 500ms
    maxInterval?: number          // Default: 5000ms
    backoffMultiplier?: number    // Default: 1.5
    maxRetries?: number           // Default: 50 (50 seconds max)
    jitter?: boolean              // Default: true
}

/**
 * RondevuSignaler - Handles WebRTC signaling via Rondevu service
 *
 * Manages offer/answer exchange and ICE candidate polling for establishing
 * WebRTC connections through the Rondevu signaling server.
 *
 * Supports configurable polling with exponential backoff and jitter to reduce
 * server load and prevent thundering herd issues.
 *
 * @example
 * ```typescript
 * const signaler = new RondevuSignaler(
 *   rondevuService,
 *   'chat.app@1.0.0',
 *   'peer-username',
 *   { initialInterval: 500, maxInterval: 5000, jitter: true }
 * )
 *
 * // For offerer:
 * await signaler.setOffer(offer)
 * signaler.addAnswerListener(answer => {
 *   // Handle remote answer
 * })
 *
 * // For answerer:
 * signaler.addOfferListener(offer => {
 *   // Handle remote offer
 * })
 * await signaler.setAnswer(answer)
 * ```
 */
export class RondevuSignaler implements Signaler {
    private offerId: string | null = null
    private serviceFqn: string | null = null
    private offerListeners: Array<(offer: RTCSessionDescriptionInit) => void> = []
    private answerListeners: Array<(answer: RTCSessionDescriptionInit) => void> = []
    private iceListeners: Array<(candidate: RTCIceCandidate) => void> = []
    private pollingTimeout: ReturnType<typeof setTimeout> | null = null
    private icePollingTimeout: ReturnType<typeof setTimeout> | null = null
    private lastPollTimestamp = 0
    private isPolling = false
    private isOfferer = false
    private pollingConfig: Required<PollingConfig>

    constructor(
        private readonly rondevu: Rondevu,
        private readonly service: string,
        private readonly host?: string,
        pollingConfig?: PollingConfig
    ) {
        this.pollingConfig = {
            initialInterval: pollingConfig?.initialInterval ?? 500,
            maxInterval: pollingConfig?.maxInterval ?? 5000,
            backoffMultiplier: pollingConfig?.backoffMultiplier ?? 1.5,
            maxRetries: pollingConfig?.maxRetries ?? 50,
            jitter: pollingConfig?.jitter ?? true
        }
    }

    /**
     * Publish an offer as a service
     * Used by the offerer to make their offer available
     */
    async setOffer(offer: RTCSessionDescriptionInit): Promise<void> {
        if (!offer.sdp) {
            throw new Error('Offer SDP is required')
        }

        // Publish service with the offer SDP
        const publishedService = await this.rondevu.publishService({
            serviceFqn: this.service,
            offers: [{ sdp: offer.sdp }],
            ttl: 300000, // 5 minutes
        })

        // Get the first offer from the published service
        if (!publishedService.offers || publishedService.offers.length === 0) {
            throw new Error('No offers returned from service publication')
        }

        this.offerId = publishedService.offers[0].offerId
        this.serviceFqn = publishedService.serviceFqn
        this.isOfferer = true

        // Start combined polling for answers and ICE candidates
        this.startPolling()
    }

    /**
     * Send an answer to the offerer
     * Used by the answerer to respond to an offer
     */
    async setAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
        if (!answer.sdp) {
            throw new Error('Answer SDP is required')
        }

        if (!this.serviceFqn || !this.offerId) {
            throw new Error('No service FQN or offer ID available. Must receive offer first.')
        }

        // Send answer to the service
        const result = await this.rondevu.getAPI().postOfferAnswer(this.serviceFqn, this.offerId, answer.sdp)
        this.offerId = result.offerId
        this.isOfferer = false

        // Start polling for ICE candidates (answerer uses separate endpoint)
        this.startIcePolling()
    }

    /**
     * Listen for incoming offers
     * Used by the answerer to receive offers from the offerer
     */
    addOfferListener(callback: (offer: RTCSessionDescriptionInit) => void): Binnable {
        this.offerListeners.push(callback)

        // If we have a host, start searching for their service
        if (this.host && !this.isPolling) {
            this.searchForOffer()
        }

        // Return cleanup function
        return () => {
            const index = this.offerListeners.indexOf(callback)
            if (index > -1) {
                this.offerListeners.splice(index, 1)
            }
        }
    }

    /**
     * Listen for incoming answers
     * Used by the offerer to receive the answer from the answerer
     */
    addAnswerListener(callback: (answer: RTCSessionDescriptionInit) => void): Binnable {
        this.answerListeners.push(callback)

        // Return cleanup function
        return () => {
            const index = this.answerListeners.indexOf(callback)
            if (index > -1) {
                this.answerListeners.splice(index, 1)
            }
        }
    }

    /**
     * Send an ICE candidate to the remote peer
     */
    async addIceCandidate(candidate: RTCIceCandidate): Promise<void> {
        if (!this.serviceFqn || !this.offerId) {
            console.warn('Cannot send ICE candidate: no service FQN or offer ID')
            return
        }

        const candidateData = candidate.toJSON()

        // Skip empty candidates
        if (!candidateData.candidate || candidateData.candidate === '') {
            return
        }

        try {
            await this.rondevu.getAPI().addOfferIceCandidates(
                this.serviceFqn,
                this.offerId,
                [candidateData]
            )
        } catch (err) {
            console.error('Failed to send ICE candidate:', err)
        }
    }

    /**
     * Listen for ICE candidates from the remote peer
     */
    addListener(callback: (candidate: RTCIceCandidate) => void): Binnable {
        this.iceListeners.push(callback)

        // Return cleanup function
        return () => {
            const index = this.iceListeners.indexOf(callback)
            if (index > -1) {
                this.iceListeners.splice(index, 1)
            }
        }
    }

    /**
     * Search for an offer from the host
     * Used by the answerer to find the offerer's service
     */
    private async searchForOffer(): Promise<void> {
        if (!this.host) {
            throw new Error('No host specified for offer search')
        }

        this.isPolling = true

        try {
            // Get service by FQN (service should include @username)
            const serviceFqn = `${this.service}@${this.host}`
            const serviceData = await this.rondevu.getAPI().getService(serviceFqn)

            if (!serviceData) {
                console.warn(`No service found for ${serviceFqn}`)
                this.isPolling = false
                return
            }

            // Store service details
            this.offerId = serviceData.offerId
            this.serviceFqn = serviceData.serviceFqn

            // Notify offer listeners
            const offer: RTCSessionDescriptionInit = {
                type: 'offer',
                sdp: serviceData.sdp,
            }

            this.offerListeners.forEach(listener => {
                try {
                    listener(offer)
                } catch (err) {
                    console.error('Offer listener error:', err)
                }
            })
        } catch (err) {
            console.error('Failed to search for offer:', err)
            this.isPolling = false
        }
    }

    /**
     * Start combined polling for answers and ICE candidates (offerer side)
     * Uses pollOffers() for efficient batch polling
     */
    private startPolling(): void {
        if (this.pollingTimeout || !this.isOfferer) {
            return
        }

        let interval = this.pollingConfig.initialInterval
        let retries = 0
        let answerReceived = false

        const poll = async () => {
            try {
                const result = await this.rondevu.pollOffers(this.lastPollTimestamp)

                let foundActivity = false

                // Process answers
                if (result.answers.length > 0 && !answerReceived) {
                    foundActivity = true

                    // Find answer for our offerId
                    const answer = result.answers.find(a => a.offerId === this.offerId)

                    if (answer && answer.sdp) {
                        answerReceived = true

                        const answerDesc: RTCSessionDescriptionInit = {
                            type: 'answer',
                            sdp: answer.sdp,
                        }

                        this.answerListeners.forEach(listener => {
                            try {
                                listener(answerDesc)
                            } catch (err) {
                                console.error('Answer listener error:', err)
                            }
                        })

                        this.lastPollTimestamp = Math.max(this.lastPollTimestamp, answer.answeredAt)
                    }
                }

                // Process ICE candidates for our offer
                if (this.offerId && result.iceCandidates[this.offerId]) {
                    const candidates = result.iceCandidates[this.offerId]

                    // Filter for answerer candidates (offerer receives answerer's candidates)
                    const answererCandidates = candidates.filter(c => c.role === 'answerer')

                    if (answererCandidates.length > 0) {
                        foundActivity = true

                        for (const item of answererCandidates) {
                            if (item.candidate && item.candidate.candidate && item.candidate.candidate !== '') {
                                try {
                                    const rtcCandidate = new RTCIceCandidate(item.candidate)

                                    this.iceListeners.forEach(listener => {
                                        try {
                                            listener(rtcCandidate)
                                        } catch (err) {
                                            console.error('ICE listener error:', err)
                                        }
                                    })

                                    this.lastPollTimestamp = Math.max(this.lastPollTimestamp, item.createdAt)
                                } catch (err) {
                                    console.warn('Failed to process ICE candidate:', err)
                                    this.lastPollTimestamp = Math.max(this.lastPollTimestamp, item.createdAt)
                                }
                            }
                        }
                    }
                }

                // Adjust interval based on activity
                if (foundActivity) {
                    interval = this.pollingConfig.initialInterval
                    retries = 0
                } else {
                    retries++
                    if (retries > this.pollingConfig.maxRetries) {
                        console.warn('Max retries reached for polling')
                        this.stopPolling()
                        return
                    }

                    interval = Math.min(
                        interval * this.pollingConfig.backoffMultiplier,
                        this.pollingConfig.maxInterval
                    )
                }

                // Add jitter to prevent thundering herd
                const finalInterval = this.pollingConfig.jitter
                    ? interval + Math.random() * 100
                    : interval

                this.pollingTimeout = setTimeout(poll, finalInterval)

            } catch (err) {
                console.error('Error polling offers:', err)

                // Retry with backoff
                const finalInterval = this.pollingConfig.jitter
                    ? interval + Math.random() * 100
                    : interval
                this.pollingTimeout = setTimeout(poll, finalInterval)
            }
        }

        poll() // Start immediately
    }

    /**
     * Stop combined polling
     */
    private stopPolling(): void {
        if (this.pollingTimeout) {
            clearTimeout(this.pollingTimeout)
            this.pollingTimeout = null
        }
    }

    /**
     * Start polling for ICE candidates (answerer side only)
     * Answerers use the separate endpoint since they don't have offers to poll
     */
    private startIcePolling(): void {
        if (this.icePollingTimeout || !this.serviceFqn || !this.offerId || this.isOfferer) {
            return
        }

        let interval = this.pollingConfig.initialInterval

        const poll = async () => {
            if (!this.serviceFqn || !this.offerId) {
                this.stopIcePolling()
                return
            }

            try {
                const result = await this.rondevu
                    .getAPI()
                    .getOfferIceCandidates(this.serviceFqn, this.offerId, this.lastPollTimestamp)

                let foundCandidates = false

                for (const item of result.candidates) {
                    if (item.candidate && item.candidate.candidate && item.candidate.candidate !== '') {
                        foundCandidates = true
                        try {
                            const rtcCandidate = new RTCIceCandidate(item.candidate)

                            this.iceListeners.forEach(listener => {
                                try {
                                    listener(rtcCandidate)
                                } catch (err) {
                                    console.error('ICE listener error:', err)
                                }
                            })

                            this.lastPollTimestamp = item.createdAt
                        } catch (err) {
                            console.warn('Failed to process ICE candidate:', err)
                            this.lastPollTimestamp = item.createdAt
                        }
                    } else {
                        this.lastPollTimestamp = item.createdAt
                    }
                }

                // If candidates found, reset interval to initial value
                // Otherwise, increase interval with backoff
                if (foundCandidates) {
                    interval = this.pollingConfig.initialInterval
                } else {
                    interval = Math.min(
                        interval * this.pollingConfig.backoffMultiplier,
                        this.pollingConfig.maxInterval
                    )
                }

                // Add jitter
                const finalInterval = this.pollingConfig.jitter
                    ? interval + Math.random() * 100
                    : interval

                this.icePollingTimeout = setTimeout(poll, finalInterval)

            } catch (err) {
                // 404/410 means offer expired, stop polling
                if (err instanceof Error && (err.message?.includes('404') || err.message?.includes('410'))) {
                    console.warn('Offer not found or expired, stopping ICE polling')
                    this.stopIcePolling()
                } else if (err instanceof Error && !err.message?.includes('404')) {
                    console.error('Error polling for ICE candidates:', err)
                    // Continue polling despite errors
                    const finalInterval = this.pollingConfig.jitter
                        ? interval + Math.random() * 100
                        : interval
                    this.icePollingTimeout = setTimeout(poll, finalInterval)
                }
            }
        }

        poll() // Start immediately
    }

    /**
     * Stop polling for ICE candidates
     */
    private stopIcePolling(): void {
        if (this.icePollingTimeout) {
            clearTimeout(this.icePollingTimeout)
            this.icePollingTimeout = null
        }
    }

    /**
     * Stop all polling and cleanup
     */
    dispose(): void {
        this.stopPolling()
        this.stopIcePolling()
        this.offerListeners = []
        this.answerListeners = []
        this.iceListeners = []
    }
}
