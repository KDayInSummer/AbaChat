// 全局状态
let ws = null;
let myNickname = '';
let myUserId = '';
let currentScreen = 'login';
let chatMode = 'private'; // 'private' 或 'group'
let maxUsers = 2;
let emojiPanelOpen = false;
let usersPanelOpen = false;
let onlineUsers = []; // 在线用户列表
let typingTimeout = null; // 输入指示器超时
let typingUsers = new Map(); // 正在输入的用户 { userId -> nickname }
let sentMessages = new Map(); // 已发送的消息 { messageId -> { content, timestamp, readBy: Set } }
let messageIdCounter = 0;

// 常用表情列表
const emojis = [
  '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂',
  '😊', '😇', '🙂', '😉', '😌', '😍', '🥰', '😘',
  '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪',
  '🤨', '🧐', '🤓', '😎', '🤩', '🥳', '😏', '😒',
  '😞', '😔', '😟', '😕', '🙁', '☹️', '😣', '😖',
  '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡',
  '👍', '👎', '👏', '🙏', '🤝', '💪', '✌️', '🤟',
  '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍',
  '🎉', '🎊', '🎈', '🎁', '🎂', '🎄', '🎆', '🎇',
  '✅', '❌', '⭐', '🌟', '💯', '🔥', '✨', '💫'
];

// DOM 元素
const screens = {
  login: document.getElementById('login-screen'),
  waiting: document.getElementById('waiting-screen'),
  chat: document.getElementById('chat-screen'),
  full: document.getElementById('full-screen')
};

const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const messageInput = document.getElementById('message-input');

// 切换屏幕
function showScreen(screenName) {
  Object.values(screens).forEach(screen => screen.classList.add('hidden'));
  screens[screenName].classList.remove('hidden');
  currentScreen = screenName;
}

// 显示登录错误
function showLoginError(message) {
  loginError.textContent = message;
  loginError.classList.add('show');
  setTimeout(() => {
    loginError.classList.remove('show');
  }, 3000);
}

// 格式化时间
function formatTime(timestamp) {
  const date = new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

// 转义 HTML 防止 XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 添加系统消息
function addSystemMessage(text) {
  const messageEl = document.createElement('div');
  messageEl.className = 'system-message';
  messageEl.textContent = text;
  chatMessages.appendChild(messageEl);
  scrollToBottom();
}

// 添加聊天消息
function addChatMessage(nickname, content, timestamp, isSelf, msgType = 'text', messageId = null) {
  const messageEl = document.createElement('div');
  messageEl.className = `message ${isSelf ? 'self' : 'other'}`;
  if (messageId) {
    messageEl.dataset.messageId = messageId;
  }

  const headerEl = document.createElement('div');
  headerEl.className = 'message-header';

  const nicknameEl = document.createElement('span');
  nicknameEl.className = 'message-nickname';
  nicknameEl.textContent = isSelf ? '我' : escapeHtml(nickname);

  const timeEl = document.createElement('span');
  timeEl.className = 'message-time';
  timeEl.textContent = formatTime(timestamp);

  headerEl.appendChild(nicknameEl);
  headerEl.appendChild(timeEl);

  const contentEl = document.createElement('div');
  contentEl.className = 'message-content';

  // 根据消息类型渲染不同内容
  if (msgType === 'emoji') {
    contentEl.innerHTML = `<span class="emoji-large">${content}</span>`;
  } else if (msgType === 'image') {
    contentEl.innerHTML = `<img src="${escapeHtml(content)}" alt="图片" loading="lazy">`;
  } else {
    contentEl.textContent = content;
  }

  messageEl.appendChild(headerEl);
  messageEl.appendChild(contentEl);

  // 如果是自己发送的消息，添加已读状态
  if (isSelf && messageId) {
    const readStatusEl = document.createElement('div');
    readStatusEl.className = 'message-read-status';
    readStatusEl.innerHTML = '<span class="read-mark">✓</span> 已发送';
    messageEl.appendChild(readStatusEl);
  }

  chatMessages.appendChild(messageEl);
  scrollToBottom();
  
  return messageEl;
}

// 滚动到底部
function scrollToBottom() {
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// 连接 WebSocket
function connect(password, nickname, mode) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('WebSocket connected');
    // 发送加入房间请求
    ws.send(JSON.stringify({
      type: 'join',
      password,
      nickname: nickname || '',
      mode: mode // 'private' 或 'group'
    }));
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleMessage(data);
    } catch (err) {
      console.error('Message parse error:', err);
    }
  };

  ws.onclose = (event) => {
    console.log('WebSocket closed:', event.code, event.reason);
    if (currentScreen === 'chat' || currentScreen === 'waiting') {
      addSystemMessage('连接已断开');
      setTimeout(() => {
        showScreen('login');
      }, 2000);
    }
  };

  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
  };
}

// 处理服务器消息
function handleMessage(data) {
  switch (data.type) {
    case 'join_success':
      myNickname = data.nickname;
      myUserId = data.userId;
      maxUsers = data.maxUsers;
      document.getElementById('my-nickname').textContent = myNickname;
      document.getElementById('max-users').textContent = maxUsers;

      // 如果昵称被修改，提示用户
      if (data.nicknameChanged) {
        addSystemMessage(`昵称已被修改为：${data.nicknameChanged}（原昵称已被占用）`);
      }

      // 更新在线用户列表
      if (data.userList) {
        updateUsersList(data.userList);
      }

      if (data.userCount === 1) {
        // 房间内只有我一人，显示等待界面
        showScreen('waiting');
        document.getElementById('current-users').textContent = '1';
        const waitText = chatMode === 'private' 
          ? '你已进入聊天室，等待另一人加入...' 
          : '你已进入聊天室，等待其他人加入...';
        addSystemMessage(waitText);
      } else {
        // 房间内已有人，直接进入聊天
        showScreen('chat');
        addSystemMessage(`${myNickname} 加入了聊天室`);
      }
      break;

    case 'join_error':
      showLoginError(data.message);
      showScreen('login');
      break;

    case 'user_joined':
      // 有人加入了聊天室
      showScreen('chat');
      document.getElementById('current-users').textContent = data.userCount;
      addSystemMessage(`${data.nickname} 加入了聊天室`);
      
      // 更新在线用户列表
      if (data.userList) {
        updateUsersList(data.userList);
      }
      break;

    case 'user_left':
      // 有人离开了聊天室
      document.getElementById('current-users').textContent = data.userCount;
      addSystemMessage(`${data.nickname} 离开了聊天室`);
      
      // 更新在线用户列表
      if (data.userList) {
        updateUsersList(data.userList);
      }
      
      if (data.userCount === 1 && chatMode === 'private') {
        // 一对一模式只剩我一人，切换到等待界面
        setTimeout(() => {
          showScreen('waiting');
        }, 2000);
      }
      break;

    case 'chat_message':
      // 收到聊天消息
      const isSelf = data.userId === myUserId;
      addChatMessage(data.nickname, data.content, data.timestamp, isSelf, data.msgType, data.messageId);
      
      // 如果不是自己发送的消息，发送已读回执
      if (!isSelf && data.messageId) {
        sendReadReceipt(data.messageId);
      }
      break;

    case 'typing':
      // 对方正在输入
      showTypingIndicator(data.userId, data.nickname);
      break;

    case 'stop_typing':
      // 对方停止输入
      hideTypingIndicator(data.userId);
      break;

    case 'read_receipt':
      // 消息被已读
      updateMessageReadStatus(data.messageId, data.readerNickname);
      break;

    case 'pong':
      // 心跳响应
      break;
  }
}

// 发送消息
function sendMessage(content, msgType = 'text') {
  if (!content.trim() || !ws || ws.readyState !== WebSocket.OPEN) {
    return;
  }

  // 如果只包含单个emoji，自动设置为emoji类型
  const trimmedContent = content.trim();
  let finalMsgType = msgType;
  if (msgType === 'text' && /^[\p{Emoji}]{1,2}$/u.test(trimmedContent)) {
    finalMsgType = 'emoji';
  }

  // 生成消息ID
  const messageId = `msg_${++messageIdCounter}_${Date.now()}`;

  ws.send(JSON.stringify({
    type: 'chat_message',
    content: trimmedContent,
    msgType: finalMsgType,
    messageId: messageId
  }));

  // 记录已发送的消息
  sentMessages.set(messageId, {
    content: trimmedContent,
    timestamp: Date.now(),
    readBy: new Set()
  });

  // 立即在自己的界面显示
  addChatMessage(myNickname, trimmedContent, Date.now(), true, finalMsgType, messageId);
  
  // 停止输入指示器
  hideMyTyping();
}

// 输入指示器相关
function showTypingIndicator(userId, nickname) {
  typingUsers.set(userId, nickname);
  updateTypingDisplay();
}

function hideTypingIndicator(userId) {
  typingUsers.delete(userId);
  updateTypingDisplay();
}

function updateTypingDisplay() {
  const indicator = document.getElementById('typing-indicator');
  const typingText = document.getElementById('typing-text');
  
  if (typingUsers.size === 0) {
    indicator.classList.add('hidden');
  } else {
    indicator.classList.remove('hidden');
    const names = Array.from(typingUsers.values());
    if (names.length === 1) {
      typingText.textContent = `${names[0]} 正在输入...`;
    } else if (names.length === 2) {
      typingText.textContent = `${names[0]} 和 ${names[1]} 正在输入...`;
    } else {
      typingText.textContent = `${names.length} 人正在输入...`;
    }
  }
}

let isTyping = false;
function notifyTyping() {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return;
  }
  
  if (!isTyping) {
    isTyping = true;
    ws.send(JSON.stringify({
      type: 'typing'
    }));
  }
  
  // 清除之前的超时
  if (typingTimeout) {
    clearTimeout(typingTimeout);
  }
  
  // 3秒后停止输入
  typingTimeout = setTimeout(() => {
    hideMyTyping();
  }, 3000);
}

function hideMyTyping() {
  isTyping = false;
  if (typingTimeout) {
    clearTimeout(typingTimeout);
    typingTimeout = null;
  }
}

// 已读回执
function sendReadReceipt(messageId) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return;
  }
  
  ws.send(JSON.stringify({
    type: 'read_receipt',
    messageId: messageId
  }));
}

function updateMessageReadStatus(messageId, readerNickname) {
  // 更新本地记录
  if (sentMessages.has(messageId)) {
    sentMessages.get(messageId).readBy.add(readerNickname);
  }
  
  // 更新 UI
  const messageEl = chatMessages.querySelector(`[data-message-id="${messageId}"]`);
  if (messageEl) {
    const readStatusEl = messageEl.querySelector('.message-read-status');
    if (readStatusEl) {
      readStatusEl.innerHTML = `<span class="read-mark">✓✓</span> 已被 ${escapeHtml(readerNickname)} 阅读`;
    }
  }
}

// 离开聊天室
function leaveRoom() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'leave' }));
    ws.close();
  }
  showScreen('login');
  chatMessages.innerHTML = '<div class="system-message" id="welcome-message">欢迎进入聊天室，请友好交流</div>';
  messageInput.value = '';
  closeEmojiPanel();
}

// 表情面板相关功能
function initEmojiPanel() {
  const emojiGrid = document.getElementById('emoji-grid');
  
  emojis.forEach(emoji => {
    const emojiItem = document.createElement('div');
    emojiItem.className = 'emoji-item';
    emojiItem.textContent = emoji;
    emojiItem.addEventListener('click', () => {
      // 点击表情直接发送
      sendMessage(emoji, 'emoji');
      closeEmojiPanel();
    });
    emojiGrid.appendChild(emojiItem);
  });
}

function toggleEmojiPanel() {
  const panel = document.getElementById('emoji-panel');
  emojiPanelOpen = !emojiPanelOpen;
  if (emojiPanelOpen) {
    panel.classList.remove('hidden');
  } else {
    panel.classList.add('hidden');
  }
}

function closeEmojiPanel() {
  const panel = document.getElementById('emoji-panel');
  emojiPanelOpen = false;
  panel.classList.add('hidden');
}

// 在线用户列表面板
function toggleUsersPanel() {
  const panel = document.getElementById('users-panel');
  usersPanelOpen = !usersPanelOpen;
  if (usersPanelOpen) {
    panel.classList.remove('hidden');
  } else {
    panel.classList.add('hidden');
  }
}

function updateUsersList(userList) {
  onlineUsers = userList;
  const usersList = document.getElementById('users-list');
  const onlineCount = document.getElementById('online-count');
  
  // 更新在线人数
  onlineCount.textContent = onlineUsers.length;
  
  // 清空列表
  usersList.innerHTML = '';
  
  // 渲染用户列表
  onlineUsers.forEach(user => {
    const userItem = document.createElement('li');
    const isSelf = user.userId === myUserId;
    userItem.className = `user-item ${isSelf ? 'self' : ''}`;
    
    // 获取用户首字母作为头像
    const initial = user.nickname.charAt(0).toUpperCase();
    
    userItem.innerHTML = `
      <div class="user-avatar">${initial}</div>
      <div class="user-name">${escapeHtml(user.nickname)}${isSelf ? ' (我)' : ''}</div>
    `;
    
    usersList.appendChild(userItem);
  });
}

// 初始化
initEmojiPanel();

// 事件监听
loginForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const password = document.getElementById('room-password').value.trim();
  const nickname = document.getElementById('nickname').value.trim();
  const modeRadio = document.querySelector('input[name="chat-mode"]:checked');
  chatMode = modeRadio.value;

  if (!password) {
    showLoginError('请输入房间口令');
    return;
  }

  loginError.classList.remove('show');
  connect(password, nickname, chatMode);
});

chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const content = messageInput.value.trim();
  sendMessage(content);
  messageInput.value = '';
  messageInput.focus();
});

document.getElementById('leave-btn').addEventListener('click', leaveRoom);
document.getElementById('chat-leave-btn').addEventListener('click', leaveRoom);
document.getElementById('back-btn').addEventListener('click', () => {
  showScreen('login');
});
document.getElementById('emoji-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  toggleEmojiPanel();
});
document.getElementById('toggle-users-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  toggleUsersPanel();
});

// 点击其他地方关闭表情面板
document.addEventListener('click', (e) => {
  const panel = document.getElementById('emoji-panel');
  const btn = document.getElementById('emoji-btn');
  if (emojiPanelOpen && !panel.contains(e.target) && e.target !== btn) {
    closeEmojiPanel();
  }
});

// 页面关闭时清理
window.addEventListener('beforeunload', () => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'leave' }));
  }
});

// 心跳检测
setInterval(() => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'ping' }));
  }
}, 30000);

// 回车发送消息
messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    chatForm.dispatchEvent(new Event('submit'));
  }
});

// 输入时触发 typing 通知
messageInput.addEventListener('input', () => {
  if (messageInput.value.trim()) {
    notifyTyping();
  } else {
    hideMyTyping();
  }
});

// 输入框获得焦点时也触发
messageInput.addEventListener('focus', () => {
  if (messageInput.value.trim()) {
    notifyTyping();
  }
});
