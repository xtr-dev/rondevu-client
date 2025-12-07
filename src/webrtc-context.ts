import { Signaler } from './types'

const DEFAULT_RTC_CONFIGURATION: RTCConfiguration = {
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
}

export class WebRTCContext {
    constructor(
        private readonly config?: RTCConfiguration
    ) {}

    createPeerConnection(): RTCPeerConnection {
        return new RTCPeerConnection(this.config || DEFAULT_RTC_CONFIGURATION)
    }
}
