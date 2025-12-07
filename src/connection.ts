import {ConnectionEvents, ConnectionInterface, Message, QueueMessageOptions, Signaler} from "./types";
import {EventBus} from "./event-bus";
import {createBin} from "./bin";

export class WebRTCRondevuConnection implements ConnectionInterface {
    private readonly connection: RTCPeerConnection;
    private readonly side: 'offer' | 'answer';
    public readonly expiresAt: number = 0;
    public readonly lastActive: number = 0;
    public readonly events: EventBus<ConnectionEvents> = new EventBus();
    private signaler!: Signaler; // Will be set by setSignaler()
    private readonly _ready: Promise<void>;
    private _state: ConnectionInterface['state'] = 'disconnected';
    private iceBin = createBin()

    constructor(
        public readonly id: string,
        public readonly host: string,
        public readonly service: string,
        offer?: RTCSessionDescriptionInit) {
        this.connection = new RTCPeerConnection();
        this.side = offer ? 'answer' : 'offer';
        const ready = offer
            ? this.connection.setRemoteDescription(offer)
                .then(() => this.connection.createAnswer())
                .then(answer => this.connection.setLocalDescription(answer))
            : this.connection.createOffer()
                .then(offer => this.connection.setLocalDescription(offer));
        this._ready = ready.then(() => this.setState('connecting'))
            .then(() => this.startIceListeners())
    }

    private setState(state: ConnectionInterface['state']) {
        this._state = state;
        this.events.emit('state-change', state);
    }

    private startIceListeners() {
        const listener = ({candidate}: {candidate: RTCIceCandidate | null}) => {
            if (candidate) this.signaler.addIceCandidate(candidate)
        }
        this.connection.addEventListener('icecandidate', listener)
        this.iceBin(
            this.signaler.addListener((candidate: RTCIceCandidate) => this.connection.addIceCandidate(candidate)),
            () => this.connection.removeEventListener('icecandidate', listener)
        )
    }

    private stopIceListeners() {
        this.iceBin.clean()
    }

    /**
     * Set the signaler for ICE candidate exchange
     * Must be called before connection is ready
     */
    setSignaler(signaler: Signaler): void {
        this.signaler = signaler;
    }

    get state() {
        return this._state;
    }

    get ready(): Promise<void> {
        return this._ready;
    }

    queueMessage(message: Message, options: QueueMessageOptions = {}): Promise<void> {
        return Promise.resolve(undefined);
    }

    sendMessage(message: Message): Promise<boolean> {
        return Promise.resolve(false);
    }
}