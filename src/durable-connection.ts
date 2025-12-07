import {
    ConnectionEvents,
    ConnectionInterface,
    ConnectionStates,
    isConnectionState,
    Message,
    QueueMessageOptions,
    Signaler,
} from './types.js'
import { EventBus } from './event-bus.js'
import { createBin } from './bin.js'
import { WebRTCContext } from './webrtc-context'

export type WebRTCRondevuConnectionOptions = {
    offer?: RTCSessionDescriptionInit | null
    context: WebRTCContext
    signaler: Signaler
}

/**
 * WebRTCRondevuConnection - WebRTC peer connection wrapper with Rondevu signaling
 *
 * Manages a WebRTC peer connection lifecycle including:
 * - Automatic offer/answer creation based on role
 * - ICE candidate exchange via Rondevu signaling server
 * - Connection state management with type-safe events
 * - Data channel creation and message handling
 *
 * The connection automatically determines its role (offerer or answerer) based on whether
 * an offer is provided in the constructor. The offerer creates the data channel, while
 * the answerer receives it via the 'datachannel' event.
 *
 * @example
 * ```typescript
 * // Offerer side (creates offer)
 * const connection = new WebRTCRondevuConnection(
 *   'conn-123',
 *   'peer-username',
 *   'chat.service@1.0.0'
 * );
 *
 * await connection.ready; // Wait for local offer
 * const sdp = connection.connection.localDescription!.sdp!;
 * // Send sdp to signaling server...
 *
 * // Answerer side (receives offer)
 * const connection = new WebRTCRondevuConnection(
 *   'conn-123',
 *   'peer-username',
 *   'chat.service@1.0.0',
 *   { type: 'offer', sdp: remoteOfferSdp }
 * );
 *
 * await connection.ready; // Wait for local answer
 * const answerSdp = connection.connection.localDescription!.sdp!;
 * // Send answer to signaling server...
 *
 * // Both sides: Set up signaler and listen for state changes
 * connection.setSignaler(signaler);
 * connection.events.on('state-change', (state) => {
 *   console.log('Connection state:', state);
 * });
 * ```
 */
export class RTCDurableConnection implements ConnectionInterface {
    private readonly side: 'offer' | 'answer'
    public readonly expiresAt: number = 0
    public readonly lastActive: number = 0
    public readonly events: EventBus<ConnectionEvents> = new EventBus()
    public readonly ready: Promise<void>
    private iceBin = createBin()
    private context: WebRTCContext
    private readonly signaler: Signaler
    private _conn: RTCPeerConnection | null = null
    private _state: ConnectionInterface['state'] = 'disconnected'
    private _dataChannel: RTCDataChannel | null = null
    private messageQueue: Array<{
        message: Message
        options: QueueMessageOptions
        timestamp: number
    }> = []

    constructor({ context, offer, signaler }: WebRTCRondevuConnectionOptions) {
        this.context = context
        this.signaler = signaler
        this._conn = context.createPeerConnection()
        this.side = offer ? 'answer' : 'offer'

        // setup data channel
        if (offer) {
            this._conn.addEventListener('datachannel', e => {
                this._dataChannel = e.channel
                this.setupDataChannelListeners(this._dataChannel)
            })
        } else {
            this._dataChannel = this._conn.createDataChannel('vu.ronde.protocol')
            this.setupDataChannelListeners(this._dataChannel)
        }

        // setup description exchange
        this.ready = offer
            ? this._conn
                  .setRemoteDescription(offer)
                  .then(() => this._conn?.createAnswer())
                  .then(async answer => {
                      if (!answer || !this._conn) throw new Error('Connection disappeared')
                      await this._conn.setLocalDescription(answer)
                      return await signaler.setAnswer(answer)
                  })
            : this._conn.createOffer().then(async offer => {
                  if (!this._conn) throw new Error('Connection disappeared')
                  await this._conn.setLocalDescription(offer)
                  return await signaler.setOffer(offer)
              })

        // propagate connection state changes
        this._conn.addEventListener('connectionstatechange', () => {
            console.log(this.side, 'connection state changed: ', this._conn!.connectionState)
            const state = isConnectionState(this._conn!.connectionState)
                ? this._conn!.connectionState
                : 'disconnected'
            this.setState(state)
        })

        this._conn.addEventListener('iceconnectionstatechange', () => {
            console.log(this.side, 'ice connection state changed: ', this._conn!.iceConnectionState)
        })

        // start ICE candidate exchange when gathering begins
        this._conn.addEventListener('icegatheringstatechange', () => {
            if (this._conn!.iceGatheringState === 'gathering') {
                this.startIce()
            } else if (this._conn!.iceGatheringState === 'complete') {
                this.stopIce()
            }
        })
    }

    /**
     * Getter method for retrieving the current connection.
     *
     * @return {RTCPeerConnection|null} The current connection instance.
     */
    public get connection(): RTCPeerConnection | null {
        return this._conn
    }

    /**
     * Update connection state and emit state-change event
     */
    private setState(state: ConnectionInterface['state']) {
        this._state = state
        this.events.emit('state-change', state)
    }

    /**
     * Start ICE candidate exchange when gathering begins
     */
    private startIce() {
        const listener = ({ candidate }: { candidate: RTCIceCandidate | null }) => {
            if (candidate) this.signaler.addIceCandidate(candidate)
        }
        if (!this._conn) throw new Error('Connection disappeared')
        this._conn.addEventListener('icecandidate', listener)
        this.iceBin(
            this.signaler.addListener((candidate: RTCIceCandidate) =>
                this._conn?.addIceCandidate(candidate)
            ),
            () => this._conn?.removeEventListener('icecandidate', listener)
        )
    }

    /**
     * Stop ICE candidate exchange when gathering completes
     */
    private stopIce() {
        this.iceBin.clean()
    }

    /**
     * Disconnects the current connection and cleans up resources.
     * Closes the active connection if it exists, resets the connection instance to null,
     * stops the ICE process, and updates the state to 'disconnected'.
     *
     * @return {void} No return value.
     */
    disconnect(): void {
        this._conn?.close()
        this._conn = null
        this.stopIce()
        this.setState('disconnected')
    }

    /**
     * Current connection state
     */
    get state() {
        return this._state
    }

    /**
     * Setup data channel event listeners
     */
    private setupDataChannelListeners(channel: RTCDataChannel): void {
        channel.addEventListener('message', e => {
            this.events.emit('message', e.data)
        })

        channel.addEventListener('open', () => {
            // Channel opened - flush queued messages
            this.flushQueue().catch(err => {
                console.error('Failed to flush message queue:', err)
            })
        })

        channel.addEventListener('error', err => {
            console.error('Data channel error:', err)
        })

        channel.addEventListener('close', () => {
            console.log('Data channel closed')
        })
    }

    /**
     * Flush the message queue
     */
    private async flushQueue(): Promise<void> {
        while (this.messageQueue.length > 0 && this._state === 'connected') {
            const item = this.messageQueue.shift()!

            // Check expiration
            if (item.options.expiresAt && Date.now() > item.options.expiresAt) {
                continue
            }

            const success = await this.sendMessage(item.message)
            if (!success) {
                // Re-queue on failure
                this.messageQueue.unshift(item)
                break
            }
        }
    }

    /**
     * Queue a message for sending when connection is established
     *
     * @param message - Message to queue (string or ArrayBuffer)
     * @param options - Queue options (e.g., expiration time)
     */
    async queueMessage(message: Message, options: QueueMessageOptions = {}): Promise<void> {
        this.messageQueue.push({
            message,
            options,
            timestamp: Date.now()
        })

        // Try immediate send if connected
        if (this._state === 'connected') {
            await this.flushQueue()
        }
    }

    /**
     * Send a message immediately
     *
     * @param message - Message to send (string or ArrayBuffer)
     * @returns Promise resolving to true if sent successfully
     */
    async sendMessage(message: Message): Promise<boolean> {
        if (this._state !== 'connected' || !this._dataChannel) {
            return false
        }

        if (this._dataChannel.readyState !== 'open') {
            return false
        }

        try {
            // TypeScript has trouble with the union type, so we cast to any
            // Both string and ArrayBuffer are valid for RTCDataChannel.send()
            this._dataChannel.send(message as any)
            return true
        } catch (err) {
            console.error('Send failed:', err)
            return false
        }
    }
}
