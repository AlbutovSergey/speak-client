// ============ ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ============
let sodium = null;
let currentUsername = null;
let currentUserDisplayName = null;
let currentUserId = null;
let privateKey = null;
let signaturePrivateKey = null;
let currentChat = null;
let authToken = null;

// IMPORTANT: Replace with your actual backend URL
const API_URL = 'http://localhost:3000'; // Example for local development

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
            username,
            password,
            displayName: displayName || username,
            publicKey: keys.publicKey,
            signaturePublicKey: keys.signPublicKey,
            signaturePrivateKey: keys.signPrivateKey
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('Registration failed:', data.error);
            alert(data.error || 'Registration failed');
            return false;
        }

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
        alert('Network error during registration');
        return false;
    }
}

async function login(username, password) {
    try {
        const response = await apiRequest('/api/login', 'POST', { username, password });
        const data = await response.json();

        if (!response.ok) {
            console.error('Login failed:', data.error);
            alert(data.error || 'Login failed');
            return false;
        }

        if (data.success) {
            authToken = data.token;
            currentUserId = data.userId;
            currentUsername = data.username;
            currentUserDisplayName = data.display_name || data.username;

            const storedPrivateKey = localStorage.getItem('speak_privateKey');
            const storedSignatureKey = localStorage.getItem('speak_signaturePrivateKey');

            if (!storedPrivateKey || !storedSignatureKey) {
                console.error('Missing cryptographic keys after login');
                alert('Missing cryptographic keys. Please register again.');
                return false;
            }

            privateKey = storedPrivateKey;
            signaturePrivateKey = storedSignatureKey;

            localStorage.setItem('speak_token', authToken);
            localStorage.setItem('speak_username', currentUsername);
            localStorage.setItem('speak_displayName', currentUserDisplayName);
            localStorage.setItem('speak_userId', currentUserId);

            return true;
        }

        return false;
    } catch (error) {
        console.error('Login error:', error);
        alert('Network error during login');
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
    currentUserId = null;
    currentUserDisplayName = null;
    privateKey = null;
    signaturePrivateKey = null;
    currentChat = null;
    showLoginUI();
}

// ============ СООБЩЕНИЯ ============
async function sendMessage(recipientUsername, messageText) {
    if (!messageText.trim()) return false;

    try {
        const recipientKeyRes = await apiRequest(`/api/public_key/${recipientUsername}`, 'GET');

        if (!recipientKeyRes.ok) {
            const error = await recipientKeyRes.json();
            console.error('Failed to fetch recipient key:', error);
            alert('Could not fetch recipient public key');
            return false;
        }

        const recipientData = await recipientKeyRes.json();
        const encrypted = await encryptMessage(messageText, recipientData.public_key, privateKey);

        const sendRes = await apiRequest('/api/send_message', 'POST', {
            recipientUsername,
            encryptedPayload: encrypted.payload,
            nonce: encrypted.nonce
        });

        if (!sendRes.ok) {
            const error = await sendRes.json();
            console.error('Failed to send message:', error);
            alert('Failed to send message');
            return false;
        }

        return true;
    } catch (error) {
        console.error('Send message error:', error);
        alert('Network error while sending message');
        return false;
    }
}

async function loadMessages() {
    try {
        const response = await apiRequest('/api/messages', 'GET');
        if (!response.ok) {
            console.error('Failed to load messages');
            return [];
        }

        const messages = await response.json();
        const decryptedMessages = [];

        for (const msg of messages) {
            try {
                const senderPubRes = await apiRequest(`/api/public_key/${msg.sender_username}`, 'GET');
                if (!senderPubRes.ok) continue;

                const senderData = await senderPubRes.json();
                const decryptedText = await decryptMessage(
                    msg.encrypted_payload,
                    msg.nonce,
                    senderData.public_key,
                    privateKey
                );

                decryptedMessages.push({
                    text: decryptedText,
                    isOwn: msg.sender_username === currentUsername,
                    senderUsername: msg.sender_username,
                    senderDisplayName: msg.sender_display_name || msg.sender_username,
                    timestamp: msg.created_at
                });
            } catch(e) {
                console.error('Failed to decrypt message:', e);
                decryptedMessages.push({
                    text: "[Зашифровано]",
                    isOwn: false,
                    senderUsername: msg.sender_username,
                    senderDisplayName: msg.sender_display_name || msg.sender_username,
                    timestamp: msg.created_at
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
        <div class="auth-container">
            <h2>🔐 Speak</h2>
            <div class="auth-buttons">
                <button id="showLoginBtn">Login</button>
                <button id="showRegisterBtn">Register</button>
            </div>
            <div id="loginForm" class="auth-form" style="display: none;">
                <input type="text" id="loginUsername" placeholder="Username" />
                <input type="password" id="loginPassword" placeholder="Password" />
                <button id="loginBtn">Login</button>
            </div>
            <div id="registerForm" class="auth-form" style="display: none;">
                <input type="text" id="regDisplayName" placeholder="Display Name" />
                <input type="text" id="regUsername" placeholder="Username (min 3 chars)" />
                <input type="password" id="regPassword" placeholder="Password (min 6 chars)" />
                <button id="registerBtn">Register</button>
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
        if (await login(username, password)) {
            location.reload();
        }
    };

    document.getElementById('registerBtn').onclick = async () => {
        const displayName = document.getElementById('regDisplayName').value.trim();
        const username = document.getElementById('regUsername').value.trim();
        const password = document.getElementById('regPassword').value;

        if (username.length < 3) {
            alert('Username must be at least 3 characters');
            return;
        }
        if (password.length < 6) {
            alert('Password must be at least 6 characters');
            return;
        }
        if (displayName.length < 1 || displayName.length > 50) {
            alert('Display name must be 1-50 characters');
            return;
        }

        if (await register(username, password, displayName)) {
            location.reload();
        }
    };
}

function showChatUI() {
    document.getElementById('app').innerHTML = `
        <div class="chat-container">
            <div class="chat-header">
                <h2>💬 Speak Chat</h2>
                <button id="logoutBtn">Logout</button>
            </div>
            <div class="chat-messages" id="chatMessages">
                <div class="loading">Loading messages...</div>
            </div>
            <div class="chat-input">
                <input type="text" id="messageInput" placeholder="Type your message..." />
                <button id="sendBtn">Send</button>
            </div>
        </div>
    `;

    document.getElementById('logoutBtn').onclick = () => {
        logout();
    };

    document.getElementById('sendBtn').onclick = async () => {
        const messageInput = document.getElementById('messageInput');
        const message = messageInput.value.trim();
        if (!message) return;

        if (!currentChat) {
            alert('Please select a chat first');
            return;
        }

        if (await sendMessage(currentChat, message)) {
            messageInput.value = '';
            refreshMessages();
        }
    };

    refreshMessages();

    setInterval(refreshMessages, 5000);
}

async function refreshMessages() {
    const messagesDiv = document.getElementById('chatMessages');
    if (!messagesDiv) return;

    if (!currentChat) {
        messagesDiv.innerHTML = '<div class="info">Select a user to start chatting</div>';
        return;
    }

    messagesDiv.innerHTML = '<div class="loading">Loading messages...</div>';

    try {
        const messages = await loadMessages();
        messagesDiv.innerHTML = '';

        if (messages.length === 0) {
            messagesDiv.innerHTML = '<div class="info">No messages yet. Send your first message!</div>';
            return;
        }

        messages.forEach(msg => {
            const msgDiv = document.createElement('div');
            msgDiv.className = `message ${msg.isOwn ? 'own' : 'other'}`;

            const senderSpan = document.createElement('div');
            senderSpan.className = 'sender';
            senderSpan.textContent = msg.isOwn ? 'You' : msg.senderDisplayName;
            msgDiv.appendChild(senderSpan);

            const textSpan = document.createElement('div');
            textSpan.className = 'text';
            textSpan.textContent = msg.text;
            msgDiv.appendChild(textSpan);

            if (msg.timestamp) {
                const timeSpan = document.createElement('div');
                timeSpan.className = 'time';
                timeSpan.textContent = new Date(msg.timestamp).toLocaleTimeString();
                msgDiv.appendChild(timeSpan);
            }

            messagesDiv.appendChild(msgDiv);
        });

        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    } catch (error) {
        console.error('Failed to refresh messages:', error);
        messagesDiv.innerHTML = '<div class="error">Failed to load messages</div>';
    }
}

async function showUserSelection() {
    const usersDiv = document.createElement('div');
    usersDiv.className = 'user-selection';
    usersDiv.innerHTML = '<h3>Select a user to chat with:</h3><div class="user-list">Loading users...</div>';
    document.getElementById('app').prepend(usersDiv);

    try {
        const response = await apiRequest('/api/users', 'GET');
        const users = await response.json();

        const userList = usersDiv.querySelector('.user-list');
        userList.innerHTML = '';

        users.forEach(user => {
            if (user.username !== currentUsername) {
                const userBtn = document.createElement('button');
                userBtn.className = 'user-btn';
                userBtn.textContent = `${user.display_name} (@${user.username})`;
                userBtn.onclick = () => {
                    currentChat = user.username;
                    document.querySelectorAll('.user-btn').forEach(btn => btn.classList.remove('active'));
                    userBtn.classList.add('active');
                    refreshMessages();
                };
                userList.appendChild(userBtn);
            }
        });
    } catch (error) {
        console.error('Failed to load users:', error);
    }
}

// ============ ИНИЦИАЛИЗАЦИЯ ============
async function init() {
    try {
        await initSodium();

        const token = localStorage.getItem('speak_token');
        const username = localStorage.getItem('speak_username');
        const displayName = localStorage.getItem('speak_displayName');
        const uid = localStorage.getItem('speak_userId');
        const key = localStorage.getItem('speak_privateKey');
        const sigKey = localStorage.getItem('speak_signaturePrivateKey');

        if (token && username && key && sigKey) {
            authToken = token;
            currentUsername = username;
            currentUserDisplayName = displayName || username;
            currentUserId = uid;
            privateKey = key;
            signaturePrivateKey = sigKey;

            try {
                const res = await apiRequest('/api/verify', 'GET');
                const data = await res.json();

                if (data.valid) {
                    showChatUI();
                    await showUserSelection();
                    return;
                }
            } catch (error) {
                console.error('Token verification failed:', error);
            }
        }

        showLoginUI();
    } catch (error) {
        console.error('Failed to initialize app:', error);
        document.getElementById('app').innerHTML = '<div class="error">Failed to initialize application</div>';
    }
}

init();
