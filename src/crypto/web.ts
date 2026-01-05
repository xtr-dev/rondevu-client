/**
 * Web Crypto adapter for browser environments
 * Uses @noble/ed25519 for Ed25519 operations
 */

import * as ed from '@noble/ed25519'
import { CryptoAdapter, KeyPair } from './adapter.js'

// Configure @noble/ed25519 to use Web Crypto API's SHA-512
ed.hashes.sha512Async = async (message: Uint8Array): Promise<Uint8Array> => {
    const hashBuffer = await crypto.subtle.digest('SHA-512', message as unknown as BufferSource)
    return new Uint8Array(hashBuffer)
}

/**
 * Web Crypto implementation using browser APIs and @noble/ed25519
 * Uses btoa/atob for base64 encoding and crypto.getRandomValues for random bytes
 */
export class WebCryptoAdapter implements CryptoAdapter {
    /**
     * Generate a new Ed25519 key pair locally
     */
    async generateKeyPair(): Promise<KeyPair> {
        // Generate 32 random bytes for private key
        const privateKeyBytes = this.randomBytes(32)
        const privateKey = this.bytesToHex(privateKeyBytes)

        // Derive public key from private key
        const publicKeyBytes = await ed.getPublicKeyAsync(privateKeyBytes)
        const publicKey = this.bytesToHex(publicKeyBytes)

        return { publicKey, privateKey }
    }

    /**
     * Sign a message using Ed25519
     */
    async signMessage(privateKey: string, message: string): Promise<string> {
        if (!privateKey || typeof privateKey !== 'string') {
            throw new Error('Invalid private key: must be a non-empty string')
        }
        if (typeof message !== 'string') {
            throw new Error('Invalid message: must be a string')
        }

        const privateKeyBytes = this.hexToBytes(privateKey)

        // Convert message to bytes
        const encoder = new TextEncoder()
        const messageBytes = encoder.encode(message)

        // Sign using Ed25519
        const signatureBytes = await ed.signAsync(messageBytes, privateKeyBytes)

        // Convert to base64
        return this.bytesToBase64(signatureBytes)
    }

    /**
     * Verify an Ed25519 signature
     */
    async verifySignature(publicKey: string, message: string, signature: string): Promise<boolean> {
        try {
            const publicKeyBytes = this.hexToBytes(publicKey)
            const signatureBytes = this.base64ToBytes(signature)

            // Convert message to bytes
            const encoder = new TextEncoder()
            const messageBytes = encoder.encode(message)

            // Verify using Ed25519
            return await ed.verifyAsync(signatureBytes, messageBytes, publicKeyBytes)
        } catch (error) {
            console.error('Signature verification error:', error)
            return false
        }
    }

    /**
     * Convert hex string to bytes
     * @throws Error if hex string is invalid
     */
    hexToBytes(hex: string): Uint8Array {
        if (hex.length % 2 !== 0) {
            throw new Error('Hex string must have even length')
        }

        // Validate all characters are valid hex (0-9, a-f, A-F)
        if (!/^[0-9a-fA-F]*$/.test(hex)) {
            throw new Error('Invalid hex string: contains non-hex characters')
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
        // Validate base64 string format
        if (typeof base64 !== 'string' || base64.length === 0) {
            throw new Error('Invalid base64 string')
        }
        // Base64 length must be divisible by 4 (with padding), + requires at least one char
        if (base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
            throw new Error('Invalid base64 string')
        }
        try {
            const binString = atob(base64)
            return Uint8Array.from(binString, char => char.codePointAt(0)!)
        } catch {
            throw new Error('Invalid base64 string')
        }
    }

    randomBytes(length: number): Uint8Array {
        return crypto.getRandomValues(new Uint8Array(length))
    }
}
