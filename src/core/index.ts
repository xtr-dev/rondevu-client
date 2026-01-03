/**
 * @xtr-dev/rondevu-client
 * WebRTC peer signaling client
 *
 * Simple API:
 *   const rondevu = await Rondevu.connect({ apiUrl: 'https://api.ronde.vu' })
 *
 *   // Host: publish offers
 *   await rondevu.offer({ tags: ['chat'] })
 *   await rondevu.startFilling()
 *   rondevu.on('connection:opened', (id, conn) => { ... })
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
export type { RondevuOptions, OfferOptions } from './rondevu.js'
export type { PeerState, PeerEventMap, PeerOptions } from './peer.js'
export type { ConnectionState } from '../connections/events.js'
export type { ConnectionOptions } from '../connections/config.js'
export type { IceServerPreset } from './ice-config.js'

// Types for advanced use cases (discovery, credentials)
export type { Credential, TaggedOffer } from '../api/client.js'
export type { DiscoverOptions, DiscoverResult } from './rondevu.js'
