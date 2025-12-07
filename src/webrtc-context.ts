import { Signaler } from './types'

export class WebRTCContext {
    constructor(public readonly signaler: Signaler) {}

    createPeerConnection(): RTCPeerConnection {
        return new RTCPeerConnection({
            iceServers: [
                {
                    urls: 'stun:stun.relay.metered.ca:80',
                },
                {
                    urls: 'turn:standard.relay.metered.ca:80',
                    username: 'c53a9c971da5e6f3bc959d8d',
                    credential: 'QaccPqtPPaxyokXp',
                },
                {
                    urls: 'turn:standard.relay.metered.ca:80?transport=tcp',
                    username: 'c53a9c971da5e6f3bc959d8d',
                    credential: 'QaccPqtPPaxyokXp',
                },
                {
                    urls: 'turn:standard.relay.metered.ca:443',
                    username: 'c53a9c971da5e6f3bc959d8d',
                    credential: 'QaccPqtPPaxyokXp',
                },
                {
                    urls: 'turns:standard.relay.metered.ca:443?transport=tcp',
                    username: 'c53a9c971da5e6f3bc959d8d',
                    credential: 'QaccPqtPPaxyokXp',
                },
            ],
        })
    }
}
