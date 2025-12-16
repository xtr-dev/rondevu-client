/**
 * Core signaling types
 */

/**
 * Cleanup function returned by listener methods
 */
export type Binnable = () => void

/**
 * Signaler interface for WebRTC offer/answer/ICE exchange
 */
export interface Signaler {
    addIceCandidate(candidate: RTCIceCandidate): Promise<void>
    addListener(callback: (candidate: RTCIceCandidate) => void): Binnable
    addOfferListener(callback: (offer: RTCSessionDescriptionInit) => void): Binnable
    addAnswerListener(callback: (answer: RTCSessionDescriptionInit) => void): Binnable
    setOffer(offer: RTCSessionDescriptionInit): Promise<void>
    setAnswer(answer: RTCSessionDescriptionInit): Promise<void>
}
