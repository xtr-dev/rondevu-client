/**
 * Core connection types
 */
import { EventBus } from './event-bus.js'
import { Binnable } from './bin.js'

export type Message = string | ArrayBuffer

export interface QueueMessageOptions {
    expiresAt?: number
}

export interface ConnectionEvents {
    'state-change': ConnectionInterface['state']
    message: Message
}

export const ConnectionStates = [
    'connected',
    'disconnected',
    'connecting'
] as const

export const isConnectionState = (state: string): state is (typeof ConnectionStates)[number] =>
    ConnectionStates.includes(state as any)

export interface ConnectionInterface {
    state: (typeof ConnectionStates)[number]
    lastActive: number
    expiresAt?: number
    events: EventBus<ConnectionEvents>

    queueMessage(message: Message, options?: QueueMessageOptions): Promise<void>
    sendMessage(message: Message): Promise<boolean>
}

export interface Signaler {
    addIceCandidate(candidate: RTCIceCandidate): Promise<void>
    addListener(callback: (candidate: RTCIceCandidate) => void): Binnable
    addOfferListener(callback: (offer: RTCSessionDescriptionInit) => void): Binnable
    addAnswerListener(callback: (answer: RTCSessionDescriptionInit) => void): Binnable
    setOffer(offer: RTCSessionDescriptionInit): Promise<void>
    setAnswer(answer: RTCSessionDescriptionInit): Promise<void>
}
