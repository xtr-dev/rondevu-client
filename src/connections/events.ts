/**
 * TypeScript event type definitions for RondevuConnection
 */

export enum ConnectionState {
    INITIALIZING = 'initializing', // Creating peer connection
    GATHERING = 'gathering', // ICE gathering in progress
    SIGNALING = 'signaling', // Exchanging offer/answer
    CHECKING = 'checking', // ICE connectivity checks
    CONNECTING = 'connecting', // ICE connection attempts
    CONNECTED = 'connected', // Data channel open, working
    DISCONNECTED = 'disconnected', // Temporarily disconnected
    RECONNECTING = 'reconnecting', // Attempting reconnection
    FAILED = 'failed', // Connection failed
    CLOSED = 'closed', // Connection closed permanently
}

export interface BufferedMessage {
    id: string
    data: string | ArrayBuffer | Blob
    timestamp: number
    attempts: number
}

export interface ReconnectInfo {
    attempt: number
    delay: number
    maxAttempts: number
}

export interface StateChangeInfo {
    oldState: ConnectionState
    newState: ConnectionState
    reason?: string
}

/**
 * Event map for RondevuConnection
 * Maps event names to their payload types
 */
export interface ConnectionEventMap {
    // Lifecycle events
    'state:changed': [StateChangeInfo]
    connecting: []
    connected: []
    disconnected: [reason?: string]
    failed: [error: Error]
    closed: [reason?: string]

    // Reconnection events
    'reconnect:scheduled': [ReconnectInfo]
    'reconnect:attempting': [attempt: number]
    'reconnect:success': []
    'reconnect:failed': [error: Error]
    'reconnect:exhausted': [attempts: number]

    // Message events
    message: [data: string | ArrayBuffer | Blob]
    'message:sent': [data: string | ArrayBuffer | Blob, buffered: boolean]
    'message:buffered': [data: string | ArrayBuffer | Blob]
    'message:replayed': [message: BufferedMessage]
    'message:buffer:overflow': [discardedMessage: BufferedMessage]
    'message:buffer:expired': [message: BufferedMessage]

    // ICE events
    'ice:candidate:local': [candidate: RTCIceCandidate | null]
    'ice:candidate:remote': [candidate: RTCIceCandidate | null]
    'ice:connection:state': [state: RTCIceConnectionState]
    'ice:gathering:state': [state: RTCIceGatheringState]
    'ice:polling:started': []
    'ice:polling:stopped': []

    // Answer processing events (offerer only)
    'answer:processed': [offerId: string, answererId: string]
    'answer:duplicate': [offerId: string]

    // Data channel events
    'datachannel:open': []
    'datachannel:close': []
    'datachannel:error': [error: Event]

    // Cleanup events
    'cleanup:started': []
    'cleanup:complete': []

    // Connection events (mirrors RTCPeerConnection.connectionState)
    'connection:state': [state: RTCPeerConnectionState]

    // Timeout events
    'connection:timeout': []
    'ice:gathering:timeout': []
}

/**
 * Helper type to extract event names from the event map
 */
export type ConnectionEventName = keyof ConnectionEventMap

/**
 * Helper type to extract event arguments for a specific event
 */
export type ConnectionEventArgs<T extends ConnectionEventName> = ConnectionEventMap[T]
