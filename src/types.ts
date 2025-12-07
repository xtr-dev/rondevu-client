/**
 * Core connection types
 */
import {EventBus} from "./event-bus";
import {Binnable} from "./bin";

export type Message = string | ArrayBuffer;

export interface QueueMessageOptions {
    expiresAt?: number;
}

export interface ConnectionEvents {
    'state-change': ConnectionInterface['state']
    'message': Message;
}

export interface ConnectionInterface {
    id: string;
    host: string;
    service: string;
    state: 'connected' | 'disconnected' | 'connecting';
    lastActive: number;
    expiresAt?: number;
    events: EventBus<ConnectionEvents>;

    queueMessage(message: Message, options?: QueueMessageOptions): Promise<void>;
    sendMessage(message: Message): Promise<boolean>;
}

export interface Signaler {
    addIceCandidate(candidate: RTCIceCandidate): Promise<void> | void;
    addListener(callback: (candidate: RTCIceCandidate) => void): Binnable;
}