/**
 * Rondevu Type Definitions
 *
 * Contains all public interfaces and types for the Rondevu client.
 */

import { KeyPair } from '../api/client.js'
import { CryptoAdapter } from '../crypto/adapter.js'
import { WebRTCAdapter } from '../webrtc/adapter.js'
import { ConnectionConfig } from '../connections/config.js'
import { IceServerPreset } from './ice-config.js'

/**
 * Options for creating a Rondevu instance via Rondevu.connect()
 */
export interface RondevuOptions {
    /** API URL (defaults to 'https://api.ronde.vu') */
    apiUrl?: string
    /** Pre-existing keypair (will generate if not provided) */
    keyPair?: KeyPair
    /** Crypto adapter (defaults to WebCryptoAdapter) */
    cryptoAdapter?: CryptoAdapter
    /** WebRTC adapter (defaults to BrowserWebRTCAdapter, use NodeWebRTCAdapter for Node.js) */
    webrtcAdapter?: WebRTCAdapter
    /** ICE server preset name or custom RTCIceServer array */
    iceServers?: IceServerPreset | RTCIceServer[]
    /** Enable debug logging (default: false) */
    debug?: boolean
}

/**
 * Context returned by offer factory functions
 */
export interface OfferContext {
    /** Optional data channel created for the offer */
    dc?: RTCDataChannel
    /** The WebRTC offer SDP */
    offer: RTCSessionDescriptionInit
}

/**
 * Factory function for creating WebRTC offers.
 * Rondevu creates the RTCPeerConnection and passes it to the factory,
 * allowing ICE candidate handlers to be set up before setLocalDescription() is called.
 *
 * @param pc - The RTCPeerConnection created by Rondevu (already configured with ICE servers)
 * @returns Promise containing the data channel (optional) and offer SDP
 */
export type OfferFactory = (pc: RTCPeerConnection) => Promise<OfferContext>

/**
 * Options for rondevu.offer() - publishing WebRTC offers
 */
export interface OfferOptions {
    /** Tags for discovery (e.g., ["chat", "video"]) */
    tags: string[]
    /** Maximum number of concurrent offers to maintain */
    maxOffers: number
    /** Custom offer creation (defaults to simple data channel) */
    offerFactory?: OfferFactory
    /** Time-to-live for offers in milliseconds (default: 300000 = 5 minutes) */
    ttl?: number
    /** Connection durability configuration */
    connectionConfig?: Partial<ConnectionConfig>
    /** Auto-start filling offers (default: true). Set to false to manually call startFilling() */
    autoStart?: boolean
}

/**
 * Handle returned by rondevu.offer() for controlling the offer lifecycle
 */
export interface OfferHandle {
    /** Stop filling offers and close all connections */
    cancel: () => void
}

/**
 * Context provided when a connection is established
 */
export interface ConnectionContext {
    /** The underlying RTCPeerConnection */
    pc: RTCPeerConnection
    /** The data channel for communication */
    dc: RTCDataChannel
    /** Tags associated with this connection */
    tags: string[]
    /** The offer ID for this connection */
    offerId: string
    /** Public key of the connected peer */
    peerPublicKey: string
}

/**
 * Options for rondevu.discover() - discovering available offers
 */
export interface DiscoverOptions {
    /** Max results (default: 10) */
    limit?: number
    /** Offset for pagination (default: 0) */
    offset?: number
}

/**
 * A discovered offer from the signaling server
 */
export interface DiscoveredOffer {
    /** Unique offer identifier */
    offerId: string
    /** Public key of the offer publisher */
    publicKey: string
    /** Tags associated with this offer */
    tags: string[]
    /** The WebRTC offer SDP */
    sdp: string
    /** Timestamp when the offer was created */
    createdAt: number
    /** Timestamp when the offer expires */
    expiresAt: number
}

/**
 * Result of a discover() call
 */
export interface DiscoverResult {
    /** Array of discovered offers */
    offers: DiscoveredOffer[]
    /** Total count of matching offers */
    count: number
    /** Limit used in the query */
    limit: number
    /** Offset used in the query */
    offset: number
}
