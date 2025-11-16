/**
 * @xtr-dev/rondevu-client
 * WebRTC peer signaling and discovery client with topic-based discovery
 */

// Export main client class
export { Rondevu } from './rondevu.js';
export type { RondevuOptions } from './rondevu.js';

// Export authentication
export { RondevuAuth } from './auth.js';
export type { Credentials, FetchFunction } from './auth.js';

// Export offers API
export { RondevuOffers } from './offers.js';
export type {
  CreateOfferRequest,
  Offer,
  IceCandidate,
  TopicInfo
} from './offers.js';

// Export bloom filter
export { BloomFilter } from './bloom.js';

// Export peer manager
export { default as RondevuPeer } from './peer.js';
export type {
  PeerOptions,
  PeerEvents,
  PeerTimeouts
} from './peer.js';
