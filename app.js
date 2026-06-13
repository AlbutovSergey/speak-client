// ============ ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ============
let sodium = null;
let currentUsername = null;
let currentUserDisplayName = null;
let currentUserId = null;
let privateKey = null;
let signaturePrivateKey = null;
let currentChat = null;
let authToken = null;

const API_URL = 'https://speak-backend.onrender.com'; // ЗАМЕНИТЕ НА ВАШ АДРЕС!

// ============ ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ============
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

// ============ API ЗАПРОСЫ ============
async function apiRequest(endpoint, method, body = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
    }
    
    const response = await fetch(`${API_URL}${endpoint}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
    });
    
    if (response.status === 401) {
        logout();
        throw new Error('Session expired');
    }
    return response;
}

// ============ АВТОРИЗАЦИЯ ============
async function register(username, password, displayName) {
    try {
        const keys = await generateKeys();
        const response = await apiRequest('/api/register', 'POST', {
            username, password,
            displayName: displayName || username,
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
            
            localStorage.setItem('speak_token', authToken);
            localStorage.setItem('speak_username', currentUsername);
            localStorage.setItem('speak_displayName', currentUserDisplayName);
            localStorage.setItem('speak_userId', currentUserId);
            localStorage.setItem('speak_privateKey', privateKey);
            return true;
        }
        return false;
    } catch (error) {
        console.error('Registration error:', error);
        return false;
    }
}

async function login(username, password) {
    try {
        const response = await apiRequest('/api/login', 'POST', { username, password });
        const data = await response.json();
        if (data.success) {
            authToken = data.token;
            currentUserId = data.userId;
            currentUsername = data.username;
            currentUserDisplayName = data.display_name || data.username;
            privateKey = data.signaturePrivateKey;
            
            localStorage.setItem('speak_token', authToken);
            localStorage.setItem('speak_username', currentUsername);
            localStorage.setItem('speak_displayName', currentUserDisplayName);
            localStorage.setItem('speak_userId', currentUserId);
            localStorage.setItem('speak_privateKey', privateKey);
            return true;
        }
        return false;
    } catch (error) {
        console.error('Login error:', error);
        return false;
    }
}

async function logout() {
    if (authToken) {
        await apiRequest('/api/logout', 'POST').catch(() => {});
    }
    localStorage.clear();
    authToken = null;
    currentUsername = null;
    currentChat = null;
    showLoginUI();
}

// ============ СООБЩЕНИЯ ============
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
        return false;
    }
}

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
                    msg.encrypted_payload, msg.nonce,
                    senderData.public_key, privateKey
                );
                decryptedMessages.push({
                    text: decryptedText,
                    isOwn: msg.sender_username === currentUsername,
                    senderUsername: msg.sender_username,
                    senderDisplayName: msg.sender_display_name || msg.sender_username
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

// ============ UI ============
function showLoginUI() {
    document.getElementById('app').innerHTML = `
        <div class="login-area">
            <h2>🔒 Speak</h2>
            <div style="width:100%; max-width:300px;">
                <div style="display:flex; gap:10px; margin-bottom:20px;">
                    <button id="showLoginBtn" style="flex:1; background:#007aff;">Вход</button>
                    <button id="showRegisterBtn" style="flex:1; background:#2c2c2e;">Регистрация</button>
                </div>
                <div id="loginForm">
                    <input type="text" id="loginUsername" placeholder="Логин"><br>
                    <input type="password" id="loginPassword" placeholder="Пароль"><br>
                    <button id="loginBtn">Войти</button>
                </div>
                <div id="registerForm" style="display:none;">
                    <input type="text" id="regDisplayName" placeholder="Отображаемое имя"><br>
                    <input type="text" id="regUsername" placeholder="Логин (мин. 3 символа)"><br>
                    <input type="password" id="regPassword" placeholder="Пароль (мин. 6 символов)"><br>
                    <button id="registerBtn">Зарегистрироваться</button>
                </div>
            </div>
        </div>
    `;
    
    document.getElementById('showLoginBtn').onclick = () => {
        document.getElementById('loginForm').style.display = 'block';
        document.getElementById('registerForm').style.display = 'none';
    };
    document.getElementById('showRegisterBtn').onclick = () => {
        document.getElementById('loginForm').style.display = 'none';
        document.getElementById('registerForm').style.display = 'block';
    };
    document.getElementById('loginBtn').onclick = async () => {
        const username = document.getElementById('loginUsername').value.trim();
        const password = document.getElementById('loginPassword').value;
        if (await login(username, password)) location.reload();
        else alert('Неверный логин или пароль');
    };
    document.getElementById('registerBtn').onclick = async () => {
        const displayName = document.getElementById('regDisplayName').value.trim();
        const username = document.getElementById('regUsername').value.trim();
        const password = document.getElementById('regPassword').value;
        if (await register(username, password, displayName)) location.reload();
        else alert('Ошибка регистрации');
    };
}

function showMainUI() {
    document.getElementById('app').innerHTML = `
        <div class="container">
            <div class="header">💬 Speak — ${currentUserDisplayName || currentUsername}
                <button id="logoutBtn" style="float:right;">Выйти</button>
            </div>
            <div class="contacts-area" id="contactsArea"></div>
            <div class="chat-area" id="chatArea"></div>
            <div class="input-area">
                <input type="text" id="messageInput" placeholder="Сообщение...">
                <button id="sendBtn">→</button>
            </div>
        </div>
    `;
    document.getElementById('logoutBtn').onclick = async () => { await logout(); location.reload(); };
    document.getElementById('sendBtn').onclick = async () => {
        if (!currentChat) return alert('Выберите контакт');
        const input = document.getElementById('messageInput');
        await sendMessage(currentChat, input.value);
        input.value = '';
        await loadMessagesForChat(currentChat);
    };
    loadChatList();
}

async function loadChatList() {
    const messages = await loadMessages();
    const chats = [...new Set(messages.map(m => m.isOwn ? currentChat : m.senderUsername).filter(Boolean))];
    const contactsDiv = document.getElementById('contactsArea');
    if (contactsDiv) {
        contactsDiv.innerHTML = chats.map(contact => `<div class="contact-chip" data-id="${contact}">${contact}</div>`).join('');
        document.querySelectorAll('.contact-chip').forEach(el => {
            el.onclick = () => { currentChat = el.dataset.id; loadMessagesForChat(currentChat); };
        });
    }
}

async function loadMessagesForChat(chatUsername) {
    const messages = await loadMessages();
    const relevant = messages.filter(m => m.senderUsername === chatUsername || (m.isOwn && currentChat === chatUsername));
    const chatArea = document.getElementById('chatArea');
    if (chatArea) {
        chatArea.innerHTML = relevant.map(m => `<div class="message ${m.isOwn ? 'own' : 'other'}"><strong>${m.isOwn ? 'Вы' : (m.senderDisplayName || m.senderUsername)}:</strong> ${m.text}</div>`).join('');
        chatArea.scrollTop = chatArea.scrollHeight;
    }
}

// ============ ЗАПУСК ============
async function startApp() {
    if (!window.sodium) { setTimeout(startApp, 100); return; }
    await initSodium();
    const token = localStorage.getItem('speak_token');
    const username = localStorage.getItem('speak_username');
    const displayName = localStorage.getItem('speak_displayName');
    const uid = localStorage.getItem('speak_userId');
    const key = localStorage.getItem('speak_privateKey');
    if (token && username) {
        authToken = token;
        currentUsername = username;
        currentUserDisplayName = displayName || username;
        currentUserId = uid;
        privateKey = key;
        try {
            const res = await apiRequest('/api/verify', 'GET');
            const data = await res.json();
            if (data.valid) showMainUI();
            else { logout(); showLoginUI(); }
        } catch(e) { logout(); showLoginUI(); }
    } else { showLoginUI(); }
}

startApp();
