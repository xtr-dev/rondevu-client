/**
 * @xtr-dev/rondevu-client
 * WebRTC peer signaling client
 */

export { Rondevu, RondevuError, NetworkError, ValidationError, ConnectionError } from './rondevu.js'
export { RondevuAPI } from '../api/client.js'
export { RpcBatcher } from '../api/batcher.js'

// Export connection classes
export { RondevuConnection } from '../connections/base.js'
export { OffererConnection } from '../connections/offerer.js'
export { AnswererConnection } from '../connections/answerer.js'

// Export utilities
export { ExponentialBackoff } from '../utils/exponential-backoff.js'
export { MessageBuffer } from '../utils/message-buffer.js'

// Export crypto adapters
export { WebCryptoAdapter } from '../crypto/web.js'
export { NodeCryptoAdapter } from '../crypto/node.js'

// Export types
export type {
    Signaler,
    Binnable,
} from './types.js'

export type {
    Credential,
    OfferRequest,
    ServiceRequest,
    Service,
    ServiceOffer,
    IceCandidate,
} from '../api/client.js'

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

export type { CryptoAdapter } from '../crypto/adapter.js'

// Export connection types
export type {
    ConnectionConfig,
} from '../connections/config.js'

export type {
    ConnectionState,
    BufferedMessage,
    ReconnectInfo,
    StateChangeInfo,
    ConnectionEventMap,
    ConnectionEventName,
    ConnectionEventArgs,
} from '../connections/events.js'

export type {
    OffererOptions,
} from '../connections/offerer.js'

export type {
    AnswererOptions,
} from '../connections/answerer.js'

