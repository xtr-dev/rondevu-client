import { Signaler } from './types.js'
import { RondevuService } from './rondevu-service.js'
import { Binnable } from './bin.js'

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
    private serviceUuid: string | null = null
    private offerListeners: Array<(offer: RTCSessionDescriptionInit) => void> = []
    private answerListeners: Array<(answer: RTCSessionDescriptionInit) => void> = []
    private iceListeners: Array<(candidate: RTCIceCandidate) => void> = []
    private answerPollingTimeout: ReturnType<typeof setTimeout> | null = null
    private icePollingTimeout: ReturnType<typeof setTimeout> | null = null
    private lastIceTimestamp = 0
    private isPolling = false
    private pollingConfig: Required<PollingConfig>

    constructor(
        private readonly rondevu: RondevuService,
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
            isPublic: true,
        })

        // Get the first offer from the published service
        if (!publishedService.offers || publishedService.offers.length === 0) {
            throw new Error('No offers returned from service publication')
        }

        this.offerId = publishedService.offers[0].offerId
        this.serviceUuid = publishedService.uuid

        // Start polling for answer
        this.startAnswerPolling()

        // Start polling for ICE candidates
        this.startIcePolling()
    }

    /**
     * Send an answer to the offerer
     * Used by the answerer to respond to an offer
     */
    async setAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
        if (!answer.sdp) {
            throw new Error('Answer SDP is required')
        }

        if (!this.serviceUuid) {
            throw new Error('No service UUID available. Must receive offer first.')
        }

        // Send answer to the service
        const result = await this.rondevu.getAPI().answerService(this.serviceUuid, answer.sdp)
        this.offerId = result.offerId

        // Start polling for ICE candidates
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
        if (!this.serviceUuid) {
            console.warn('Cannot send ICE candidate: no service UUID')
            return
        }

        const candidateData = candidate.toJSON()

        // Skip empty candidates
        if (!candidateData.candidate || candidateData.candidate === '') {
            return
        }

        try {
            const result = await this.rondevu.getAPI().addServiceIceCandidates(
                this.serviceUuid,
                [candidateData],
                this.offerId || undefined
            )
            // Store offerId if we didn't have it yet
            if (!this.offerId) {
                this.offerId = result.offerId
            }
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
            // Search for services by username and service FQN
            const services = await this.rondevu.getAPI().searchServices(this.host, this.service)

            if (services.length === 0) {
                console.warn(`No services found for ${this.host}/${this.service}`)
                this.isPolling = false
                return
            }

            // Get the first available service (already has full details from searchServices)
            const service = services[0] as any

            // Get the first available offer from the service
            if (!service.offers || service.offers.length === 0) {
                console.warn(`No offers available for service ${this.host}/${this.service}`)
                this.isPolling = false
                return
            }

            const firstOffer = service.offers[0]
            this.offerId = firstOffer.offerId
            this.serviceUuid = service.uuid

            // Notify offer listeners
            const offer: RTCSessionDescriptionInit = {
                type: 'offer',
                sdp: firstOffer.sdp,
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
     * Start polling for answer (offerer side) with exponential backoff
     */
    private startAnswerPolling(): void {
        if (this.answerPollingTimeout || !this.serviceUuid) {
            return
        }

        let interval = this.pollingConfig.initialInterval
        let retries = 0

        const poll = async () => {
            if (!this.serviceUuid) {
                this.stopAnswerPolling()
                return
            }

            try {
                const answer = await this.rondevu.getAPI().getServiceAnswer(this.serviceUuid)

                if (answer && answer.sdp) {
                    // Store offerId if we didn't have it yet
                    if (!this.offerId) {
                        this.offerId = answer.offerId
                    }

                    // Got answer - notify listeners and stop polling
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

                    // Stop polling once we get the answer
                    this.stopAnswerPolling()
                    return
                }

                // No answer yet - exponential backoff
                retries++
                if (retries > this.pollingConfig.maxRetries) {
                    console.warn('Max retries reached for answer polling')
                    this.stopAnswerPolling()
                    return
                }

                interval = Math.min(
                    interval * this.pollingConfig.backoffMultiplier,
                    this.pollingConfig.maxInterval
                )

                // Add jitter to prevent thundering herd
                const finalInterval = this.pollingConfig.jitter
                    ? interval + Math.random() * 100
                    : interval

                this.answerPollingTimeout = setTimeout(poll, finalInterval)

            } catch (err) {
                // 404 is expected when answer isn't available yet
                if (err instanceof Error && !err.message?.includes('404')) {
                    console.error('Error polling for answer:', err)
                }

                // Retry with backoff
                const finalInterval = this.pollingConfig.jitter
                    ? interval + Math.random() * 100
                    : interval
                this.answerPollingTimeout = setTimeout(poll, finalInterval)
            }
        }

        poll() // Start immediately
    }

    /**
     * Stop polling for answer
     */
    private stopAnswerPolling(): void {
        if (this.answerPollingTimeout) {
            clearTimeout(this.answerPollingTimeout)
            this.answerPollingTimeout = null
        }
    }

    /**
     * Start polling for ICE candidates with adaptive backoff
     */
    private startIcePolling(): void {
        if (this.icePollingTimeout || !this.serviceUuid) {
            return
        }

        let interval = this.pollingConfig.initialInterval

        const poll = async () => {
            if (!this.serviceUuid) {
                this.stopIcePolling()
                return
            }

            try {
                const result = await this.rondevu
                    .getAPI()
                    .getServiceIceCandidates(this.serviceUuid, this.lastIceTimestamp, this.offerId || undefined)

                // Store offerId if we didn't have it yet
                if (!this.offerId) {
                    this.offerId = result.offerId
                }

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

                            this.lastIceTimestamp = item.createdAt
                        } catch (err) {
                            console.warn('Failed to process ICE candidate:', err)
                            this.lastIceTimestamp = item.createdAt
                        }
                    } else {
                        this.lastIceTimestamp = item.createdAt
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
        this.stopAnswerPolling()
        this.stopIcePolling()
        this.offerListeners = []
        this.answerListeners = []
        this.iceListeners = []
    }
}
