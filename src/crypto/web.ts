/**
 * Web Crypto adapter for browser environments
 */

import { CryptoAdapter } from './adapter.js'

/**
 * Web Crypto implementation using browser APIs
 * Uses btoa/atob for base64 encoding and crypto.getRandomValues for random bytes
 */
export class WebCryptoAdapter implements CryptoAdapter {
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
            return await crypto.subtle.verify('HMAC', key, signatureBytes as BufferSource, messageBytes)
        } catch (error) {
            console.error('Signature verification error:', error)
            return false
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
        const binString = Array.from(bytes, byte => String.fromCodePoint(byte)).join('')
        return btoa(binString)
    }

    base64ToBytes(base64: string): Uint8Array {
        const binString = atob(base64)
        return Uint8Array.from(binString, char => char.codePointAt(0)!)
    }

    randomBytes(length: number): Uint8Array {
        return crypto.getRandomValues(new Uint8Array(length))
    }
}
