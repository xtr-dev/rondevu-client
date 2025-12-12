/**
 * Crypto adapter interface for platform-independent cryptographic operations
 */

export interface Keypair {
    publicKey: string
    privateKey: string
}

/**
 * Platform-independent crypto adapter interface
 * Implementations provide platform-specific crypto operations
 */
export interface CryptoAdapter {
    /**
     * Generate an Ed25519 keypair
     */
    generateKeypair(): Promise<Keypair>

    /**
     * Sign a message with an Ed25519 private key
     */
    signMessage(message: string, privateKeyBase64: string): Promise<string>

    /**
     * Verify an Ed25519 signature
     */
    verifySignature(
        message: string,
        signatureBase64: string,
        publicKeyBase64: string
    ): Promise<boolean>

    /**
     * Convert Uint8Array to base64 string
     */
    bytesToBase64(bytes: Uint8Array): string

    /**
     * Convert base64 string to Uint8Array
     */
    base64ToBytes(base64: string): Uint8Array

    /**
     * Generate random bytes
     */
    randomBytes(length: number): Uint8Array
}
