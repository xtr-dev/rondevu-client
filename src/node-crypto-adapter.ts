/**
 * Node.js Crypto adapter for Node.js environments
 * Requires Node.js 19+ or Node.js 18 with --experimental-global-webcrypto flag
 */

import * as ed25519 from '@noble/ed25519'
import { CryptoAdapter, Keypair } from './crypto-adapter.js'

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
 *   keypair,
 *   new NodeCryptoAdapter()
 * )
 * ```
 */
export class NodeCryptoAdapter implements CryptoAdapter {
    constructor() {
        // Set SHA-512 hash function for ed25519 using Node's crypto.subtle
        if (typeof crypto === 'undefined' || !crypto.subtle) {
            throw new Error(
                'crypto.subtle is not available. ' +
                'Node.js 19+ is required, or Node.js 18 with --experimental-global-webcrypto flag'
            )
        }

        ed25519.hashes.sha512Async = async (message: Uint8Array) => {
            const hash = await crypto.subtle.digest('SHA-512', message as BufferSource)
            return new Uint8Array(hash)
        }
    }

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
