let sodium = null;
let currentUser = null;
let currentUserId = null;
let privateKey = null;
let signaturePrivateKey = null;
let currentChat = null;
let authToken = null;

const API_URL = 'https://speak-backend-b43k.onrender.com';  // ЗАМЕНИТЕ НА ВАШ АДРЕС!

// ============ ИНИЦИАЛИЗАЦИЯ ============

async function initSodium() {
    await window.sodium.ready;
    sodium = window.sodium;
}

async function generateKeys() {
    const keypair = sodium.crypto_box_keypair();
    const publicKey = sodium.to_base64(keypair.publicKey);
    const privateKeyBase64 = sodium.to_base64(keypair.privateKey);
    
    const signKeypair = sodium.crypto_sign_keypair();
    const signPublicKey = sodium.to_base64(signKeypair.publicKey);
    const signPrivateKey = sodium.to_base64(signKeypair.privateKey);
    
    return { publicKey, privateKey: privateKeyBase64, signPublicKey, signPrivateKey };
}

// ============ КРИПТОГРАФИЯ ============

async function encryptMessage(message, recipientPublicKey, senderPrivateKey) {
    const recipientPub = sodium.from_base64(recipientPublicKey);
    const senderPriv = sodium.from_base64(senderPrivateKey);
    const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
    const encrypted = sodium.crypto_box_easy(
        sodium.from_string(message),
        nonce,
        recipientPub,
        senderPriv
    );
    return { payload: sodium.to_base64(encrypted), nonce: sodium.to_base64(nonce) };
}

async function decryptMessage(encryptedPayload, nonce, senderPublicKey, recipientPrivateKey) {
    const senderPub = sodium.from_base64(senderPublicKey);
    const recipientPriv = sodium.from_base64(recipientPrivateKey);
    const decrypted = sodium.crypto_box_open_easy(
        sodium.from_base64(encryptedPayload),
        sodium.from_base64(nonce),
        senderPub,
        recipientPriv
    );
    return sodium.to_string(decrypted);
}

// ============ API ЗАПРОСЫ С АВТОРИЗАЦИЕЙ ============

async function apiRequest(endpoint, method, body = null) {
    const headers = {
        'Content-Type': 'application/json'
    };
    if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
    }
    
    const response = await fetch(`${API_URL}${endpoint}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
    });
    
    if (response.status === 401) {
        // Токен просрочен — выходим
        logout();
        throw new Error('Session expired');
    }
    
    return response;
}

// ============ РЕГИСТРАЦИЯ ============

async function register(username, password) {
    try {
        const keys = await generateKeys();
        
        const response = await apiRequest('/api/register', 'POST', {
            username,
            password,
            publicKey: keys.publicKey,
            signaturePublicKey: keys.signPublicKey,
            signaturePrivateKey: keys.signPrivateKey
        });
        
        const data = await response.json();
        if (data.success) {
            authToken = data.token;
            currentUserId = data.userId;
            currentUser = data.username;
            privateKey = keys.privateKey;
            signaturePrivateKey = keys.signPrivateKey;
            
            localStorage.setItem('speak_token', authToken);
            localStorage.setItem('speak_username', currentUser);
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

// ============ АВТОРИЗАЦИЯ ============

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
            currentUser = data.username;
            privateKey = data.signaturePrivateKey; // В реальном проекте ключи хранятся на клиенте
            signaturePrivateKey = data.signaturePrivateKey;
            
            localStorage.setItem('speak_token', authToken);
            localStorage.setItem('speak_username', currentUser);
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

// ============ ВЫХОД ============

async function logout() {
    if (authToken) {
        await apiRequest('/api/logout', 'POST');
    }
    localStorage.clear();
    authToken = null;
    currentUser = null;
    currentUserId = null;
    showLoginUI();
}

// ============ СООБЩЕНИЯ ============

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
                decryptedMessages.push({
                    text: decryptedText,
                    isOwn: msg.sender_username === currentUser,
                    senderUsername: msg.sender_username,
                    timestamp: msg.timestamp
                });
            } catch(e) {
                decryptedMessages.push({
                    text: "[🔒 Зашифровано]",
                    isOwn: false,
                    senderUsername: msg.sender_username
                });
            }
        }
        return decryptedMessages;
    } catch (error) {
        console.error('Load messages error:', error);
        return [];
    }
}

async function sendMessage(recipientUsername, messageText) {
    try {
        const recipientKeyRes = await apiRequest(`/api/public_key/${recipientUsername}`, 'GET');
        const recipientData = await recipientKeyRes.json();
        
        const encrypted = await encryptMessage(messageText, recipientData.public_key, privateKey);
        
        await apiRequest('/api/send_message', 'POST', {
            recipientUsername,
            encryptedPayload: encrypted.payload,
            nonce: encrypted.nonce
        });
        return true;
    } catch (error) {
        console.error('Send message error:', error);
        alert('Ошибка отправки: ' + error.message);
        return false;
    }
}

// ============ UI КОМПОНЕНТЫ ============

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
                    <input type="text" id="regUsername" placeholder="Имя пользователя (мин. 3 символа)" autocomplete="off">
                    <input type="password" id="regPassword" placeholder="Пароль (мин. 6 символов)">
                    <button id="registerBtn">Зарегистрироваться</button>
                </div>
            </div>
            
            <p style="font-size: 12px; color:#888; margin-top:20px;">Сквозное шифрование | Никто не прочитает</p>
        </div>
    `;
    
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
    
    document.getElementById('registerBtn').onclick = async () => {
        const username = document.getElementById('regUsername').value.trim();
        const password = document.getElementById('regPassword').value;
        if (!username || username.length < 3) {
            alert('Имя пользователя должно быть не менее 3 символов');
            return;
        }
        if (!password || password.length < 6) {
            alert('Пароль должен быть не менее 6 символов');
            return;
        }
        const success = await register(username, password);
        if (success) {
            location.reload();
        } else {
            alert('Ошибка регистрации. Возможно, имя уже занято.');
        }
    };
}

async function loadChatList() {
    const messages = await loadMessages();
    const chats = new Map();
    for (const msg of messages) {
        const otherUser = msg.isOwn ? currentChat : msg.senderUsername;
        if (otherUser && !chats.has(otherUser)) {
            chats.set(otherUser, msg.senderUsername);
        }
    }
    
    const contactsDiv = document.getElementById('contactsArea');
    if (contactsDiv) {
        const chatUsers = Array.from(chats.keys());
        if (chatUsers.length === 0) {
            contactsDiv.innerHTML = '<div style="color:#888; padding:8px;">➕ Напишите кому-нибудь, указав его имя</div>';
        } else {
            contactsDiv.innerHTML = chatUsers.map(contact => `
                <div class="contact-chip ${currentChat === contact ? 'active' : ''}" data-id="${contact}">
                    ${contact}
                </div>
            `).join('');
            
            document.querySelectorAll('.contact-chip').forEach(el => {
                el.onclick = () => {
                    currentChat = el.getAttribute('data-id');
                    loadMessagesForChat(currentChat);
                    loadChatList();
                };
            });
        }
    }
}

function showMainUI() {
    document.getElementById('app').innerHTML = `
        <div class="container">
            <div class="header">
                💬 Speak — ${currentUser}
                <button id="logoutBtn" style="float:right; background:#ff3b30; border:none; padding:5px 12px; border-radius:12px; color:white; cursor:pointer;">Выйти</button>
            </div>
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

async function loadMessagesForChat(chatUsername) {
    const messages = await loadMessages();
    const chatArea = document.getElementById('chatArea');
    if (chatArea) {
        const relevantMessages = messages.filter(m => 
            m.senderUsername === chatUsername || 
            (m.isOwn && currentChat === chatUsername)
        );
        
        if (relevantMessages.length === 0) {
            chatArea.innerHTML = '<div style="text-align:center; color:#888; margin-top:40px;">💬 Напишите первое сообщение</div>';
        } else {
            chatArea.innerHTML = relevantMessages.map(m => `
                <div class="message ${m.isOwn ? 'own' : 'other'}">
                    <strong>${m.isOwn ? 'Вы' : m.senderUsername}:</strong> ${m.text}
                </div>
            `).join('');
            chatArea.scrollTop = chatArea.scrollHeight;
        }
    }
}

// ============ ЗАПУСК ============

async function startApp() {
    if (!window.sodium) {
        setTimeout(startApp, 100);
        return;
    }
    
    await initSodium();
    
    const savedToken = localStorage.getItem('speak_token');
    const savedUsername = localStorage.getItem('speak_username');
    const savedUserId = localStorage.getItem('speak_userId');
    const savedPrivateKey = localStorage.getItem('speak_privateKey');
    
    if (savedToken && savedUsername) {
        authToken = savedToken;
        currentUser = savedUsername;
        currentUserId = savedUserId;
        privateKey = savedPrivateKey;
        
        // Проверяем, валиден ли токен
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

startApp();

setInterval(async () => {
    if (currentUser && currentChat) {
        await loadMessagesForChat(currentChat);
    }
}, 5000);
