/**
 * Node.js Crypto adapter for Node.js environments
 * Requires Node.js 19+ or Node.js 18 with --experimental-global-webcrypto flag
 */

import { CryptoAdapter } from './adapter.js'

/**
 * Node.js Crypto implementation using Node.js built-in APIs
 * Uses Buffer for base64 encoding and crypto.randomBytes for random generation
 *
 * Requirements:
 * - Node.js 19+ (crypto.subtle available globally)
 * - OR Node.js 18 with --experimental-global-webcrypto flag
 *
 * @example
 * ```typescript
 * import { RondevuAPI } from '@xtr-dev/rondevu-client'
 * import { NodeCryptoAdapter } from '@xtr-dev/rondevu-client/node'
 *
 * const api = new RondevuAPI(
 *   'https://signal.example.com',
 *   'alice',
 *   { name: 'alice', secret: '...' },
 *   new NodeCryptoAdapter()
 * )
 * ```
 */
export class NodeCryptoAdapter implements CryptoAdapter {
    constructor() {
        if (typeof crypto === 'undefined' || !crypto.subtle) {
            throw new Error(
                'crypto.subtle is not available. ' +
                'Node.js 19+ is required, or Node.js 18 with --experimental-global-webcrypto flag'
            )
        }
    }

    /**
     * Generate HMAC-SHA256 signature
     */
    async generateSignature(secret: string, message: string): Promise<string> {
        const secretBytes = this.hexToBytes(secret)

        // Import secret as HMAC key
        const key = await crypto.subtle.importKey(
            'raw',
            secretBytes as BufferSource,
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        )

        // Convert message to bytes
        const encoder = new TextEncoder()
        const messageBytes = encoder.encode(message)

        // Generate HMAC signature
        const signatureBytes = await crypto.subtle.sign('HMAC', key, messageBytes)

        // Convert to base64
        return this.bytesToBase64(new Uint8Array(signatureBytes))
    }

    /**
     * Verify HMAC-SHA256 signature
     * Uses constant-time comparison via Web Crypto API to prevent timing attacks
     * @throws Error if secret or signature format is invalid (not a signature mismatch)
     */
    async verifySignature(secret: string, message: string, signature: string): Promise<boolean> {
        try {
            const secretBytes = this.hexToBytes(secret)

            // Import secret as HMAC key for verification
            const key = await crypto.subtle.importKey(
                'raw',
                secretBytes as BufferSource,
                { name: 'HMAC', hash: 'SHA-256' },
                false,
                ['verify']
            )

            // Convert message to bytes
            const encoder = new TextEncoder()
            const messageBytes = encoder.encode(message)

            // Convert signature from base64 to bytes
            const signatureBytes = this.base64ToBytes(signature)

            // Use Web Crypto API's verify() for constant-time comparison
            // Returns false for invalid signatures, throws for system errors
            return await crypto.subtle.verify('HMAC', key, signatureBytes as BufferSource, messageBytes)
        } catch (error) {
            // Re-throw with context - don't swallow system errors
            throw new Error(`HMAC signature verification failed: ${error instanceof Error ? error.message : String(error)}`)
        }
    }

    /**
     * Generate a random secret (256-bit hex string)
     */
    generateSecret(): string {
        const bytes = this.randomBytes(32) // 32 bytes = 256 bits
        return this.bytesToHex(bytes)
    }

    /**
     * Convert hex string to bytes
     */
    hexToBytes(hex: string): Uint8Array {
        if (hex.length % 2 !== 0) {
            throw new Error('Hex string must have even length')
        }

        const bytes = new Uint8Array(hex.length / 2)
        for (let i = 0; i < hex.length; i += 2) {
            bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
        }
        return bytes
    }

    /**
     * Convert bytes to hex string
     */
    bytesToHex(bytes: Uint8Array): string {
        return Array.from(bytes)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('')
    }

    bytesToBase64(bytes: Uint8Array): string {
        // Node.js Buffer provides native base64 encoding
        return Buffer.from(bytes).toString('base64')
    }

    base64ToBytes(base64: string): Uint8Array {
        // Node.js Buffer provides native base64 decoding
        return new Uint8Array(Buffer.from(base64, 'base64'))
    }

    randomBytes(length: number): Uint8Array {
        // Use Web Crypto API's getRandomValues (available in Node 19+)
        return crypto.getRandomValues(new Uint8Array(length))
    }
}
