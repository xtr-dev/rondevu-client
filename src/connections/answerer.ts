/**
 * Answerer-side WebRTC connection with answer creation and offer processing
 */

import { RondevuConnection } from './base.js'
import { ConnectionState } from './events.js'
import { RondevuAPI, IceCandidate } from '../api/client.js'
import { ConnectionConfig } from './config.js'
import { WebRTCAdapter } from '../webrtc/adapter.js'

export interface AnswererOptions {
    api: RondevuAPI
    ownerPublicKey: string
    tags: string[]
    offerId: string
    offerSdp: string
    rtcConfig?: RTCConfiguration
    webrtcAdapter?: WebRTCAdapter // Optional, defaults to BrowserWebRTCAdapter
    config?: Partial<ConnectionConfig>
    matchedTags?: string[] // Tags that were used to discover this offer
    /** Callback invoked when RTCPeerConnection is created, before signaling starts */
    onPeerConnectionCreated?: (pc: RTCPeerConnection) => void
}

/**
 * Answerer connection - processes offers and creates answers
 */
export class AnswererConnection extends RondevuConnection {
    private api: RondevuAPI
    private ownerPublicKey: string
    private tags: string[]
    private offerId: string
    private offerSdp: string
    private matchedTags?: string[]
    private onPeerConnectionCreated?: (pc: RTCPeerConnection) => void

    constructor(options: AnswererOptions) {
        super(options.rtcConfig, options.config, options.webrtcAdapter)
        this.api = options.api
        this.ownerPublicKey = options.ownerPublicKey
        this.tags = options.tags
        this.offerId = options.offerId
        this.offerSdp = options.offerSdp
        this.matchedTags = options.matchedTags
        this.onPeerConnectionCreated = options.onPeerConnectionCreated
    }

    /**
     * Initialize the connection by processing offer and creating answer
     */
    async initialize(): Promise<void> {
        this.debug('Initializing answerer connection')

        // Create peer connection
        this.createPeerConnection()
        if (!this.pc) throw new Error('Peer connection not created')

        // Call the callback to allow creating negotiated data channels
        // This must happen BEFORE signaling starts so channels exist on both sides
        if (this.onPeerConnectionCreated) {
            this.onPeerConnectionCreated(this.pc)
        }

        // Setup ondatachannel handler BEFORE setting remote description
        // This is critical to avoid race conditions
        this.pc.ondatachannel = event => {
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

        // Send answer to server (including matched tags so offerer knows which tags we searched for)
        await this.api.answerOffer(this.offerId, answer.sdp!, this.matchedTags)

        // Note: ICE candidate polling is handled by PollingManager
        // Candidates are received via handleRemoteIceCandidates()

        this.debug('Answer sent successfully')
    }

    /**
     * Send buffered ICE candidates to the server in a single batch
     */
    protected sendBufferedIceCandidates(candidates: RTCIceCandidate[]): void {
        if (candidates.length === 0) return

        this.debug(`Sending ${candidates.length} ICE candidates in batch`)

        // For answerer, we add ICE candidates to the offer
        // The server will make them available for the offerer to poll
        const apiCandidates = candidates.map(c => ({
            candidate: c.candidate,
            sdpMLineIndex: c.sdpMLineIndex,
            sdpMid: c.sdpMid,
        }))

        this.api.addOfferIceCandidates(this.offerId, apiCandidates).catch(error => {
            this.debug('Failed to send ICE candidates:', error)
        })
    }

    /**
     * Get the API instance
     */
    protected getApi(): any {
        return this.api
    }

    /**
     * Get the owner public key (implements abstract method)
     */
    protected getOwnerPublicKey(): string {
        return this.ownerPublicKey
    }

    /**
     * Answerers accept ICE candidates from offerers only
     */
    protected getIceCandidateRole(): 'offerer' | null {
        return 'offerer'
    }

    /**
     * Attempt to reconnect to the same peer
     */
    protected attemptReconnect(): void {
        this.debug(`Attempting to reconnect to ${this.ownerPublicKey}`)

        // For answerer, we need to fetch a new offer from the same peer
        // Clean up old connection
        if (this.pc) {
            this.pc.close()
            this.pc = null
        }
        if (this.dc) {
            this.dc.close()
            this.dc = null
        }

        // Discover new offer using tags (use paginated mode to get array)
        this.api
            .discover({ tags: this.tags, limit: 100 })
            .then(result => {
                const response = result as import('../api/client.js').DiscoverResponse
                if (!response || !response.offers || response.offers.length === 0) {
                    throw new Error('No offers available for reconnection')
                }

                // Filter for offers from the same peer
                const peerOffers = response.offers.filter(o => o.publicKey === this.ownerPublicKey)
                if (peerOffers.length === 0) {
                    throw new Error(`No offers available from ${this.ownerPublicKey}`)
                }

                // Pick a random offer from the same peer
                const offer = peerOffers[Math.floor(Math.random() * peerOffers.length)]
                this.offerId = offer.offerId
                this.offerSdp = offer.sdp

                this.debug(`Found new offer ${offer.offerId} from ${this.ownerPublicKey}`)

                // Reinitialize with new offer
                return this.initialize()
            })
            .then(() => {
                this.emit('reconnect:success')
            })
            .catch(error => {
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

    /**
     * Handle remote ICE candidates received from polling
     * Called by Rondevu when poll:ice event is received
     */
    handleRemoteIceCandidates(candidates: IceCandidate[]): void {
        if (!this.pc) {
            this.debug('Cannot add ICE candidates: peer connection not initialized')
            return
        }

        for (const iceCandidate of candidates) {
            // Answerer only accepts offerer's candidates
            if (iceCandidate.role !== 'offerer') {
                continue
            }

            if (iceCandidate.candidate) {
                const rtcCandidate = this.webrtcAdapter.createIceCandidate(iceCandidate.candidate)
                this.pc
                    .addIceCandidate(rtcCandidate)
                    .then(() => {
                        this.emit('ice:candidate:remote', rtcCandidate)
                    })
                    .catch(error => {
                        this.debug('Failed to add ICE candidate:', error)
                    })
            }
        }
    }
}
