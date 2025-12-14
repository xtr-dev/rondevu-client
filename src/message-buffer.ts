/**
 * Message buffering system for storing messages during disconnections
 */

import { BufferedMessage } from './connection-events.js'

export interface MessageBufferConfig {
    maxSize: number       // Maximum number of messages to buffer
    maxAge: number        // Maximum age of messages in milliseconds
}

export class MessageBuffer {
    private buffer: BufferedMessage[] = []
    private messageIdCounter = 0

    constructor(private config: MessageBufferConfig) {}

    /**
     * Add a message to the buffer
     * Returns the buffered message with metadata
     */
    add(data: string | ArrayBuffer | Blob): BufferedMessage {
        const message: BufferedMessage = {
            id: `msg_${Date.now()}_${this.messageIdCounter++}`,
            data,
            timestamp: Date.now(),
            attempts: 0,
        }

        // Check if buffer is full
        if (this.buffer.length >= this.config.maxSize) {
            // Remove oldest message
            const discarded = this.buffer.shift()
            if (discarded) {
                return message // Signal overflow by returning the new message
            }
        }

        this.buffer.push(message)
        return message
    }

    /**
     * Get all messages in the buffer
     */
    getAll(): BufferedMessage[] {
        return [...this.buffer]
    }

    /**
     * Get messages that haven't exceeded max age
     */
    getValid(): BufferedMessage[] {
        const now = Date.now()
        return this.buffer.filter((msg) => now - msg.timestamp < this.config.maxAge)
    }

    /**
     * Get and remove expired messages
     */
    getExpired(): BufferedMessage[] {
        const now = Date.now()
        const expired: BufferedMessage[] = []
        this.buffer = this.buffer.filter((msg) => {
            if (now - msg.timestamp >= this.config.maxAge) {
                expired.push(msg)
                return false
            }
            return true
        })
        return expired
    }

    /**
     * Remove a specific message by ID
     */
    remove(messageId: string): BufferedMessage | null {
        const index = this.buffer.findIndex((msg) => msg.id === messageId)
        if (index === -1) return null

        const [removed] = this.buffer.splice(index, 1)
        return removed
    }

    /**
     * Clear all messages from the buffer
     */
    clear(): BufferedMessage[] {
        const cleared = [...this.buffer]
        this.buffer = []
        return cleared
    }

    /**
     * Increment attempt count for a message
     */
    incrementAttempt(messageId: string): boolean {
        const message = this.buffer.find((msg) => msg.id === messageId)
        if (!message) return false

        message.attempts++
        return true
    }

    /**
     * Get the current size of the buffer
     */
    size(): number {
        return this.buffer.length
    }

    /**
     * Check if buffer is empty
     */
    isEmpty(): boolean {
        return this.buffer.length === 0
    }

    /**
     * Check if buffer is full
     */
    isFull(): boolean {
        return this.buffer.length >= this.config.maxSize
    }
}
