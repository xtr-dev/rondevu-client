/**
 * Answerer-side WebRTC connection with answer creation and offer processing
 */

import { RondevuConnection } from './connection.js'
import { ConnectionState } from './connection-events.js'
import { RondevuAPI } from './api.js'
import { ConnectionConfig } from './connection-config.js'

export interface AnswererOptions {
    api: RondevuAPI
    serviceFqn: string
    offerId: string
    offerSdp: string
    rtcConfig?: RTCConfiguration
    config?: Partial<ConnectionConfig>
}

/**
 * Answerer connection - processes offers and creates answers
 */
export class AnswererConnection extends RondevuConnection {
    private api: RondevuAPI
    private serviceFqn: string
    private offerId: string
    private offerSdp: string

    constructor(options: AnswererOptions) {
        super(options.rtcConfig, options.config)
        this.api = options.api
        this.serviceFqn = options.serviceFqn
        this.offerId = options.offerId
        this.offerSdp = options.offerSdp
    }

    /**
     * Initialize the connection by processing offer and creating answer
     */
    async initialize(): Promise<void> {
        this.debug('Initializing answerer connection')

        // Create peer connection
        this.createPeerConnection()
        if (!this.pc) throw new Error('Peer connection not created')

        // Setup ondatachannel handler BEFORE setting remote description
        // This is critical to avoid race conditions
        this.pc.ondatachannel = (event) => {
            this.debug('Received data channel')
            this.dc = event.channel
            this.setupDataChannelHandlers(this.dc)
        }

        // Start connection timeout
        this.startConnectionTimeout()

        // Set remote description (offer)
        await this.pc.setRemoteDescription({
            type: 'offer',
            sdp: this.offerSdp,
        })

        this.transitionTo(ConnectionState.SIGNALING, 'Offer received, creating answer')

        // Create and set local description (answer)
        const answer = await this.pc.createAnswer()
        await this.pc.setLocalDescription(answer)

        this.debug('Answer created, sending to server')

        // Send answer to server
        await this.api.answerOffer(this.serviceFqn, this.offerId, answer.sdp!)

        this.debug('Answer sent successfully')
    }

    /**
     * Handle local ICE candidate generation
     */
    protected onLocalIceCandidate(candidate: RTCIceCandidate): void {
        this.debug('Generated local ICE candidate')

        // For answerer, we add ICE candidates to the offer
        // The server will make them available for the offerer to poll
        this.api
            .addOfferIceCandidates(this.serviceFqn, this.offerId, [
                {
                    candidate: candidate.candidate,
                    sdpMLineIndex: candidate.sdpMLineIndex,
                    sdpMid: candidate.sdpMid,
                },
            ])
            .catch((error) => {
                this.debug('Failed to send ICE candidate:', error)
            })
    }

    /**
     * Poll for remote ICE candidates (from offerer)
     */
    protected pollIceCandidates(): void {
        this.api
            .getOfferIceCandidates(this.serviceFqn, this.offerId, this.lastIcePollTime)
            .then((result) => {
                if (result.candidates.length > 0) {
                    this.debug(`Received ${result.candidates.length} remote ICE candidates`)

                    for (const iceCandidate of result.candidates) {
                        // Only process ICE candidates from the offerer
                        if (iceCandidate.role === 'offerer' && iceCandidate.candidate && this.pc) {
                            const candidate = iceCandidate.candidate
                            this.pc
                                .addIceCandidate(new RTCIceCandidate(candidate))
                                .then(() => {
                                    this.emit('ice:candidate:remote', new RTCIceCandidate(candidate))
                                })
                                .catch((error) => {
                                    this.debug('Failed to add ICE candidate:', error)
                                })
                        }

                        // Update last poll time
                        if (iceCandidate.createdAt > this.lastIcePollTime) {
                            this.lastIcePollTime = iceCandidate.createdAt
                        }
                    }
                }
            })
            .catch((error) => {
                this.debug('Failed to poll ICE candidates:', error)
            })
    }

    /**
     * Attempt to reconnect
     */
    protected attemptReconnect(): void {
        this.debug('Attempting to reconnect')

        // For answerer, we need to fetch a new offer and create a new answer
        // Clean up old connection
        if (this.pc) {
            this.pc.close()
            this.pc = null
        }
        if (this.dc) {
            this.dc.close()
            this.dc = null
        }

        // Fetch new offer from service
        this.api
            .getService(this.serviceFqn)
            .then((service) => {
                if (!service || !service.offers || service.offers.length === 0) {
                    throw new Error('No offers available for reconnection')
                }

                // Pick a random offer
                const offer = service.offers[Math.floor(Math.random() * service.offers.length)]
                this.offerId = offer.offerId
                this.offerSdp = offer.sdp

                // Reinitialize with new offer
                return this.initialize()
            })
            .then(() => {
                this.emit('reconnect:success')
            })
            .catch((error) => {
                this.debug('Reconnection failed:', error)
                this.emit('reconnect:failed', error as Error)
                this.scheduleReconnect()
            })
    }

    /**
     * Get the offer ID we're answering
     */
    getOfferId(): string {
        return this.offerId
    }
}
