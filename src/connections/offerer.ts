/**
 * Offerer-side WebRTC connection with offer creation and answer processing
 */

import { RondevuConnection } from './base.js'
import { ConnectionState } from './events.js'
import { RondevuAPI, IceCandidate } from '../api/client.js'
import { ConnectionConfig } from './config.js'
import { AsyncLock } from '../utils/async-lock.js'
import { WebRTCAdapter } from '../webrtc/adapter.js'

export interface OffererOptions {
    api: RondevuAPI
    ownerPublicKey: string
    offerId: string
    pc: RTCPeerConnection // Accept already-created peer connection
    dc?: RTCDataChannel // Accept already-created data channel (optional)
    webrtcAdapter?: WebRTCAdapter // Optional, defaults to BrowserWebRTCAdapter
    config?: Partial<ConnectionConfig>
}

/**
 * Offerer connection - manages already-created offers and waits for answers
 */
export class OffererConnection extends RondevuConnection {
    private api: RondevuAPI
    private ownerPublicKey: string
    private offerId: string
    private _peerPublicKey: string | null = null

    // Rotation tracking
    private rotationLock = new AsyncLock()
    private rotating = false
    private rotationAttempts = 0
    private static readonly MAX_ROTATION_ATTEMPTS = 5

    // ICE candidate buffering (for candidates received before answer is processed)
    private pendingIceCandidates: IceCandidate[] = []

    constructor(options: OffererOptions) {
        // Force reconnectEnabled: false for offerer connections (offers are ephemeral)
        super(undefined, { ...options.config, reconnectEnabled: false }, options.webrtcAdapter)
        this.api = options.api
        this.ownerPublicKey = options.ownerPublicKey
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
        this.pc.onicecandidate = event => this.handleIceCandidate(event)
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
    async processAnswer(sdp: string, answererPublicKey: string): Promise<void> {
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
                throw new Error(
                    'Received different answer after already processing one (protocol violation)'
                )
            }
        }

        // Validate state - allow SIGNALING, CHECKING, and FAILED (for late-arriving answers before rotation)
        if (
            this.state !== ConnectionState.SIGNALING &&
            this.state !== ConnectionState.CHECKING &&
            this.state !== ConnectionState.FAILED
        ) {
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

            // Store the peer public key
            this._peerPublicKey = answererPublicKey

            this.debug(`Answer processed successfully from ${answererPublicKey}`)
            this.emit('answer:processed', this.offerId, answererPublicKey)

            // Apply any buffered ICE candidates that arrived before the answer
            if (this.pendingIceCandidates.length > 0) {
                this.debug(`Applying ${this.pendingIceCandidates.length} buffered ICE candidates`)
                const buffered = this.pendingIceCandidates
                this.pendingIceCandidates = []
                this.applyIceCandidates(buffered)
            }
        } catch (error) {
            // Reset flags on error so we can try again
            this.answerProcessed = false
            this.answerSdpFingerprint = null
            this.debug('Failed to set remote description:', error)
            throw error
        }
    }

    /**
     * Rebind this connection to a new offer (when previous offer failed)
     * Keeps the same connection object alive but with new underlying WebRTC
     */
    async rebindToOffer(
        newOfferId: string,
        newPc: RTCPeerConnection,
        newDc?: RTCDataChannel
    ): Promise<void> {
        return this.rotationLock.run(async () => {
            if (this.rotating) {
                throw new Error('Rotation already in progress')
            }
            this.rotating = true

            try {
                this.rotationAttempts++
                if (this.rotationAttempts > OffererConnection.MAX_ROTATION_ATTEMPTS) {
                    throw new Error('Max rotation attempts exceeded')
                }

                this.debug(`Rebinding connection from ${this.offerId} to ${newOfferId}`)

                // 1. Clean up old peer connection
                if (this.pc) {
                    this.pc.close()
                }
                if (this.dc && this.dc !== newDc) {
                    this.dc.close()
                }

                // 2. Update to new offer
                this.offerId = newOfferId
                this.pc = newPc
                this.dc = newDc || null

                // 3. Reset answer processing flags, peer public key, and pending candidates
                this.answerProcessed = false
                this.answerSdpFingerprint = null
                this._peerPublicKey = null
                this.pendingIceCandidates = []

                // 4. Setup event handlers for new peer connection
                this.pc.onicecandidate = event => this.handleIceCandidate(event)
                this.pc.oniceconnectionstatechange = () => this.handleIceConnectionStateChange()
                this.pc.onconnectionstatechange = () => this.handleConnectionStateChange()
                this.pc.onicegatheringstatechange = () => this.handleIceGatheringStateChange()

                // 5. Setup data channel handlers if we have one
                if (this.dc) {
                    this.setupDataChannelHandlers(this.dc)
                }

                // 6. Restart connection timeout
                this.startConnectionTimeout()

                // 7. Transition to SIGNALING state (waiting for answer)
                this.transitionTo(ConnectionState.SIGNALING, 'Offer rotated, waiting for answer')

                // Note: Message buffer is NOT cleared - it persists!
                this.debug(
                    `Rebind complete. Buffer has ${this.messageBuffer?.size() ?? 0} messages`
                )
            } finally {
                this.rotating = false
            }
        })
    }

    /**
     * Check if connection is currently rotating
     */
    isRotating(): boolean {
        return this.rotating
    }

    /**
     * Override onConnected to reset rotation attempts
     */
    protected onConnected(): void {
        super.onConnected()
        this.rotationAttempts = 0
        this.debug('Connection established, rotation attempts reset')
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
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
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
            .addOfferIceCandidates(this.offerId, [
                {
                    candidate: candidate.candidate,
                    sdpMLineIndex: candidate.sdpMLineIndex,
                    sdpMid: candidate.sdpMid,
                },
            ])
            .catch(error => {
                this.debug('Failed to send ICE candidate:', error)
            })
    }

    /**
     * Get the API instance
     */
    protected getApi(): any {
        return this.api
    }

    /**
     * Get the owner public key
     */
    protected getOwnerPublicKey(): string {
        return this.ownerPublicKey
    }

    /**
     * Offerers accept all ICE candidates (no filtering)
     */
    protected getIceCandidateRole(): 'offerer' | null {
        return null
    }

    /**
     * Attempt to reconnect (required by abstract base class)
     *
     * For OffererConnection, traditional reconnection is NOT used.
     * Instead, the OfferPool handles failures via offer rotation:
     *
     * 1. When this connection fails, the 'failed' event is emitted
     * 2. OfferPool detects the failure and calls createNewOfferForRotation()
     * 3. The new offer is published to the server
     * 4. This connection is rebound via rebindToOffer()
     *
     * This approach ensures the answerer always gets a fresh offer
     * rather than trying to reconnect to a stale one.
     *
     * @see OfferPool.createNewOfferForRotation() - creates replacement offer
     * @see OffererConnection.rebindToOffer() - rebinds connection to new offer
     */
    protected attemptReconnect(): void {
        this.debug('Reconnection delegated to OfferPool rotation mechanism')
        this.emit('reconnect:failed', new Error('Offerer uses rotation, not reconnection'))
    }

    /**
     * Get the offer ID
     */
    getOfferId(): string {
        return this.offerId
    }

    /**
     * Get the peer public key (who answered this offer)
     * Returns null if no answer has been processed yet
     */
    get peerPublicKey(): string | null {
        return this._peerPublicKey
    }

    /**
     * Handle remote ICE candidates received from polling
     * Called by OfferPool when poll:ice event is received
     */
    handleRemoteIceCandidates(candidates: IceCandidate[]): void {
        if (!this.pc) {
            this.debug('Cannot add ICE candidates: peer connection not initialized')
            return
        }

        // If answer hasn't been processed yet, buffer the candidates
        if (!this.answerProcessed) {
            this.debug(`Buffering ${candidates.length} ICE candidates (waiting for answer)`)
            this.pendingIceCandidates.push(...candidates)
            return
        }

        // Answer is processed, apply candidates immediately
        this.applyIceCandidates(candidates)
    }

    /**
     * Apply ICE candidates to the peer connection
     */
    private applyIceCandidates(candidates: IceCandidate[]): void {
        if (!this.pc) return

        for (const iceCandidate of candidates) {
            // Offerer accepts answerer's candidates (no role filtering needed here
            // since OfferPool already filters by offerId)
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
