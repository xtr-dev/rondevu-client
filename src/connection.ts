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
    id: string
    service: string
    offer: RTCSessionDescriptionInit | null
    context: WebRTCContext
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
export class WebRTCRondevuConnection implements ConnectionInterface {
    private readonly side: 'offer' | 'answer'
    public readonly expiresAt: number = 0
    public readonly lastActive: number = 0
    public readonly events: EventBus<ConnectionEvents> = new EventBus()
    public readonly ready: Promise<void>
    private iceBin = createBin()
    private ctx: WebRTCContext
    public id: string
    public service: string
    private _conn: RTCPeerConnection | null = null
    private _state: ConnectionInterface['state'] = 'disconnected'

    constructor({ context: ctx, offer, id, service }: WebRTCRondevuConnectionOptions) {
        this.ctx = ctx
        this.id = id
        this.service = service
        this._conn = ctx.createPeerConnection()
        this.side = offer ? 'answer' : 'offer'

        // setup data channel
        if (offer) {
            this._conn.addEventListener('datachannel', e => {
                const channel = e.channel
                channel.addEventListener('message', e => {
                    console.log('Message from peer:', e)
                })
                channel.addEventListener('open', () => {
                    channel.send('I am ' + this.side)
                })
            })
        } else {
            const channel = this._conn.createDataChannel('vu.ronde.protocol')
            channel.addEventListener('message', e => {
                console.log('Message from peer:', e)
            })
            channel.addEventListener('open', () => {
                channel.send('I am ' + this.side)
            })
        }

        // setup description exchange
        this.ready = offer
            ? this._conn
                  .setRemoteDescription(offer)
                  .then(() => this._conn?.createAnswer())
                  .then(async answer => {
                      if (!answer || !this._conn) throw new Error('Connection disappeared')
                      await this._conn.setLocalDescription(answer)
                      return await ctx.signaler.setAnswer(answer)
                  })
            : this._conn.createOffer().then(async offer => {
                  if (!this._conn) throw new Error('Connection disappeared')
                  await this._conn.setLocalDescription(offer)
                  return await ctx.signaler.setOffer(offer)
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
            if (candidate) this.ctx.signaler.addIceCandidate(candidate)
        }
        if (!this._conn) throw new Error('Connection disappeared')
        this._conn.addEventListener('icecandidate', listener)
        this.iceBin(
            this.ctx.signaler.addListener((candidate: RTCIceCandidate) =>
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
     * Queue a message for sending when connection is established
     *
     * @param message - Message to queue (string or ArrayBuffer)
     * @param options - Queue options (e.g., expiration time)
     */
    queueMessage(message: Message, options: QueueMessageOptions = {}): Promise<void> {
        // TODO: Implement message queuing
        return Promise.resolve(undefined)
    }

    /**
     * Send a message immediately
     *
     * @param message - Message to send (string or ArrayBuffer)
     * @returns Promise resolving to true if sent successfully
     */
    sendMessage(message: Message): Promise<boolean> {
        // TODO: Implement message sending via data channel
        return Promise.resolve(false)
    }
}
