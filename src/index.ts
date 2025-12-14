/**
 * @xtr-dev/rondevu-client
 * WebRTC peer signaling client
 */

export { Rondevu, RondevuError, NetworkError, ValidationError, ConnectionError } from './rondevu.js'
export { RondevuAPI } from './api.js'
export { RpcBatcher } from './rpc-batcher.js'

// Export connection classes
export { RondevuConnection } from './connection.js'
export { OffererConnection } from './offerer-connection.js'
export { AnswererConnection } from './answerer-connection.js'

// Export utilities
export { ExponentialBackoff } from './exponential-backoff.js'
export { MessageBuffer } from './message-buffer.js'

// Export crypto adapters
export { WebCryptoAdapter } from './web-crypto-adapter.js'
export { NodeCryptoAdapter } from './node-crypto-adapter.js'

// Export types
export type {
    Signaler,
    Binnable,
} from './types.js'

export type {
    Keypair,
    OfferRequest,
    ServiceRequest,
    Service,
    ServiceOffer,
    IceCandidate,
} from './api.js'

export type {
    RondevuOptions,
    PublishServiceOptions,
    ConnectToServiceOptions,
    ConnectionContext,
    OfferContext,
    OfferFactory,
    ActiveOffer,
    FindServiceOptions,
    ServiceResult,
    PaginatedServiceResult
} from './rondevu.js'

export type { CryptoAdapter } from './crypto-adapter.js'

// Export connection types
export type {
    ConnectionConfig,
} from './connection-config.js'

export type {
    ConnectionState,
    BufferedMessage,
    ReconnectInfo,
    StateChangeInfo,
    ConnectionEventMap,
    ConnectionEventName,
    ConnectionEventArgs,
} from './connection-events.js'

export type {
    OffererOptions,
} from './offerer-connection.js'

export type {
    AnswererOptions,
} from './answerer-connection.js'

