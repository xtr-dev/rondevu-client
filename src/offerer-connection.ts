/**
 * Offerer-side WebRTC connection with offer creation and answer processing
 */

import { RondevuConnection } from './connection.js'
import { ConnectionState } from './connection-events.js'
import { RondevuAPI } from './api.js'
import { ConnectionConfig } from './connection-config.js'

export interface OffererOptions {
    api: RondevuAPI
    serviceFqn: string
    offerId: string
    pc: RTCPeerConnection  // Accept already-created peer connection
    dc?: RTCDataChannel    // Accept already-created data channel (optional)
    config?: Partial<ConnectionConfig>
}

/**
 * Offerer connection - manages already-created offers and waits for answers
 */
export class OffererConnection extends RondevuConnection {
    private api: RondevuAPI
    private serviceFqn: string
    private offerId: string

    constructor(options: OffererOptions) {
        super(undefined, options.config)  // rtcConfig not needed, PC already created
        this.api = options.api
        this.serviceFqn = options.serviceFqn
        this.offerId = options.offerId

        // Use the already-created peer connection and data channel
        this.pc = options.pc
        this.dc = options.dc || null
    }

    /**
     * Initialize the connection - setup handlers for already-created offer
     */
    async initialize(): Promise<void> {
        this.debug('Initializing offerer connection')

        if (!this.pc) throw new Error('Peer connection not provided')

        // Setup peer connection event handlers
        this.pc.onicecandidate = (event) => this.handleIceCandidate(event)
        this.pc.oniceconnectionstatechange = () => this.handleIceConnectionStateChange()
        this.pc.onconnectionstatechange = () => this.handleConnectionStateChange()
        this.pc.onicegatheringstatechange = () => this.handleIceGatheringStateChange()

        // Setup data channel handlers if we have one
        if (this.dc) {
            this.setupDataChannelHandlers(this.dc)
        }

        // Start connection timeout
        this.startConnectionTimeout()

        // Transition to signaling state (offer already created and published)
        this.transitionTo(ConnectionState.SIGNALING, 'Offer published, waiting for answer')
    }

    /**
     * Process an answer from the answerer
     */
    async processAnswer(sdp: string, answererId: string): Promise<void> {
        if (!this.pc) {
            this.debug('Cannot process answer: peer connection not initialized')
            return
        }

        // Generate SDP fingerprint for deduplication
        const fingerprint = await this.hashSdp(sdp)

        // Check for duplicate answer
        if (this.answerProcessed) {
            if (this.answerSdpFingerprint === fingerprint) {
                this.debug('Duplicate answer detected (same fingerprint), skipping')
                this.emit('answer:duplicate', this.offerId)
                return
            } else {
                throw new Error('Received different answer after already processing one (protocol violation)')
            }
        }

        // Validate state
        if (this.state !== ConnectionState.SIGNALING && this.state !== ConnectionState.CHECKING) {
            this.debug(`Cannot process answer in state ${this.state}`)
            return
        }

        // Mark as processed BEFORE setRemoteDescription to prevent race conditions
        this.answerProcessed = true
        this.answerSdpFingerprint = fingerprint

        try {
            await this.pc.setRemoteDescription({
                type: 'answer',
                sdp,
            })

            this.debug(`Answer processed successfully from ${answererId}`)
            this.emit('answer:processed', this.offerId, answererId)
        } catch (error) {
            // Reset flags on error so we can try again
            this.answerProcessed = false
            this.answerSdpFingerprint = null
            this.debug('Failed to set remote description:', error)
            throw error
        }
    }

    /**
     * Generate a hash fingerprint of SDP for deduplication
     */
    private async hashSdp(sdp: string): Promise<string> {
        // Simple hash using built-in crypto if available
        if (typeof crypto !== 'undefined' && crypto.subtle) {
            const encoder = new TextEncoder()
            const data = encoder.encode(sdp)
            const hashBuffer = await crypto.subtle.digest('SHA-256', data)
            const hashArray = Array.from(new Uint8Array(hashBuffer))
            return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
        } else {
            // Fallback: use simple string hash
            let hash = 0
            for (let i = 0; i < sdp.length; i++) {
                const char = sdp.charCodeAt(i)
                hash = (hash << 5) - hash + char
                hash = hash & hash
            }
            return hash.toString(16)
        }
    }

    /**
     * Handle local ICE candidate generation
     */
    protected onLocalIceCandidate(candidate: RTCIceCandidate): void {
        this.debug('Generated local ICE candidate')

        // Send ICE candidate to server
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
     * Poll for remote ICE candidates
     */
    protected pollIceCandidates(): void {
        this.api
            .getOfferIceCandidates(this.serviceFqn, this.offerId, this.lastIcePollTime)
            .then((result) => {
                if (result.candidates.length > 0) {
                    this.debug(`Received ${result.candidates.length} remote ICE candidates`)

                    for (const iceCandidate of result.candidates) {
                        if (iceCandidate.candidate && this.pc) {
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
     *
     * Note: For offerer connections, reconnection is handled by the Rondevu instance
     * creating a new offer via fillOffers(). This method is a no-op.
     */
    protected attemptReconnect(): void {
        this.debug('Reconnection not applicable for offerer - new offer will be created by Rondevu instance')

        // Offerer reconnection is handled externally by Rondevu.fillOffers()
        // which creates entirely new offers. We don't reconnect the same offer.
        // Just emit failure and let the parent handle it.
        this.emit('reconnect:failed', new Error('Offerer reconnection handled by parent'))
    }

    /**
     * Get the offer ID
     */
    getOfferId(): string {
        return this.offerId
    }
}
