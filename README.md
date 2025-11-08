# Rondevu

🎯 **Simple WebRTC peer signaling and discovery**

Meet peers by topic, by peer ID, or by connection ID.

**Related repositories:**
- [rondevu-server](https://github.com/xtr-dev/rondevu-server) - HTTP signaling server

---

## @xtr-dev/rondevu-client

[![npm version](https://img.shields.io/npm/v/@xtr-dev/rondevu-client)](https://www.npmjs.com/package/@xtr-dev/rondevu-client)

TypeScript client library for Rondevu peer signaling and WebRTC connection management. Handles automatic signaling, ICE candidate exchange, and connection establishment.

### Install

```bash
npm install @xtr-dev/rondevu-client
```

### Usage

```typescript
import { Rondevu } from '@xtr-dev/rondevu-client';

const rdv = new Rondevu({ 
  baseUrl: 'https://server.com',
  rtcConfig: {
    iceServers: [
      // your ICE servers here
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      {
        urls: 'turn:relay1.example.com:3480',
        username: 'example',
        credential: 'example'
      }
    ]
  }
});

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
