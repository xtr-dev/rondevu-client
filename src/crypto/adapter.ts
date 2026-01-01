/**
 * Crypto adapter interface for platform-independent cryptographic operations
 */

export interface Credential {
    name: string
    secret: string
}

/**
 * Platform-independent crypto adapter interface
 * Implementations provide platform-specific crypto operations
 */
export interface CryptoAdapter {
    /**
     * Generate HMAC-SHA256 signature for message authentication
     * @param secret - The credential secret (hex string)
     * @param message - The message to sign
     * @returns Base64-encoded signature
     */
    generateSignature(secret: string, message: string): Promise<string>

    /**
     * Verify HMAC-SHA256 signature
     * @param secret - The credential secret (hex string)
     * @param message - The message that was signed
     * @param signature - The signature to verify (base64)
     * @returns True if signature is valid
     */
    verifySignature(secret: string, message: string, signature: string): Promise<boolean>

    /**
     * Generate a random secret (256-bit hex string)
     * @returns 64-character hex string
     */
    generateSecret(): string

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
