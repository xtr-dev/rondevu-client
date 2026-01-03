/**
 * WebRTC adapter interface for platform-independent WebRTC operations
 * Allows using native browser APIs or polyfills like `wrtc` for Node.js
 */

/**
 * Platform-independent WebRTC adapter interface
 * Implementations provide platform-specific WebRTC constructors
 */
export interface WebRTCAdapter {
    /**
     * Create a new RTCPeerConnection
     * @param config - RTCConfiguration for the peer connection
     * @returns A new RTCPeerConnection instance
     */
    createPeerConnection(config?: RTCConfiguration): RTCPeerConnection

    /**
     * Create a new RTCIceCandidate
     * @param candidateInit - RTCIceCandidateInit to create the candidate from
     * @returns A new RTCIceCandidate instance
     */
    createIceCandidate(candidateInit: RTCIceCandidateInit): RTCIceCandidate
}
