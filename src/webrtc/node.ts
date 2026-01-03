/**
 * Node.js WebRTC adapter using polyfills like `wrtc`
 */

import { WebRTCAdapter } from './adapter.js'

export interface NodeWebRTCPolyfills {
    RTCPeerConnection: typeof RTCPeerConnection
    RTCIceCandidate: typeof RTCIceCandidate
}

/**
 * Node.js WebRTC implementation using polyfills
 *
 * @example
 * ```typescript
 * import wrtc from 'wrtc'
 *
 * const adapter = new NodeWebRTCAdapter({
 *   RTCPeerConnection: wrtc.RTCPeerConnection,
 *   RTCIceCandidate: wrtc.RTCIceCandidate,
 * })
 *
 * const rondevu = await Rondevu.connect({
 *   apiUrl: 'https://api.ronde.vu',
 *   webrtcAdapter: adapter,
 * })
 * ```
 */
export class NodeWebRTCAdapter implements WebRTCAdapter {
    private readonly polyfills: NodeWebRTCPolyfills

    constructor(polyfills: NodeWebRTCPolyfills) {
        this.polyfills = polyfills
    }

    createPeerConnection(config?: RTCConfiguration): RTCPeerConnection {
        return new this.polyfills.RTCPeerConnection(config)
    }

    createIceCandidate(candidateInit: RTCIceCandidateInit): RTCIceCandidate {
        return new this.polyfills.RTCIceCandidate(candidateInit)
    }
}
