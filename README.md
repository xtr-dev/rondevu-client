# Rondevu

🎯 Meet WebRTC peers by topic, by peer ID, or by connection ID.

## @xtr-dev/rondevu-client

Rondevu HTTP and WebRTC client, for simple peer discovery and connection.

### Install

```bash
npm install @xtr-dev/rondevu-client
```

### Usage

```typescript
import { Rondevu } from '@xtr-dev/rondevu-client';

const rdv = new Rondevu({ baseUrl: 'https://server.com' });

// Connect by topic
const conn = await rdv.join('room');

// Or connect by ID
const conn = await rdv.connect('meeting-123');

// Use the connection
conn.on('connect', () => {
  const channel = conn.dataChannel('chat');
  channel.send('Hello!');
});
```

### API

**Main Methods:**
- `rdv.join(topic)` - Auto-connect to first peer in topic
- `rdv.join(topic, {filter})` - Connect to specific peer by ID
- `rdv.create(id, topic)` - Create connection for others to join
- `rdv.connect(id)` - Join connection by ID

**Connection Events:**
- `connect` - Connection established
- `disconnect` - Connection closed
- `datachannel` - Remote peer created data channel
- `stream` - Remote media stream received
- `error` - Error occurred

**Connection Methods:**
- `conn.dataChannel(label)` - Get or create data channel
- `conn.addStream(stream)` - Add media stream
- `conn.getPeerConnection()` - Get underlying RTCPeerConnection
- `conn.close()` - Close connection

### License

MIT
