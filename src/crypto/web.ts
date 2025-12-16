/**
 * Web Crypto adapter for browser environments
 */

import * as ed25519 from '@noble/ed25519'
import { CryptoAdapter, Keypair } from './adapter.js'

// Set SHA-512 hash function for ed25519 (required in @noble/ed25519 v3+)
ed25519.hashes.sha512Async = async (message: Uint8Array) => {
    return new Uint8Array(await crypto.subtle.digest('SHA-512', message as BufferSource))
}

/**
 * Web Crypto implementation using browser APIs
 * Uses btoa/atob for base64 encoding and crypto.getRandomValues for random bytes
 */
export class WebCryptoAdapter implements CryptoAdapter {
    async generateKeypair(): Promise<Keypair> {
        const privateKey = ed25519.utils.randomSecretKey()
        const publicKey = await ed25519.getPublicKeyAsync(privateKey)

        return {
            publicKey: this.bytesToBase64(publicKey),
            privateKey: this.bytesToBase64(privateKey),
        }
    }

    async signMessage(message: string, privateKeyBase64: string): Promise<string> {
        const privateKey = this.base64ToBytes(privateKeyBase64)
        const encoder = new TextEncoder()
        const messageBytes = encoder.encode(message)
        const signature = await ed25519.signAsync(messageBytes, privateKey)

        return this.bytesToBase64(signature)
    }

    async verifySignature(
        message: string,
        signatureBase64: string,
        publicKeyBase64: string
    ): Promise<boolean> {
        try {
            const signature = this.base64ToBytes(signatureBase64)
            const publicKey = this.base64ToBytes(publicKeyBase64)
            const encoder = new TextEncoder()
            const messageBytes = encoder.encode(message)

            return await ed25519.verifyAsync(signature, messageBytes, publicKey)
        } catch {
            return false
        }
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
