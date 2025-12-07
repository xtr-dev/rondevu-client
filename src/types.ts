/**
 * Core connection types
 */

export interface ConnectionIdentity {
    id: string;
    hostUsername: string;
}

export interface ConnectionState {
    state: 'connected' | 'disconnected' | 'connecting';
    lastActive: number;
}

export interface QueueMessageOptions {
    expiresAt?: number;
}

export interface ConnectionInterface {
    queueMessage(message: string | ArrayBuffer, options?: QueueMessageOptions): void;
    sendMessage(message: string | ArrayBuffer): void;
}

export type Connection = ConnectionIdentity & ConnectionState & ConnectionInterface;