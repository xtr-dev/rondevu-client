/**
 * Connection configuration interfaces and defaults
 */

export interface ConnectionConfig {
    // Timeouts
    connectionTimeout: number      // Maximum time to wait for connection establishment (ms)
    iceGatheringTimeout: number    // Maximum time to wait for ICE gathering to complete (ms)

    // Reconnection
    reconnectEnabled: boolean      // Enable automatic reconnection on failures
    maxReconnectAttempts: number   // Maximum number of reconnection attempts (0 = infinite)
    reconnectBackoffBase: number   // Base delay for exponential backoff (ms)
    reconnectBackoffMax: number    // Maximum delay between reconnection attempts (ms)
    reconnectJitter: number        // Jitter factor for backoff (0-1, adds randomness to prevent thundering herd)

    // Message buffering
    bufferEnabled: boolean         // Enable automatic message buffering during disconnections
    maxBufferSize: number          // Maximum number of messages to buffer
    maxBufferAge: number           // Maximum age of buffered messages (ms)
    preserveBufferOnClose: boolean // Keep buffer on explicit close (vs. clearing it)

    // ICE polling
    icePollingInterval: number     // Interval for polling remote ICE candidates (ms)
    icePollingTimeout: number      // Maximum time to poll for ICE candidates (ms)

    // Debug
    debug: boolean                 // Enable debug logging
}

export const DEFAULT_CONNECTION_CONFIG: ConnectionConfig = {
    // Timeouts
    connectionTimeout: 30000,      // 30 seconds
    iceGatheringTimeout: 10000,    // 10 seconds

    // Reconnection
    reconnectEnabled: true,
    maxReconnectAttempts: 5,       // 5 attempts before giving up
    reconnectBackoffBase: 1000,    // Start with 1 second
    reconnectBackoffMax: 30000,    // Cap at 30 seconds
    reconnectJitter: 0.1,          // 10% jitter

    // Message buffering
    bufferEnabled: true,
    maxBufferSize: 100,            // 100 messages
    maxBufferAge: 60000,           // 1 minute
    preserveBufferOnClose: false,  // Clear buffer on close

    // ICE polling
    icePollingInterval: 500,       // Poll every 500ms
    icePollingTimeout: 30000,      // Stop polling after 30s

    // Debug
    debug: false,
}

export function mergeConnectionConfig(
    userConfig?: Partial<ConnectionConfig>
): ConnectionConfig {
    return {
        ...DEFAULT_CONNECTION_CONFIG,
        ...userConfig,
    }
}
