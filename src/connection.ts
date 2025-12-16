/**
 * Base connection class with state machine, reconnection, and message buffering
 */

import { EventEmitter } from 'eventemitter3'
import { ConnectionConfig, mergeConnectionConfig } from './connection-config.js'
import {
    ConnectionState,
    ConnectionEventMap,
    ConnectionEventName,
    ConnectionEventArgs,
    BufferedMessage,
} from './connection-events.js'
import { ExponentialBackoff } from './exponential-backoff.js'
import { MessageBuffer } from './message-buffer.js'

/**
 * Abstract base class for WebRTC connections with durability features
 */
export abstract class RondevuConnection extends EventEmitter<ConnectionEventMap> {
    protected pc: RTCPeerConnection | null = null
    protected dc: RTCDataChannel | null = null
    protected state: ConnectionState = ConnectionState.INITIALIZING
    protected config: ConnectionConfig

    // Message buffering
    protected messageBuffer: MessageBuffer | null = null

    // Reconnection
    protected backoff: ExponentialBackoff | null = null
    protected reconnectTimeout: ReturnType<typeof setTimeout> | null = null
    protected reconnectAttempts = 0

    // Timeouts
    protected connectionTimeout: ReturnType<typeof setTimeout> | null = null
    protected iceGatheringTimeout: ReturnType<typeof setTimeout> | null = null

    // ICE polling
    protected icePollingInterval: ReturnType<typeof setInterval> | null = null
    protected lastIcePollTime = 0

    // Answer fingerprinting (for offerer)
    protected answerProcessed = false
    protected answerSdpFingerprint: string | null = null

    constructor(
        protected rtcConfig?: RTCConfiguration,
        userConfig?: Partial<ConnectionConfig>
    ) {
        super()
        this.config = mergeConnectionConfig(userConfig)

        // Initialize message buffer if enabled
        if (this.config.bufferEnabled) {
            this.messageBuffer = new MessageBuffer({
                maxSize: this.config.maxBufferSize,
                maxAge: this.config.maxBufferAge,
            })
        }

        // Initialize backoff if reconnection enabled
        if (this.config.reconnectEnabled) {
            this.backoff = new ExponentialBackoff({
                base: this.config.reconnectBackoffBase,
                max: this.config.reconnectBackoffMax,
                jitter: this.config.reconnectJitter,
            })
        }
    }

    /**
     * Transition to a new state and emit events
     */
    protected transitionTo(newState: ConnectionState, reason?: string): void {
        if (this.state === newState) return

        const oldState = this.state
        this.state = newState

        this.debug(`State transition: ${oldState} → ${newState}${reason ? ` (${reason})` : ''}`)

        this.emit('state:changed', { oldState, newState, reason })

        // Emit specific lifecycle events
        switch (newState) {
            case ConnectionState.CONNECTING:
                this.emit('connecting')
                break
            case ConnectionState.CONNECTED:
                this.emit('connected')
                break
            case ConnectionState.DISCONNECTED:
                this.emit('disconnected', reason)
                break
            case ConnectionState.FAILED:
                this.emit('failed', new Error(reason || 'Connection failed'))
                break
            case ConnectionState.CLOSED:
                this.emit('closed', reason)
                break
        }
    }

    /**
     * Create and configure RTCPeerConnection
     */
    protected createPeerConnection(): RTCPeerConnection {
        this.pc = new RTCPeerConnection(this.rtcConfig)

        // Setup event handlers BEFORE any signaling
        this.pc.onicecandidate = (event) => this.handleIceCandidate(event)
        this.pc.oniceconnectionstatechange = () => this.handleIceConnectionStateChange()
        this.pc.onconnectionstatechange = () => this.handleConnectionStateChange()
        this.pc.onicegatheringstatechange = () => this.handleIceGatheringStateChange()

        return this.pc
    }

    /**
     * Setup data channel event handlers
     */
    protected setupDataChannelHandlers(dc: RTCDataChannel): void {
        dc.onopen = () => this.handleDataChannelOpen()
        dc.onclose = () => this.handleDataChannelClose()
        dc.onerror = (error) => this.handleDataChannelError(error)
        dc.onmessage = (event) => this.handleMessage(event)
    }

    /**
     * Handle local ICE candidate generation
     */
    protected handleIceCandidate(event: RTCPeerConnectionIceEvent): void {
        this.emit('ice:candidate:local', event.candidate)
        if (event.candidate) {
            this.onLocalIceCandidate(event.candidate)
        }
    }

    /**
     * Handle ICE connection state changes (primary state driver)
     */
    protected handleIceConnectionStateChange(): void {
        if (!this.pc) return

        const iceState = this.pc.iceConnectionState
        this.emit('ice:connection:state', iceState)
        this.debug(`ICE connection state: ${iceState}`)

        switch (iceState) {
            case 'checking':
                if (this.state === ConnectionState.SIGNALING) {
                    this.transitionTo(ConnectionState.CHECKING, 'ICE checking started')
                }
                this.startIcePolling()
                break

            case 'connected':
            case 'completed':
                this.stopIcePolling()
                // Wait for data channel to open before transitioning to CONNECTED
                if (this.dc?.readyState === 'open') {
                    this.transitionTo(ConnectionState.CONNECTED, 'ICE connected and data channel open')
                    this.onConnected()
                }
                break

            case 'disconnected':
                if (this.state === ConnectionState.CONNECTED) {
                    this.transitionTo(ConnectionState.DISCONNECTED, 'ICE disconnected')
                    this.scheduleReconnect()
                }
                break

            case 'failed':
                this.stopIcePolling()
                this.transitionTo(ConnectionState.FAILED, 'ICE connection failed')
                this.scheduleReconnect()
                break

            case 'closed':
                this.stopIcePolling()
                this.transitionTo(ConnectionState.CLOSED, 'ICE connection closed')
                break
        }
    }

    /**
     * Handle connection state changes (backup validation)
     */
    protected handleConnectionStateChange(): void {
        if (!this.pc) return

        const connState = this.pc.connectionState
        this.emit('connection:state', connState)
        this.debug(`Connection state: ${connState}`)

        // Connection state provides backup validation
        if (connState === 'failed' && this.state !== ConnectionState.FAILED) {
            this.transitionTo(ConnectionState.FAILED, 'PeerConnection failed')
            this.scheduleReconnect()
        } else if (connState === 'closed' && this.state !== ConnectionState.CLOSED) {
            this.transitionTo(ConnectionState.CLOSED, 'PeerConnection closed')
        }
    }

    /**
     * Handle ICE gathering state changes
     */
    protected handleIceGatheringStateChange(): void {
        if (!this.pc) return

        const gatheringState = this.pc.iceGatheringState
        this.emit('ice:gathering:state', gatheringState)
        this.debug(`ICE gathering state: ${gatheringState}`)

        if (gatheringState === 'gathering' && this.state === ConnectionState.INITIALIZING) {
            this.transitionTo(ConnectionState.GATHERING, 'ICE gathering started')
            this.startIceGatheringTimeout()
        } else if (gatheringState === 'complete') {
            this.clearIceGatheringTimeout()
        }
    }

    /**
     * Handle data channel open event
     */
    protected handleDataChannelOpen(): void {
        this.debug('Data channel opened')
        this.emit('datachannel:open')

        // Only transition to CONNECTED if ICE is also connected
        if (this.pc && (this.pc.iceConnectionState === 'connected' || this.pc.iceConnectionState === 'completed')) {
            this.transitionTo(ConnectionState.CONNECTED, 'Data channel opened and ICE connected')
            this.onConnected()
        }
    }

    /**
     * Handle data channel close event
     */
    protected handleDataChannelClose(): void {
        this.debug('Data channel closed')
        this.emit('datachannel:close')

        if (this.state === ConnectionState.CONNECTED) {
            this.transitionTo(ConnectionState.DISCONNECTED, 'Data channel closed')
            this.scheduleReconnect()
        }
    }

    /**
     * Handle data channel error event
     */
    protected handleDataChannelError(error: Event): void {
        this.debug('Data channel error:', error)
        this.emit('datachannel:error', error)
    }

    /**
     * Handle incoming message
     */
    protected handleMessage(event: MessageEvent): void {
        this.emit('message', event.data)
    }

    /**
     * Called when connection is successfully established
     */
    protected onConnected(): void {
        this.clearConnectionTimeout()
        this.reconnectAttempts = 0
        this.backoff?.reset()

        // Replay buffered messages
        if (this.messageBuffer && !this.messageBuffer.isEmpty()) {
            const messages = this.messageBuffer.getValid()
            this.debug(`Replaying ${messages.length} buffered messages`)

            for (const message of messages) {
                try {
                    this.sendDirect(message.data)
                    this.emit('message:replayed', message)
                    this.messageBuffer.remove(message.id)
                } catch (error) {
                    this.debug('Failed to replay message:', error)
                }
            }

            // Remove expired messages
            const expired = this.messageBuffer.getExpired()
            for (const msg of expired) {
                this.emit('message:buffer:expired', msg)
            }
        }
    }

    /**
     * Start ICE candidate polling
     */
    protected startIcePolling(): void {
        if (this.icePollingInterval) return

        this.debug('Starting ICE polling')
        this.emit('ice:polling:started')

        this.lastIcePollTime = Date.now()

        this.icePollingInterval = setInterval(() => {
            const elapsed = Date.now() - this.lastIcePollTime
            if (elapsed > this.config.icePollingTimeout) {
                this.debug('ICE polling timeout')
                this.stopIcePolling()
                return
            }

            this.pollIceCandidates()
        }, this.config.icePollingInterval)
    }

    /**
     * Stop ICE candidate polling
     */
    protected stopIcePolling(): void {
        if (!this.icePollingInterval) return

        this.debug('Stopping ICE polling')
        clearInterval(this.icePollingInterval)
        this.icePollingInterval = null
        this.emit('ice:polling:stopped')
    }

    /**
     * Get the API instance - subclasses must provide
     */
    protected abstract getApi(): any

    /**
     * Get the service FQN - subclasses must provide
     */
    protected abstract getServiceFqn(): string

    /**
     * Get the offer ID - subclasses must provide
     */
    protected abstract getOfferId(): string

    /**
     * Get the ICE candidate role this connection should accept.
     * Returns null for no filtering (offerer), or specific role (answerer accepts 'offerer').
     */
    protected abstract getIceCandidateRole(): 'offerer' | null

    /**
     * Poll for remote ICE candidates (consolidated implementation)
     * Subclasses implement getIceCandidateRole() to specify filtering
     */
    protected pollIceCandidates(): void {
        const acceptRole = this.getIceCandidateRole()
        const api = this.getApi()
        const serviceFqn = this.getServiceFqn()
        const offerId = this.getOfferId()

        api
            .getOfferIceCandidates(serviceFqn, offerId, this.lastIcePollTime)
            .then((result: any) => {
                if (result.candidates.length > 0) {
                    this.debug(`Received ${result.candidates.length} remote ICE candidates`)

                    for (const iceCandidate of result.candidates) {
                        // Filter by role if specified (answerer only filters for 'offerer')
                        if (acceptRole !== null && iceCandidate.role !== acceptRole) {
                            continue
                        }

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
            .catch((error: any) => {
                this.debug('Failed to poll ICE candidates:', error)
            })
    }

    /**
     * Start connection timeout
     */
    protected startConnectionTimeout(): void {
        this.clearConnectionTimeout()

        this.connectionTimeout = setTimeout(() => {
            if (this.state !== ConnectionState.CONNECTED) {
                this.debug('Connection timeout')
                this.emit('connection:timeout')
                this.transitionTo(ConnectionState.FAILED, 'Connection timeout')
                this.scheduleReconnect()
            }
        }, this.config.connectionTimeout)
    }

    /**
     * Clear connection timeout
     */
    protected clearConnectionTimeout(): void {
        if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout)
            this.connectionTimeout = null
        }
    }

    /**
     * Start ICE gathering timeout
     */
    protected startIceGatheringTimeout(): void {
        this.clearIceGatheringTimeout()

        this.iceGatheringTimeout = setTimeout(() => {
            if (this.pc && this.pc.iceGatheringState !== 'complete') {
                this.debug('ICE gathering timeout')
                this.emit('ice:gathering:timeout')
            }
        }, this.config.iceGatheringTimeout)
    }

    /**
     * Clear ICE gathering timeout
     */
    protected clearIceGatheringTimeout(): void {
        if (this.iceGatheringTimeout) {
            clearTimeout(this.iceGatheringTimeout)
            this.iceGatheringTimeout = null
        }
    }

    /**
     * Schedule reconnection attempt
     */
    protected scheduleReconnect(): void {
        if (!this.config.reconnectEnabled || !this.backoff) return

        // Check if we've exceeded max attempts
        if (this.config.maxReconnectAttempts > 0 && this.reconnectAttempts >= this.config.maxReconnectAttempts) {
            this.debug('Max reconnection attempts reached')
            this.emit('reconnect:exhausted', this.reconnectAttempts)
            return
        }

        const delay = this.backoff.next()
        this.reconnectAttempts++

        this.debug(`Scheduling reconnection attempt ${this.reconnectAttempts} in ${delay}ms`)

        this.emit('reconnect:scheduled', {
            attempt: this.reconnectAttempts,
            delay,
            maxAttempts: this.config.maxReconnectAttempts,
        })

        this.transitionTo(ConnectionState.RECONNECTING, `Attempt ${this.reconnectAttempts}`)

        this.reconnectTimeout = setTimeout(() => {
            this.emit('reconnect:attempting', this.reconnectAttempts)
            this.attemptReconnect()
        }, delay)
    }

    /**
     * Cancel scheduled reconnection
     */
    protected cancelReconnect(): void {
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout)
            this.reconnectTimeout = null
        }
    }

    /**
     * Send a message directly (bypasses buffer)
     */
    protected sendDirect(data: string | ArrayBuffer | Blob): void {
        if (!this.dc || this.dc.readyState !== 'open') {
            throw new Error('Data channel is not open')
        }

        // Handle different data types explicitly
        this.dc.send(data as any)
    }

    /**
     * Send a message with automatic buffering
     */
    send(data: string | ArrayBuffer | Blob): void {
        if (this.state === ConnectionState.CONNECTED && this.dc?.readyState === 'open') {
            // Send directly
            try {
                this.sendDirect(data)
                this.emit('message:sent', data, false)
            } catch (error) {
                this.debug('Failed to send message:', error)
                this.bufferMessage(data)
            }
        } else {
            // Buffer for later
            this.bufferMessage(data)
        }
    }

    /**
     * Buffer a message for later delivery
     */
    protected bufferMessage(data: string | ArrayBuffer | Blob): void {
        if (!this.messageBuffer) {
            this.debug('Message buffering disabled, message dropped')
            return
        }

        if (this.messageBuffer.isFull()) {
            const oldest = this.messageBuffer.getAll()[0]
            this.emit('message:buffer:overflow', oldest)
        }

        const message = this.messageBuffer.add(data)
        this.emit('message:buffered', data)
        this.emit('message:sent', data, true)
        this.debug(`Message buffered (${this.messageBuffer.size()}/${this.config.maxBufferSize})`)
    }

    /**
     * Get current connection state
     */
    getState(): ConnectionState {
        return this.state
    }

    /**
     * Get the data channel
     */
    getDataChannel(): RTCDataChannel | null {
        return this.dc
    }

    /**
     * Get the peer connection
     */
    getPeerConnection(): RTCPeerConnection | null {
        return this.pc
    }

    /**
     * Close the connection
     */
    close(): void {
        this.debug('Closing connection')
        this.transitionTo(ConnectionState.CLOSED, 'User requested close')
        this.cleanup()
    }

    /**
     * Complete cleanup of all resources
     */
    protected cleanup(): void {
        this.debug('Cleaning up connection')
        this.emit('cleanup:started')

        // Clear all timeouts
        this.clearConnectionTimeout()
        this.clearIceGatheringTimeout()
        this.cancelReconnect()

        // Stop ICE polling
        this.stopIcePolling()

        // Close data channel
        if (this.dc) {
            this.dc.onopen = null
            this.dc.onclose = null
            this.dc.onerror = null
            this.dc.onmessage = null

            if (this.dc.readyState !== 'closed') {
                this.dc.close()
            }
            this.dc = null
        }

        // Close peer connection
        if (this.pc) {
            this.pc.onicecandidate = null
            this.pc.oniceconnectionstatechange = null
            this.pc.onconnectionstatechange = null
            this.pc.onicegatheringstatechange = null

            if (this.pc.connectionState !== 'closed') {
                this.pc.close()
            }
            this.pc = null
        }

        // Clear message buffer if not preserving
        if (this.messageBuffer && !this.config.preserveBufferOnClose) {
            this.messageBuffer.clear()
        }

        this.emit('cleanup:complete')
    }

    /**
     * Debug logging helper
     */
    protected debug(...args: any[]): void {
        if (this.config.debug) {
            console.log('[RondevuConnection]', ...args)
        }
    }

    // Abstract methods to be implemented by subclasses
    protected abstract onLocalIceCandidate(candidate: RTCIceCandidate): void
    protected abstract attemptReconnect(): void
}
