/**
 * ICE Configuration Types and Presets
 *
 * Provides typed ICE server presets for common WebRTC configurations.
 */

/**
 * Available ICE server preset names
 */
export type IceServerPreset = 'rondevu' | 'rondevu-relay' | 'google-stun' | 'public-stun'

/**
 * ICE preset configuration containing servers and optional transport policy.
 * The iceTransportPolicy belongs on RTCConfiguration, not RTCIceServer.
 */
export interface IcePresetConfig {
    iceServers: RTCIceServer[]
    iceTransportPolicy?: RTCIceTransportPolicy // 'all' | 'relay'
}

/**
 * Pre-configured ICE server presets.
 *
 * - `rondevu`: Official Rondevu TURN/STUN servers (recommended)
 * - `rondevu-relay`: Same as rondevu but forces relay mode (hides client IPs)
 * - `google-stun`: Google's free STUN servers (no relay, direct connections only)
 * - `public-stun`: Multiple public STUN servers for redundancy
 */
export const ICE_SERVER_PRESETS: Record<IceServerPreset, IcePresetConfig> = {
    rondevu: {
        iceServers: [
            { urls: 'stun:relay.ronde.vu:3478' },
            {
                urls: [
                    'turns:relay.ronde.vu:5349?transport=tcp',
                    'turn:relay.ronde.vu:3478?transport=tcp',
                    'turn:relay.ronde.vu:3478?transport=udp',
                ],
                username: 'rondevu',
                credential: 'rondevu-public-turn',
            },
        ],
    },
    'rondevu-relay': {
        iceServers: [
            { urls: 'stun:relay.ronde.vu:3478' },
            {
                urls: [
                    'turns:relay.ronde.vu:5349?transport=tcp',
                    'turn:relay.ronde.vu:3478?transport=tcp',
                    'turn:relay.ronde.vu:3478?transport=udp',
                ],
                username: 'rondevu',
                credential: 'rondevu-public-turn',
            },
        ],
        iceTransportPolicy: 'relay', // Force relay mode - hides client IPs
    },
    'google-stun': {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
        ],
    },
    'public-stun': {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun.cloudflare.com:3478' },
            { urls: 'stun:stun.relay.metered.ca:80' },
        ],
    },
}

/**
 * Get the full RTCConfiguration for a preset or custom ICE servers.
 *
 * @param iceServers - Either a preset name or custom ICE servers array
 * @returns Partial RTCConfiguration with iceServers and optional iceTransportPolicy
 */
export function getIceConfiguration(
    iceServers?: IceServerPreset | RTCIceServer[]
): Pick<RTCConfiguration, 'iceServers' | 'iceTransportPolicy'> {
    if (typeof iceServers === 'string') {
        const preset = ICE_SERVER_PRESETS[iceServers]
        return {
            iceServers: preset.iceServers,
            iceTransportPolicy: preset.iceTransportPolicy,
        }
    }

    // Default to rondevu preset if no ICE servers specified
    if (!iceServers) {
        const preset = ICE_SERVER_PRESETS.rondevu
        return {
            iceServers: preset.iceServers,
            iceTransportPolicy: preset.iceTransportPolicy,
        }
    }

    return { iceServers }
}
