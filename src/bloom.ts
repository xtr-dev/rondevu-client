// Declare Buffer for Node.js compatibility
declare const Buffer: any;

/**
 * Simple bloom filter implementation for peer ID exclusion
 * Uses multiple hash functions for better distribution
 */
export class BloomFilter {
  private bits: Uint8Array;
  private size: number;
  private numHashes: number;

  constructor(size: number = 1024, numHashes: number = 3) {
    this.size = size;
    this.numHashes = numHashes;
    this.bits = new Uint8Array(Math.ceil(size / 8));
  }

  /**
   * Add a peer ID to the filter
   */
  add(peerId: string): void {
    for (let i = 0; i < this.numHashes; i++) {
      const hash = this.hash(peerId, i);
      const index = hash % this.size;
      const byteIndex = Math.floor(index / 8);
      const bitIndex = index % 8;
      this.bits[byteIndex] |= 1 << bitIndex;
    }
  }

  /**
   * Test if peer ID might be in the filter
   */
  test(peerId: string): boolean {
    for (let i = 0; i < this.numHashes; i++) {
      const hash = this.hash(peerId, i);
      const index = hash % this.size;
      const byteIndex = Math.floor(index / 8);
      const bitIndex = index % 8;
      if (!(this.bits[byteIndex] & (1 << bitIndex))) {
        return false;
      }
    }
    return true;
  }

  /**
   * Get raw bits for transmission
   */
  toBytes(): Uint8Array {
    return this.bits;
  }

  /**
   * Convert to base64 for URL parameters
   */
  toBase64(): string {
    // Convert Uint8Array to regular array then to string
    const binaryString = String.fromCharCode(...Array.from(this.bits));
    // Use btoa for browser, or Buffer for Node.js
    if (typeof btoa !== 'undefined') {
      return btoa(binaryString);
    } else if (typeof Buffer !== 'undefined') {
      return Buffer.from(this.bits).toString('base64');
    } else {
      // Fallback: manual base64 encoding
      throw new Error('No base64 encoding available');
    }
  }

  /**
   * Simple hash function (FNV-1a variant)
   */
  private hash(str: string, seed: number): number {
    let hash = 2166136261 ^ seed;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return hash >>> 0;
  }
}
