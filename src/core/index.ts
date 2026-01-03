/**
 * @xtr-dev/rondevu-client
 * WebRTC peer signaling client
 *
 * Simple API:
 *   const rondevu = await Rondevu.connect()
 *
 *   // Host: publish offers (auto-starts)
 *   const offer = await rondevu.offer({ tags: ['chat'], maxOffers: 5 })
 *   rondevu.on('connection:opened', (id, conn) => { ... })
 *   // Later: offer.cancel()
 *
 *   // Guest: connect to a peer
 *   const peer = await rondevu.peer({ tags: ['chat'] })
 *   peer.on('open', () => peer.send('Hello!'))
 */

// Main entry point
export { Rondevu } from './rondevu.js'

// Simplified peer connection
export { Peer } from './peer.js'

// ICE server configuration presets
export { ICE_SERVER_PRESETS } from './ice-config.js'

// Essential types for configuration
export type {
    RondevuOptions,
    OfferOptions,
    OfferHandle,
    DiscoverOptions,
    DiscoverResult,
} from './rondevu.js'
export type { PeerState, PeerOptions } from './peer.js'
export type { IceServerPreset } from './ice-config.js'
