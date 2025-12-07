/**
 * @xtr-dev/rondevu-client
 * WebRTC peer signaling client
 */

export { EventBus } from './event-bus.js'
export { RondevuAPI } from './api.js'
export { RondevuService } from './rondevu-service.js'
export { RondevuSignaler } from './rondevu-signaler.js'
export { WebRTCContext } from './webrtc-context.js'
export { RTCDurableConnection } from './durable-connection'
export { ServiceHost } from './service-host.js'
export { ServiceClient } from './service-client.js'
export { createBin } from './bin.js'

// Export types
export type {
    ConnectionInterface,
    QueueMessageOptions,
    Message,
    ConnectionEvents,
    Signaler,
} from './types.js'

export type {
    Credentials,
    Keypair,
    OfferRequest,
    Offer,
    ServiceRequest,
    Service,
    IceCandidate,
} from './api.js'

export type { Binnable } from './bin.js'

export type { RondevuServiceOptions, PublishServiceOptions } from './rondevu-service.js'

export type { ServiceHostOptions, ServiceHostEvents } from './service-host.js'

export type { ServiceClientOptions, ServiceClientEvents } from './service-client.js'

export type { PollingConfig } from './rondevu-signaler.js'

