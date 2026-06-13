// ============ НОВЫЕ ФУНКЦИИ ДЛЯ ПСЕВДОНИМОВ ============

// Кэш псевдонимов (чтобы не ходить на сервер каждый раз)
let displayNameCache = new Map();

// Получить псевдоним пользователя по username
async function getDisplayName(username) {
  // Проверяем кэш
  if (displayNameCache.has(username)) {
    return displayNameCache.get(username);
  }
  
  try {
    const response = await apiRequest(`/api/user_info/${username}`, 'GET');
    const data = await response.json();
    const displayName = data.display_name || username;
    displayNameCache.set(username, displayName);
    return displayName;
  } catch (error) {
    console.error('Failed to get display name:', error);
    return username; // fallback на username
  }
}

// Получить псевдоним по ID
async function getDisplayNameById(userId) {
  if (displayNameCache.has(`id:${userId}`)) {
    return displayNameCache.get(`id:${userId}`);
  }
  
  try {
    const response = await apiRequest(`/api/user_info_by_id/${userId}`, 'GET');
    const data = await response.json();
    const displayName = data.display_name || data.username;
    displayNameCache.set(`id:${userId}`, displayName);
    return displayName;
  } catch (error) {
    console.error('Failed to get display name by id:', error);
    return userId;
  }
}

// Сменить свой псевдоним
async function changeMyDisplayName(newDisplayName) {
  if (!newDisplayName || newDisplayName.length < 1 || newDisplayName.length > 50) {
    alert('Имя должно быть от 1 до 50 символов');
    return false;
  }
  
  try {
    const response = await apiRequest('/api/change_display_name', 'POST', {
      newDisplayName: newDisplayName
    });
    const data = await response.json();
    if (data.success) {
      // Обновляем локальное хранилище
      currentUserDisplayName = newDisplayName;
      localStorage.setItem('speak_displayName', newDisplayName);
      // Очищаем кэш
      displayNameCache.clear();
      // Обновляем заголовок
      updateHeader();
      return true;
    }
    return false;
  } catch (error) {
    console.error('Change display name error:', error);
    alert('Ошибка при смене имени');
    return false;
  }
}

// Обновляем функцию loadMessages для работы с псевдонимами
async function loadMessages() {
  try {
    const response = await apiRequest('/api/messages', 'GET');
    const messages = await response.json();
    
    const decryptedMessages = [];
    for (const msg of messages) {
      try {
        const senderPubRes = await apiRequest(`/api/public_key/${msg.sender_username}`, 'GET');
        const senderData = await senderPubRes.json();
        const decryptedText = await decryptMessage(
          msg.encrypted_payload,
          msg.nonce,
          senderData.public_key,
          privateKey
        );
        
        // Получаем псевдоним отправителя
        const senderDisplayName = msg.sender_display_name || msg.sender_username;
        
        decryptedMessages.push({
          text: decryptedText,
          isOwn: msg.sender_username === currentUsername,
          senderUsername: msg.sender_username,
          senderDisplayName: senderDisplayName,
          timestamp: msg.timestamp
        });
      } catch(e) {
        decryptedMessages.push({
          text: "[🔒 Зашифровано]",
          isOwn: false,
          senderUsername: msg.sender_username,
          senderDisplayName: msg.sender_display_name || msg.sender_username
        });
      }
    }
    return decryptedMessages;
  } catch (error) {
    console.error('Load messages error:', error);
    return [];
  }
}

// Обновляем функцию регистрации
async function register(username, password, displayName) {
  try {
    const keys = await generateKeys();
    
    const response = await apiRequest('/api/register', 'POST', {
      username,
      password,
      displayName: displayName || username,  // если не указан, используем username
      publicKey: keys.publicKey,
      signaturePublicKey: keys.signPublicKey,
      signaturePrivateKey: keys.signPrivateKey
    });
    
    const data = await response.json();
    if (data.success) {
      authToken = data.token;
      currentUserId = data.userId;
      currentUsername = data.username;
      currentUserDisplayName = data.displayName || data.username;
      privateKey = keys.privateKey;
      signaturePrivateKey = keys.signPrivateKey;
      
      localStorage.setItem('speak_token', authToken);
      localStorage.setItem('speak_username', currentUsername);
      localStorage.setItem('speak_displayName', currentUserDisplayName);
      localStorage.setItem('speak_userId', currentUserId);
      localStorage.setItem('speak_privateKey', privateKey);
      localStorage.setItem('speak_signaturePrivateKey', signaturePrivateKey);
      
      return true;
    }
    return false;
  } catch (error) {
    console.error('Registration error:', error);
    alert('Ошибка регистрации: ' + error.message);
    return false;
  }
}

// Обновляем функцию login
async function login(username, password) {
  try {
    const response = await apiRequest('/api/login', 'POST', {
      username,
      password
    });
    
    const data = await response.json();
    if (data.success) {
      authToken = data.token;
      currentUserId = data.userId;
      currentUsername = data.username;
      currentUserDisplayName = data.display_name || data.username;
      privateKey = data.signaturePrivateKey;
      signaturePrivateKey = data.signaturePrivateKey;
      
      localStorage.setItem('speak_token', authToken);
      localStorage.setItem('speak_username', currentUsername);
      localStorage.setItem('speak_displayName', currentUserDisplayName);
      localStorage.setItem('speak_userId', currentUserId);
      localStorage.setItem('speak_privateKey', privateKey);
      localStorage.setItem('speak_signaturePrivateKey', signaturePrivateKey);
      
      return true;
    }
    return false;
  } catch (error) {
    console.error('Login error:', error);
    alert('Ошибка входа: ' + error.message);
    return false;
  }
}

// Обновляем UI для отображения псевдонимов в чате
async function loadMessagesForChat(chatUsername) {
  const messages = await loadMessages();
  const chatArea = document.getElementById('chatArea');
  if (chatArea) {
    const relevantMessages = messages.filter(m => 
      m.senderUsername === chatUsername || 
      (m.isOwn && currentChat === chatUsername)
    );
    
    // Получаем псевдоним собеседника
    const contactDisplayName = await getDisplayName(chatUsername);
    
    // Обновляем заголовок чата
    const chatHeader = document.getElementById('chatHeader');
    if (chatHeader) {
      chatHeader.innerHTML = `💬 Чат с ${contactDisplayName} (@${chatUsername})`;
    }
    
    if (relevantMessages.length === 0) {
      chatArea.innerHTML = '<div style="text-align:center; color:#888; margin-top:40px;">💬 Напишите первое сообщение</div>';
    } else {
      chatArea.innerHTML = relevantMessages.map(m => `
        <div class="message ${m.isOwn ? 'own' : 'other'}">
          <strong>${m.isOwn ? 'Вы' : (m.senderDisplayName || m.senderUsername)}:</strong> ${m.text}
          <div style="font-size: 10px; color:#666; margin-top: 4px;">${m.isOwn ? '' : '@' + m.senderUsername}</div>
        </div>
      `).join('');
      chatArea.scrollTop = chatArea.scrollHeight;
    }
  }
}

// Обновляем функцию отображения UI (добавляем кнопку смены имени)
function showMainUI() {
  const displayName = localStorage.getItem('speak_displayName') || currentUsername;
  
  document.getElementById('app').innerHTML = `
    <div class="container">
      <div class="header">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span>💬 Speak — ${displayName}</span>
          <div>
            <button id="changeNameBtn" style="background:#2c2c2e; border:none; padding:5px 12px; border-radius:12px; color:white; cursor:pointer; margin-right:8px;">✏️ Имя</button>
            <button id="logoutBtn" style="background:#ff3b30; border:none; padding:5px 12px; border-radius:12px; color:white; cursor:pointer;">🚪 Выйти</button>
          </div>
        </div>
      </div>
      <div id="chatHeader" style="padding: 10px 20px; background: #1a1a1a; border-bottom: 1px solid #333; font-size: 14px; color: #888;"></div>
      <div class="contacts-area" id="contactsArea">
        <div style="color:#888; padding:8px;">Загрузка...</div>
      </div>
      <div class="chat-area" id="chatArea">
        <div style="text-align:center; color:#888; margin-top:40px;">👈 Выберите контакт</div>
      </div>
      <div class="input-area">
        <input type="text" id="messageInput" placeholder="Сообщение..." autocomplete="off">
        <button id="sendBtn">→</button>
      </div>
    </div>
  `;
  
  // Кнопка смены имени
  document.getElementById('changeNameBtn').onclick = () => {
    const newName = prompt('Введите новое отображаемое имя:', displayName);
    if (newName && newName.trim()) {
      changeMyDisplayName(newName.trim()).then(success => {
        if (success) {
          alert('Имя успешно изменено!');
          location.reload();
        }
      });
    }
  };
  
  document.getElementById('logoutBtn').onclick = async () => {
    await logout();
    location.reload();
  };
  
  loadChatList();
  
  document.getElementById('sendBtn').onclick = async () => {
    if (!currentChat) {
      alert('Выберите контакт');
      return;
    }
    const input = document.getElementById('messageInput');
    const text = input.value.trim();
    if (!text) return;
    
    await sendMessage(currentChat, text);
    input.value = '';
    await loadMessagesForChat(currentChat);
  };
}

// Обновляем форму регистрации (добавляем поле для псевдонима)
function showLoginUI() {
  document.getElementById('app').innerHTML = `
    <div class="login-area">
      <h2>🔒 Speak</h2>
      <p style="color:#888;">Безопасный мессенджер</p>
      
      <div style="width:100%; max-width:300px;">
        <div style="display:flex; gap:10px; margin-bottom:20px;">
          <button id="showLoginBtn" style="flex:1; background:#007aff;">Вход</button>
          <button id="showRegisterBtn" style="flex:1; background:#2c2c2e;">Регистрация</button>
        </div>
        
        <div id="loginForm">
          <input type="text" id="loginUsername" placeholder="Имя пользователя" autocomplete="off">
          <input type="password" id="loginPassword" placeholder="Пароль">
          <button id="loginBtn">Войти</button>
        </div>
        
        <div id="registerForm" style="display:none;">
          <input type="text" id="regDisplayName" placeholder="Ваше отображаемое имя" autocomplete="off">
          <input type="text" id="regUsername" placeholder="Логин (мин. 3 символа)" autocomplete="off">
          <input type="password" id="regPassword" placeholder="Пароль (мин. 6 символов)">
          <button id="registerBtn">Зарегистрироваться</button>
        </div>
      </div>
      
      <p style="font-size: 12px; color:#888; margin-top:20px;">Сквозное шифрование | Никто не прочитает</p>
    </div>
  `;
  
  // Переключение между формами
  document.getElementById('showLoginBtn').onclick = () => {
    document.getElementById('loginForm').style.display = 'block';
    document.getElementById('registerForm').style.display = 'none';
    document.getElementById('showLoginBtn').style.background = '#007aff';
    document.getElementById('showRegisterBtn').style.background = '#2c2c2e';
  };
  
  document.getElementById('showRegisterBtn').onclick = () => {
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('registerForm').style.display = 'block';
    document.getElementById('showRegisterBtn').style.background = '#007aff';
    document.getElementById('showLoginBtn').style.background = '#2c2c2e';
  };
  
  // Логин
  document.getElementById('loginBtn').onclick = async () => {
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    if (!username || !password) {
      alert('Заполните все поля');
      return;
    }
    const success = await login(username, password);
    if (success) {
      location.reload();
    } else {
      alert('Неверное имя пользователя или пароль');
    }
  };
  
  // Регистрация
  document.getElementById('registerBtn').onclick = async () => {
    const displayName = document.getElementById('regDisplayName').value.trim();
    const username = document.getElementById('regUsername').value.trim();
    const password = document.getElementById('regPassword').value;
    
    if (!displayName) {
      alert('Введите отображаемое имя');
      return;
    }
    if (!username || username.length < 3) {
      alert('Логин должен быть не менее 3 символов');
      return;
    }
    if (!password || password.length < 6) {
      alert('Пароль должен быть не менее 6 символов');
      return;
    }
    
    const success = await register(username, password, displayName);
    if (success) {
      location.reload();
    } else {
      alert('Ошибка регистрации. Возможно, логин уже занят.');
    }
  };
}

// Добавляем глобальные переменные
let currentUsername = null;
let currentUserDisplayName = null;

// Обновляем функцию startApp
async function startApp() {
  if (!window.sodium) {
    setTimeout(startApp, 100);
    return;
  }
  
  await initSodium();
  
  const savedToken = localStorage.getItem('speak_token');
  const savedUsername = localStorage.getItem('speak_username');
  const savedDisplayName = localStorage.getItem('speak_displayName');
  const savedUserId = localStorage.getItem('speak_userId');
  const savedPrivateKey = localStorage.getItem('speak_privateKey');
  
  if (savedToken && savedUsername) {
    authToken = savedToken;
    currentUsername = savedUsername;
    currentUserDisplayName = savedDisplayName || savedUsername;
    currentUserId = savedUserId;
    privateKey = savedPrivateKey;
    
    try {
      const response = await apiRequest('/api/verify', 'GET');
      const data = await response.json();
      if (data.valid) {
        showMainUI();
      } else {
        logout();
        showLoginUI();
      }
    } catch (e) {
      logout();
      showLoginUI();
    }
  } else {
    showLoginUI();
  }
}
