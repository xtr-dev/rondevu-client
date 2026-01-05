/**
 * Crypto adapter interface for platform-independent cryptographic operations
 */

/**
 * Ed25519 key pair for identity
 * The public key IS the identity (like Ethereum addresses)
 */
export interface KeyPair {
    publicKey: string // 64-char hex (32 bytes) Ed25519 public key
    privateKey: string // 64-char hex (32 bytes) Ed25519 private key - NEVER sent to server
}

/**
 * Platform-independent crypto adapter interface
 * Implementations provide platform-specific crypto operations
 */
export interface CryptoAdapter {
    /**
     * Generate a new Ed25519 key pair locally
     * The public key serves as the identity
     * @returns Key pair with public and private keys as hex strings
     */
    generateKeyPair(): Promise<KeyPair>

    /**
     * Sign a message using Ed25519
     * @param privateKey - The private key (64-char hex string)
     * @param message - The message to sign
     * @returns Base64-encoded signature
     */
    signMessage(privateKey: string, message: string): Promise<string>

    /**
     * Verify an Ed25519 signature
     * @param publicKey - The public key (64-char hex string)
     * @param message - The message that was signed
     * @param signature - The signature to verify (base64)
     * @returns True if signature is valid
     */
    verifySignature(publicKey: string, message: string, signature: string): Promise<boolean>

    /**
     * Convert hex string to bytes
     */
    hexToBytes(hex: string): Uint8Array

    /**
     * Convert bytes to hex string
     */
    bytesToHex(bytes: Uint8Array): string

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
