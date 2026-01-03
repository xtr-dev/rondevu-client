/**
 * Peer - Clean DX wrapper for peer-to-peer connections
 *
 * Provides a simple interface for connecting to a peer by tags/username,
 * with automatic reconnection and message buffering.
 */

import { EventEmitter } from 'eventemitter3'
import { RondevuAPI, DiscoverResponse, TaggedOffer } from '../api/client.js'
import { AnswererConnection } from '../connections/answerer.js'
import { ConnectionConfig } from '../connections/config.js'
import { ConnectionState } from '../connections/events.js'

/**
 * Simplified peer state (maps from ConnectionState)
 */
export type PeerState =
    | 'connecting' // Initial connection in progress
    | 'connected' // Data channel open, ready to send/receive
    | 'disconnected' // Temporarily lost connection
    | 'reconnecting' // Attempting to reconnect
    | 'failed' // Connection failed (will retry if enabled)
    | 'closed' // Permanently closed

/**
 * Event map for Peer
 */
export interface PeerEventMap {
    /** Emitted when connection state changes */
    state: [state: PeerState, previousState: PeerState]
    /** Emitted when connection is established */
    open: []
    /** Emitted when connection is closed */
    close: [reason?: string]
    /** Emitted when a message is received */
    message: [data: string | ArrayBuffer | Blob]
    /** Emitted when an error occurs */
    error: [error: Error]
    /** Emitted when reconnection is attempted */
    reconnecting: [attempt: number, maxAttempts: number]
}

export type PeerEventName = keyof PeerEventMap

/**
 * Options for creating a Peer connection
 */
export interface PeerOptions {
    /** Tags to match for peer discovery */
    tags: string[]
    /** Optional: connect to specific username */
    username?: string
    /** Optional: custom RTC configuration */
    rtcConfig?: RTCConfiguration
    /** Optional: connection behavior configuration */
    config?: Partial<ConnectionConfig>
}

/**
 * Internal options passed from Rondevu
 */
export interface PeerInternalOptions extends PeerOptions {
    api: RondevuAPI
    iceServers: RTCIceServer[]
    iceTransportPolicy?: RTCIceTransportPolicy
    debug?: boolean
}

/**
 * Peer - A clean interface for peer-to-peer connections
 *
 * @example
 * ```typescript
 * const peer = await rondevu.peer({
 *   username: 'alice',
 *   tags: ['chat']
 * })
 *
 * peer.on('open', () => {
 *   console.log('Connected to', peer.peerUsername)
 *   peer.send('Hello!')
 * })
 *
 * peer.on('message', (data) => {
 *   console.log('Received:', data)
 * })
 *
 * peer.on('state', (state) => {
 *   console.log('Connection state:', state)
 * })
 *
 * // Access underlying WebRTC objects
 * const pc = peer.peerConnection  // RTCPeerConnection
 * const dc = peer.dataChannel     // RTCDataChannel
 * ```
 */
export class Peer extends EventEmitter<PeerEventMap> {
    private connection: AnswererConnection | null = null
    private api: RondevuAPI
    private tags: string[]
    private targetUsername?: string
    private iceServers: RTCIceServer[]
    private iceTransportPolicy?: RTCIceTransportPolicy
    private connectionConfig?: Partial<ConnectionConfig>
    private debugEnabled: boolean

    private _state: PeerState = 'connecting'
    private _peerUsername: string = ''
    private _offerId: string = ''

    constructor(options: PeerInternalOptions) {
        super()
        this.api = options.api
        this.tags = options.tags
        this.targetUsername = options.username
        this.iceServers = options.iceServers
        this.iceTransportPolicy = options.iceTransportPolicy
        this.connectionConfig = options.config
        this.debugEnabled = options.debug || false
    }

    /**
     * Initialize the peer connection (called internally by Rondevu.peer())
     */
    async initialize(): Promise<void> {
        this.debug('Initializing peer connection')
        this.debug(
            `Tags: ${this.tags.join(', ')}${this.targetUsername ? `, username: ${this.targetUsername}` : ''}`
        )

        // Discover offers
        const result = (await this.api.discover({
            tags: this.tags,
            limit: 100,
        })) as DiscoverResponse

        if (!result.offers || result.offers.length === 0) {
            throw new Error(`No peers found for tags: ${this.tags.join(', ')}`)
        }

        // Filter by username if specified
        let availableOffers = result.offers
        if (this.targetUsername) {
            availableOffers = result.offers.filter(
                (o: TaggedOffer) => o.username === this.targetUsername
            )
            if (availableOffers.length === 0) {
                throw new Error(
                    `No peers found for tags: ${this.tags.join(', ')} from @${this.targetUsername}`
                )
            }
        }

        // Pick a random offer
        const offer = availableOffers[Math.floor(Math.random() * availableOffers.length)]
        this._peerUsername = offer.username
        this._offerId = offer.offerId

        this.debug(`Selected offer ${offer.offerId} from @${offer.username}`)

        // Create the underlying AnswererConnection
        this.connection = new AnswererConnection({
            api: this.api,
            ownerUsername: offer.username,
            tags: offer.tags,
            offerId: offer.offerId,
            offerSdp: offer.sdp,
            rtcConfig: {
                iceServers: this.iceServers,
                iceTransportPolicy: this.iceTransportPolicy,
            },
            config: {
                ...this.connectionConfig,
                debug: this.debugEnabled,
            },
        })

        // Wire up events
        this.setupEventHandlers()

        // Start connection
        await this.connection.initialize()
    }

    /**
     * Setup event handlers to forward from AnswererConnection
     */
    private setupEventHandlers(): void {
        if (!this.connection) return

        // Map ConnectionState to PeerState
        this.connection.on('state:changed', ({ oldState, newState, reason }) => {
            const mappedOld = this.mapState(oldState)
            const mappedNew = this.mapState(newState)

            if (mappedOld !== mappedNew) {
                this._state = mappedNew
                this.emit('state', mappedNew, mappedOld)
            }
        })

        // Forward connection events
        this.connection.on('connected', () => {
            this._state = 'connected'
            this.emit('open')
        })

        this.connection.on('closed', reason => {
            this._state = 'closed'
            this.emit('close', reason)
        })

        this.connection.on('failed', error => {
            this._state = 'failed'
            this.emit('error', error)
        })

        // Forward message events
        this.connection.on('message', data => {
            this.emit('message', data)
        })

        // Forward reconnection events
        this.connection.on('reconnect:scheduled', info => {
            this._state = 'reconnecting'
            this.emit('reconnecting', info.attempt, info.maxAttempts)
        })

        this.connection.on('reconnect:success', () => {
            // State will be updated by 'connected' event
        })

        this.connection.on('reconnect:failed', error => {
            this.emit('error', error)
        })
    }

    /**
     * Map internal ConnectionState to simplified PeerState
     */
    private mapState(state: ConnectionState): PeerState {
        switch (state) {
            case ConnectionState.INITIALIZING:
            case ConnectionState.GATHERING:
            case ConnectionState.SIGNALING:
            case ConnectionState.CHECKING:
            case ConnectionState.CONNECTING:
                return 'connecting'
            case ConnectionState.CONNECTED:
                return 'connected'
            case ConnectionState.DISCONNECTED:
                return 'disconnected'
            case ConnectionState.RECONNECTING:
                return 'reconnecting'
            case ConnectionState.FAILED:
                return 'failed'
            case ConnectionState.CLOSED:
                return 'closed'
            default:
                return 'connecting'
        }
    }

    // ========================================
    // Public Properties
    // ========================================

    /**
     * Current connection state
     */
    get state(): PeerState {
        return this._state
    }

    /**
     * Username of the connected peer
     */
    get peerUsername(): string {
        return this._peerUsername
    }

    /**
     * The offer ID being used for this connection
     */
    get offerId(): string {
        return this._offerId
    }

    /**
     * Tags used for discovery
     */
    get peerTags(): string[] {
        return this.tags
    }

    /**
     * The underlying RTCPeerConnection (null if not connected)
     */
    get peerConnection(): RTCPeerConnection | null {
        return this.connection?.getPeerConnection() ?? null
    }

    /**
     * The underlying RTCDataChannel (null if not connected)
     */
    get dataChannel(): RTCDataChannel | null {
        return this.connection?.getDataChannel() ?? null
    }

    /**
     * Whether the peer is currently connected
     */
    get isConnected(): boolean {
        return this._state === 'connected'
    }

    // ========================================
    // Public Methods
    // ========================================

    /**
     * Send a message to the peer
     * Messages are buffered if not connected (when buffering is enabled)
     *
     * @param data - String, ArrayBuffer, or Blob to send
     */
    send(data: string | ArrayBuffer | Blob): void {
        if (!this.connection) {
            throw new Error('Peer not initialized')
        }
        this.connection.send(data)
    }

    /**
     * Close the peer connection
     */
    close(): void {
        this.debug('Closing peer connection')
        this.connection?.close()
        this._state = 'closed'
    }

    /**
     * Get the underlying AnswererConnection for advanced use cases
     */
    getConnection(): AnswererConnection | null {
        return this.connection
    }

    /**
     * Debug logging
     */
    private debug(...args: unknown[]): void {
        if (this.debugEnabled) {
            console.log('[Peer]', ...args)
        }
    }
}
