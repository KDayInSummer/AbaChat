const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 3000;
const MAX_MESSAGE_LENGTH = 2000; // 最大消息长度 2000 字符
const MAX_MESSAGE_SIZE = 4096; // 最大消息体 4KB
const TYPING_TIMEOUT = 3000; // 输入指示器超时时间 3秒

// 房间管理
const rooms = new Map(); // roomPassword -> { users: Map<ws, { id, nickname }>, maxUsers: 2 }

// 心跳检测
const HEARTBEAT_INTERVAL = 30000; // 30秒
const HEARTBEAT_TIMEOUT = 10000; // 10秒超时

function getOrCreateRoom(password, mode = 'private') {
  const roomKey = `${mode}:${password}`;
  if (!rooms.has(roomKey)) {
    rooms.set(roomKey, {
      users: new Map(),
      maxUsers: mode === 'group' ? 10 : 2,
      mode: mode,
      nicknames: new Set(),
      typingUsers: new Map()
    });
  }
  return rooms.get(roomKey);
}

// 获取房间内所有用户列表
function getUserList(room) {
  return Array.from(room.users.values()).map(user => ({
    userId: user.id,
    nickname: user.nickname
  }));
}

function cleanupEmptyRooms() {
  for (const [roomKey, room] of rooms.entries()) {
    if (room.users.size === 0) {
      rooms.delete(roomKey);
    }
  }
}

function broadcastToRoom(room, message, excludeWs = null) {
  const data = JSON.stringify(message);
  for (const [ws] of room.users.entries()) {
    if (ws !== excludeWs && ws.readyState === 1) {
      ws.send(data);
    }
  }
}

// 创建 HTTP 服务器
const server = http.createServer((req, res) => {
  // 静态文件服务
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(__dirname, 'public', filePath);

  const ext = path.extname(filePath);
  const mimeTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.wav': 'audio/wav',
    '.mp4': 'video/mp4',
    '.woff': 'application/font-woff',
    '.ttf': 'application/font-ttf',
    '.eot': 'application/vnd.ms-fontobject',
    '.otf': 'application/font-otf',
    '.wasm': 'application/wasm'
  };

  const contentType = mimeTypes[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404);
        res.end('Not Found');
      } else {
        res.writeHead(500);
        res.end('Server Error');
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
});

// 创建 WebSocket 服务器
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  ws.nickname = null;
  ws.roomPassword = null;

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());

      switch (message.type) {
        case 'join': {
          const { password, nickname, mode } = message;
          const room = getOrCreateRoom(password, mode);

          // 检查房间是否已满
          if (room.users.size >= room.maxUsers) {
            ws.send(JSON.stringify({
              type: 'join_error',
              message: '房间已满，无法加入'
            }));
            return;
          }

          // 处理昵称
          let finalNickname = nickname || `用户${uuidv4().slice(0, 4)}`;
          
          // 检查昵称是否重复
          if (room.nicknames.has(finalNickname)) {
            // 自动追加数字后缀
            let suffix = 1;
            while (room.nicknames.has(`${finalNickname}_${suffix}`)) {
              suffix++;
            }
            finalNickname = `${finalNickname}_${suffix}`;
          }

          // 加入房间
          const userId = uuidv4();
          ws.nickname = finalNickname;
          ws.roomPassword = `${mode}:${password}`;
          ws.userId = userId;
          room.users.set(ws, { id: userId, nickname: ws.nickname });
          room.nicknames.add(finalNickname);

          // 通知当前用户加入成功
          ws.send(JSON.stringify({
            type: 'join_success',
            userId,
            nickname: ws.nickname,
            userCount: room.users.size,
            maxUsers: room.maxUsers,
            nicknameChanged: nickname && nickname !== finalNickname ? finalNickname : null,
            userList: getUserList(room) // 发送用户列表
          }));

          // 通知房间内其他用户
          if (room.users.size > 1) {
            broadcastToRoom(room, {
              type: 'user_joined',
              nickname: ws.nickname,
              userCount: room.users.size,
              userList: getUserList(room) // 更新用户列表
            }, ws);
          }
          break;
        }

        case 'chat_message': {
          if (!ws.roomPassword || !rooms.has(ws.roomPassword)) {
            return;
          }

          const room = rooms.get(ws.roomPassword);
          if (!room.users.has(ws)) {
            return;
          }

          // 验证消息长度
          const content = message.content || '';
          if (content.length > MAX_MESSAGE_LENGTH) {
            ws.send(JSON.stringify({
              type: 'error',
              message: `消息长度超过限制（${MAX_MESSAGE_LENGTH} 字符）`
            }));
            return;
          }

          // 确定消息类型
          const msgType = message.msgType || 'text'; // text, system, image, emoji
          const messageId = message.messageId || null;

          // 广播消息给房间内其他用户
          broadcastToRoom(room, {
            type: 'chat_message',
            userId: ws.userId,
            nickname: ws.nickname,
            content: content,
            msgType: msgType,
            messageId: messageId,
            timestamp: Date.now()
          }, ws);
          break;
        }

        case 'ping': {
          ws.isAlive = true;
          ws.send(JSON.stringify({ type: 'pong' }));
          break;
        }

        case 'leave': {
          handleDisconnect(ws);
          break;
        }

        case 'typing': {
          // 用户正在输入
          if (!ws.roomPassword || !rooms.has(ws.roomPassword)) {
            return;
          }
          const room = rooms.get(ws.roomPassword);
          if (!room.users.has(ws)) {
            return;
          }

          // 清除之前的超时
          if (room.typingUsers.has(ws)) {
            clearTimeout(room.typingUsers.get(ws));
          }

          // 广播输入指示器
          broadcastToRoom(room, {
            type: 'typing',
            userId: ws.userId,
            nickname: ws.nickname
          }, ws);

          // 设置超时，3秒后自动取消
          const timeoutId = setTimeout(() => {
            room.typingUsers.delete(ws);
            broadcastToRoom(room, {
              type: 'stop_typing',
              userId: ws.userId,
              nickname: ws.nickname
            }, ws);
          }, TYPING_TIMEOUT);

          room.typingUsers.set(ws, timeoutId);
          break;
        }

        case 'read_receipt': {
          // 消息已读回执
          if (!ws.roomPassword || !rooms.has(ws.roomPassword)) {
            return;
          }
          const room = rooms.get(ws.roomPassword);
          if (!room.users.has(ws)) {
            return;
          }

          // 转发给消息发送者
          broadcastToRoom(room, {
            type: 'read_receipt',
            readerId: ws.userId,
            readerNickname: ws.nickname,
            messageId: message.messageId
          }, ws);
          break;
        }
      }
    } catch (err) {
      console.error('Message parse error:', err);
    }
  });

  ws.on('close', () => {
    handleDisconnect(ws);
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
    handleDisconnect(ws);
  });
});

function handleDisconnect(ws) {
  if (ws.roomPassword && rooms.has(ws.roomPassword)) {
    const room = rooms.get(ws.roomPassword);

    if (room.users.has(ws)) {
      const userInfo = room.users.get(ws);
      room.users.delete(ws);
      room.nicknames.delete(userInfo.nickname); // 释放昵称
      
      // 清理 typing 状态
      if (room.typingUsers.has(ws)) {
        clearTimeout(room.typingUsers.get(ws));
        room.typingUsers.delete(ws);
      }

      // 通知房间内其他用户
      broadcastToRoom(room, {
        type: 'user_left',
        nickname: userInfo.nickname,
        userCount: room.users.size,
        userList: getUserList(room) // 更新用户列表
      });

      // 清理空房间
      cleanupEmptyRooms();
    }
  }
}

// 心跳检测
const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, HEARTBEAT_INTERVAL);

wss.on('close', () => {
  clearInterval(heartbeat);
});

// 启动服务器
server.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`  AbaChat 服务器已启动`);
  console.log(`  访问地址: http://localhost:${PORT}`);
  console.log(`========================================\n`);
});
