import * as ed25519 from '@noble/ed25519';

// Set SHA-512 hash function for ed25519 (required in @noble/ed25519 v3+)
// Uses built-in WebCrypto API
ed25519.hashes.sha512Async = async (message: Uint8Array) => {
  return new Uint8Array(await crypto.subtle.digest('SHA-512', message as BufferSource));
};

/**
 * Username claim result
 */
export interface UsernameClaimResult {
  username: string;
  publicKey: string;
  privateKey: string;
  claimedAt: number;
  expiresAt: number;
}

/**
 * Username availability check result
 */
export interface UsernameCheckResult {
  username: string;
  available: boolean;
  claimedAt?: number;
  expiresAt?: number;
  publicKey?: string;
}

/**
 * Convert Uint8Array to base64 string
 */
function bytesToBase64(bytes: Uint8Array): string {
  const binString = Array.from(bytes, (byte) =>
    String.fromCodePoint(byte)
  ).join('');
  return btoa(binString);
}

/**
 * Convert base64 string to Uint8Array
 */
function base64ToBytes(base64: string): Uint8Array {
  const binString = atob(base64);
  return Uint8Array.from(binString, (char) => char.codePointAt(0)!);
}

/**
 * Rondevu Username API
 * Handles username claiming with Ed25519 cryptographic proof
 */
export class RondevuUsername {
  constructor(private baseUrl: string) {}

  /**
   * Generates an Ed25519 keypair for username claiming
   */
  async generateKeypair(): Promise<{ publicKey: string; privateKey: string }> {
    const privateKey = ed25519.utils.randomSecretKey();
    const publicKey = await ed25519.getPublicKey(privateKey);

    return {
      publicKey: bytesToBase64(publicKey),
      privateKey: bytesToBase64(privateKey)
    };
  }

  /**
   * Signs a message with an Ed25519 private key
   */
  async signMessage(message: string, privateKeyBase64: string): Promise<string> {
    const privateKey = base64ToBytes(privateKeyBase64);
    const encoder = new TextEncoder();
    const messageBytes = encoder.encode(message);

    const signature = await ed25519.sign(messageBytes, privateKey);
    return bytesToBase64(signature);
  }

  /**
   * Claims a username
   * Generates a new keypair if one is not provided
   */
  async claimUsername(
    username: string,
    existingKeypair?: { publicKey: string; privateKey: string }
  ): Promise<UsernameClaimResult> {
    // Generate or use existing keypair
    const keypair = existingKeypair || await this.generateKeypair();

    // Create signed message
    const timestamp = Date.now();
    const message = `claim:${username}:${timestamp}`;
    const signature = await this.signMessage(message, keypair.privateKey);

    // Send claim request
    const response = await fetch(`${this.baseUrl}/usernames/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        publicKey: keypair.publicKey,
        signature,
        message
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to claim username');
    }

    const data = await response.json();

    return {
      username: data.username,
      publicKey: keypair.publicKey,
      privateKey: keypair.privateKey,
      claimedAt: data.claimedAt,
      expiresAt: data.expiresAt
    };
  }

  /**
   * Checks if a username is available
   */
  async checkUsername(username: string): Promise<UsernameCheckResult> {
    const response = await fetch(`${this.baseUrl}/usernames/${username}`);

    if (!response.ok) {
      throw new Error('Failed to check username');
    }

    const data = await response.json();

    return {
      username: data.username,
      available: data.available,
      claimedAt: data.claimedAt,
      expiresAt: data.expiresAt,
      publicKey: data.publicKey
    };
  }

  /**
   * Helper: Save keypair to localStorage
   * WARNING: This stores the private key in localStorage which is not the most secure
   * For production use, consider using IndexedDB with encryption or hardware security modules
   */
  saveKeypairToStorage(username: string, publicKey: string, privateKey: string): void {
    const data = { username, publicKey, privateKey, savedAt: Date.now() };
    localStorage.setItem(`rondevu:keypair:${username}`, JSON.stringify(data));
  }

  /**
   * Helper: Load keypair from localStorage
   */
  loadKeypairFromStorage(username: string): { publicKey: string; privateKey: string } | null {
    const stored = localStorage.getItem(`rondevu:keypair:${username}`);
    if (!stored) return null;

    try {
      const data = JSON.parse(stored);
      return { publicKey: data.publicKey, privateKey: data.privateKey };
    } catch {
      return null;
    }
  }

  /**
   * Helper: Delete keypair from localStorage
   */
  deleteKeypairFromStorage(username: string): void {
    localStorage.removeItem(`rondevu:keypair:${username}`);
  }

  /**
   * Export keypair as JSON string (for backup)
   */
  exportKeypair(publicKey: string, privateKey: string): string {
    return JSON.stringify({
      publicKey,
      privateKey,
      exportedAt: Date.now()
    });
  }

  /**
   * Import keypair from JSON string
   */
  importKeypair(json: string): { publicKey: string; privateKey: string } {
    const data = JSON.parse(json);
    if (!data.publicKey || !data.privateKey) {
      throw new Error('Invalid keypair format');
    }
    return { publicKey: data.publicKey, privateKey: data.privateKey };
  }
}
