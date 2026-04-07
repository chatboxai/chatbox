# WebSocket Patterns Reference

## Rooms and Namespaces

### Rooms (Channel Grouping)

```javascript
const io = require('socket.io')(3000);

io.on('connection', (socket) => {
  // Join a room
  socket.on('join-room', (roomId) => {
    socket.join(roomId);
    socket.emit('joined', { room: roomId });

    // Notify others in room
    socket.to(roomId).emit('user-joined', {
      userId: socket.id,
      timestamp: Date.now()
    });
  });

  // Leave a room
  socket.on('leave-room', (roomId) => {
    socket.leave(roomId);
    socket.to(roomId).emit('user-left', { userId: socket.id });
  });

  // Send to specific room
  socket.on('message', ({ roomId, text }) => {
    io.to(roomId).emit('message', {
      userId: socket.id,
      text,
      timestamp: Date.now()
    });
  });

  // Get all rooms a socket is in
  console.log('Socket rooms:', socket.rooms); // Set { socketId, roomId1, roomId2 }

  // Disconnect from all rooms
  socket.on('disconnect', () => {
    // Automatically leaves all rooms
  });
});

// Broadcast to all sockets in a room
io.to('room123').emit('announcement', 'Hello room!');

// Broadcast to multiple rooms
io.to('room1').to('room2').emit('multi-room', 'data');

// Broadcast to room except specific socket
socket.to('room123').emit('message', 'Others see this');

// Get all sockets in a room
const sockets = await io.in('room123').fetchSockets();
console.log(`Room has ${sockets.length} connections`);
```

### Namespaces (Logical Separation)

```javascript
// Admin namespace
const adminNs = io.of('/admin');
adminNs.on('connection', (socket) => {
  console.log('Admin connected:', socket.id);

  socket.on('admin-action', (data) => {
    // Admin-only events
  });
});

// Chat namespace
const chatNs = io.of('/chat');
chatNs.on('connection', (socket) => {
  console.log('Chat user connected:', socket.id);

  socket.on('message', (msg) => {
    chatNs.emit('message', msg); // Broadcast to all in /chat
  });
});

// Dynamic namespaces
io.of(/^\/workspace-\d+$/).on('connection', (socket) => {
  const namespace = socket.nsp;
  console.log(`Connected to ${namespace.name}`);

  socket.on('message', (data) => {
    namespace.emit('message', data);
  });
});
```

## Broadcasting Patterns

```javascript
// Broadcast to everyone including sender
io.emit('event', data);

// Broadcast to everyone except sender
socket.broadcast.emit('event', data);

// Broadcast to specific room
io.to('room1').emit('event', data);

// Broadcast to room except sender
socket.to('room1').emit('event', data);

// Broadcast to multiple rooms
io.to('room1').to('room2').emit('event', data);

// Broadcast to all connected clients in namespace
io.of('/namespace').emit('event', data);

// Volatile messages (ok to drop if client not ready)
socket.volatile.emit('high-frequency', data);

// Broadcast with acknowledgment (to all clients)
io.timeout(5000).emit('event', data, (err, responses) => {
  if (err) {
    console.log('Some clients did not acknowledge');
  } else {
    console.log('All clients acknowledged:', responses);
  }
});
```

## Acknowledgments

```javascript
// Server expects acknowledgment
socket.emit('question', 'Do you agree?', (answer) => {
  console.log('Client answered:', answer);
});

// Client sends acknowledgment
socket.on('question', (data, callback) => {
  console.log('Server asked:', data);
  callback('Yes, I agree');
});

// Timeout for acknowledgment
socket.timeout(5000).emit('request', data, (err, response) => {
  if (err) {
    console.log('Client did not acknowledge in time');
  } else {
    console.log('Got response:', response);
  }
});

// Error handling in acknowledgment
socket.on('save-data', (data, callback) => {
  try {
    saveToDatabase(data);
    callback({ success: true });
  } catch (error) {
    callback({ success: false, error: error.message });
  }
});
```

## Presence System

```javascript
const redis = require('ioredis');
const redisClient = new redis();

class PresenceManager {
  async userConnected(userId, socketId) {
    const key = `user:${userId}:sockets`;

    // Add socket to user's socket set
    await redisClient.sadd(key, socketId);

    // Set TTL to auto-cleanup stale connections
    await redisClient.expire(key, 3600);

    // Get total connections for user
    const socketCount = await redisClient.scard(key);

    // If first connection, mark user as online
    if (socketCount === 1) {
      await redisClient.hset('presence', userId, JSON.stringify({
        status: 'online',
        lastSeen: Date.now()
      }));

      // Notify friends
      const friends = await this.getUserFriends(userId);
      friends.forEach(friendId => {
        io.to(`user:${friendId}`).emit('presence', {
          userId,
          status: 'online'
        });
      });
    }

    return socketCount;
  }

  async userDisconnected(userId, socketId) {
    const key = `user:${userId}:sockets`;

    // Remove socket from set
    await redisClient.srem(key, socketId);

    const socketCount = await redisClient.scard(key);

    // If no more connections, mark offline
    if (socketCount === 0) {
      await redisClient.hset('presence', userId, JSON.stringify({
        status: 'offline',
        lastSeen: Date.now()
      }));

      const friends = await this.getUserFriends(userId);
      friends.forEach(friendId => {
        io.to(`user:${friendId}`).emit('presence', {
          userId,
          status: 'offline',
          lastSeen: Date.now()
        });
      });
    }

    return socketCount;
  }

  async getUserStatus(userId) {
    const data = await redisClient.hget('presence', userId);
    return data ? JSON.parse(data) : { status: 'offline' };
  }

  async getBulkPresence(userIds) {
    const pipeline = redisClient.pipeline();
    userIds.forEach(id => pipeline.hget('presence', id));

    const results = await pipeline.exec();
    return userIds.map((id, i) => ({
      userId: id,
      ...JSON.parse(results[i][1] || '{"status":"offline"}')
    }));
  }
}

// Usage
const presence = new PresenceManager();

io.on('connection', async (socket) => {
  const userId = socket.handshake.auth.userId;

  await presence.userConnected(userId, socket.id);
  socket.join(`user:${userId}`);

  socket.on('disconnect', async () => {
    await presence.userDisconnected(userId, socket.id);
  });

  // Get presence for user's friends
  socket.on('get-presence', async (friendIds, callback) => {
    const presenceData = await presence.getBulkPresence(friendIds);
    callback(presenceData);
  });
});
```

## Message Queue Pattern

```javascript
// Queue messages when client disconnected
const messageQueue = new Map();

io.on('connection', (socket) => {
  const userId = socket.handshake.auth.userId;

  // Deliver queued messages on connect
  const queuedMessages = messageQueue.get(userId) || [];
  if (queuedMessages.length > 0) {
    socket.emit('queued-messages', queuedMessages);
    messageQueue.delete(userId);
  }

  socket.on('disconnect', () => {
    // Mark user as disconnected
    setTimeout(() => {
      const userSockets = io.sockets.sockets;
      const hasOtherConnection = Array.from(userSockets.values())
        .some(s => s.handshake.auth.userId === userId);

      if (!hasOtherConnection) {
        // User fully disconnected, queue new messages
        messageQueue.set(userId, []);
      }
    }, 1000);
  });
});

// Queue message if user offline
async function sendMessage(userId, message) {
  const userOnline = await isUserOnline(userId);

  if (userOnline) {
    io.to(`user:${userId}`).emit('message', message);
  } else {
    const queue = messageQueue.get(userId) || [];
    queue.push(message);
    messageQueue.set(userId, queue);

    // Persist to database for longer-term storage
    await saveMessageToDb(userId, message);
  }
}
```

## Pub/Sub Pattern

```javascript
const EventEmitter = require('events');

class MessageBus extends EventEmitter {
  constructor(io, redis) {
    super();
    this.io = io;
    this.redis = redis;
    this.setupSubscriptions();
  }

  setupSubscriptions() {
    // Subscribe to Redis channels
    this.redis.psubscribe('room:*', (err, count) => {
      console.log(`Subscribed to ${count} channels`);
    });

    this.redis.on('pmessage', (pattern, channel, message) => {
      const data = JSON.parse(message);
      const roomId = channel.split(':')[1];

      // Emit to Socket.IO room
      this.io.to(roomId).emit(data.event, data.payload);
    });
  }

  publish(roomId, event, payload) {
    // Publish to Redis (distributed across servers)
    this.redis.publish(
      `room:${roomId}`,
      JSON.stringify({ event, payload })
    );
  }
}

// Usage
const messageBus = new MessageBus(io, redisClient);

io.on('connection', (socket) => {
  socket.on('send-message', ({ roomId, text }) => {
    // Publish to all servers via Redis
    messageBus.publish(roomId, 'message', {
      userId: socket.id,
      text,
      timestamp: Date.now()
    });
  });
});
```

## Backpressure Handling

```javascript
io.on('connection', (socket) => {
  const MAX_BUFFER_SIZE = 10000;
  let bufferSize = 0;

  const originalEmit = socket.emit.bind(socket);

  socket.emit = function(event, ...args) {
    bufferSize++;

    if (bufferSize > MAX_BUFFER_SIZE) {
      console.warn('Buffer overflow, dropping message');
      return false;
    }

    const result = originalEmit(event, ...args);

    // Track buffer drain
    socket.once('drain', () => {
      bufferSize = 0;
    });

    return result;
  };

  // Monitor buffer size
  socket.on('drain', () => {
    console.log('Socket buffer drained');
  });
});
```
