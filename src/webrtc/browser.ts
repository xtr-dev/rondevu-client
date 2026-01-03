/**
 * Browser WebRTC adapter using native browser APIs
 */

import { WebRTCAdapter } from './adapter.js'

/**
 * Browser WebRTC implementation using native browser APIs
 * This is the default adapter for browser environments
 */
export class BrowserWebRTCAdapter implements WebRTCAdapter {
    createPeerConnection(config?: RTCConfiguration): RTCPeerConnection {
        return new RTCPeerConnection(config)
    }

    createIceCandidate(candidateInit: RTCIceCandidateInit): RTCIceCandidate {
        return new RTCIceCandidate(candidateInit)
    }
}
