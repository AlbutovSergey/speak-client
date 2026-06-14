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
const API_URL = 'http://localhost:3000'; // Change this to your backend URL

// ============ ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ============
async function initSodium() {
    try {
        // Check if libsodium is loaded
        if (!window.sodium) {
            console.error('Libsodium not loaded yet, waiting...');
            await new Promise((resolve) => {
                const checkSodium = setInterval(() => {
                    if (window.sodium) {
                        clearInterval(checkSodium);
                        resolve();
                    }
                }, 100);
            });
        }
        
        await window.sodium.ready;
        sodium = window.sodium;
        console.log('✅ Libsodium initialized successfully');
        return true;
    } catch (error) {
        console.error('❌ Failed to initialize libsodium:', error);
        throw new Error('Security library failed to load. Please check your internet connection and refresh the page.');
    }
}

async function generateKeys() {
    if (!sodium) {
        throw new Error('Libsodium not initialized');
    }
    
    const keypair = sodium.crypto_box_keypair();
    const publicKey = sodium.to_base64(keypair.publicKey);
    const privateKeyBase64 = sodium.to_base64(keypair.privateKey);

    const signKeypair = sodium.crypto_sign_keypair();
    const signPublicKey = sodium.to_base64(signKeypair.publicKey);
    const signPrivateKey = sodium.to_base64(signKeypair.privateKey);

    return { publicKey, privateKey: privateKeyBase64, signPublicKey, signPrivateKey };
}

async function encryptMessage(message, recipientPublicKey, senderPrivateKey) {
    if (!sodium) throw new Error('Libsodium not initialized');
    
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
    if (!sodium) throw new Error('Libsodium not initialized');
    
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

    try {
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
    } catch (error) {
        console.error(`API request failed: ${endpoint}`, error);
        throw error;
    }
}

// ============ АВТОРИЗАЦИЯ ============
async function register(username, password, displayName) {
    if (!sodium) {
        alert('Security library not ready. Please wait and try again.');
        return false;
    }
    
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
        alert('Network error during registration: ' + error.message);
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
        alert('Network error during login: ' + error.message);
        return false;
    }
}

async function logout() {
    if (authToken) {
        try {
            await apiRequest('/api/logout', 'POST');
        } catch (e) {
            console.error('Logout error:', e);
        }
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
    if (!sodium) {
        alert('Security library not ready');
        return false;
    }

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
        alert('Network error while sending message: ' + error.message);
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
                    text: "[🔒 Зашифрованное сообщение]",
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
    const app = document.getElementById('app');
    if (!app) return;
    
    app.innerHTML = `
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

    const showLoginBtn = document.getElementById('showLoginBtn');
    const showRegisterBtn = document.getElementById('showRegisterBtn');
    const loginBtn = document.getElementById('loginBtn');
    const registerBtn = document.getElementById('registerBtn');
    
    if (showLoginBtn) {
        showLoginBtn.onclick = () => {
            const loginForm = document.getElementById('loginForm');
            const registerForm = document.getElementById('registerForm');
            if (loginForm) loginForm.style.display = 'block';
            if (registerForm) registerForm.style.display = 'none';
        };
    }
    
    if (showRegisterBtn) {
        showRegisterBtn.onclick = () => {
            const loginForm = document.getElementById('loginForm');
            const registerForm = document.getElementById('registerForm');
            if (loginForm) loginForm.style.display = 'none';
            if (registerForm) registerForm.style.display = 'block';
        };
    }

    if (loginBtn) {
        loginBtn.onclick = async () => {
            const usernameInput = document.getElementById('loginUsername');
            const passwordInput = document.getElementById('loginPassword');
            
            if (!usernameInput || !passwordInput) return;
            
            const username = usernameInput.value.trim();
            const password = passwordInput.value;
            
            if (await login(username, password)) {
                location.reload();
            }
        };
    }

    if (registerBtn) {
        registerBtn.onclick = async () => {
            const displayNameInput = document.getElementById('regDisplayName');
            const usernameInput = document.getElementById('regUsername');
            const passwordInput = document.getElementById('regPassword');
            
            if (!displayNameInput || !usernameInput || !passwordInput) return;
            
            const displayName = displayNameInput.value.trim();
            const username = usernameInput.value.trim();
            const password = passwordInput.value;

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
}

async function showChatUI() {
    const app = document.getElementById('app');
    if (!app) return;
    
    app.innerHTML = `
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

    const logoutBtn = document.getElementById('logoutBtn');
    const sendBtn = document.getElementById('sendBtn');
    
    if (logoutBtn) {
        logoutBtn.onclick = () => {
            logout();
        };
    }

    if (sendBtn) {
        sendBtn.onclick = async () => {
            const messageInput = document.getElementById('messageInput');
            if (!messageInput) return;
            
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
    }

    await showUserSelection();
    refreshMessages();
    setInterval(refreshMessages, 5000);
}

async function refreshMessages() {
    const messagesDiv = document.getElementById('chatMessages');
    if (!messagesDiv) return;

    if (!currentChat) {
        messagesDiv.innerHTML = '<div class="info">👥 Select a user from the top bar to start chatting</div>';
        return;
    }

    messagesDiv.innerHTML = '<div class="loading">📩 Loading messages...</div>';

    try {
        const messages = await loadMessages();
        messagesDiv.innerHTML = '';

        if (messages.length === 0) {
            messagesDiv.innerHTML = '<div class="info">💬 No messages yet. Send your first message!</div>';
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
        messagesDiv.innerHTML = '<div class="error">❌ Failed to load messages. Check your connection.</div>';
    }
}

async function showUserSelection() {
    const app = document.getElementById('app');
    if (!app) return;
    
    // Check if user selection already exists
    if (document.querySelector('.user-selection')) return;
    
    const userSelectionDiv = document.createElement('div');
    userSelectionDiv.className = 'user-selection';
    userSelectionDiv.innerHTML = '<h3>👤 Select a user to chat with:</h3><div class="user-list">👥 Loading users...</div>';
    
    const chatContainer = document.querySelector('.chat-container');
    if (chatContainer) {
        chatContainer.insertBefore(userSelectionDiv, chatContainer.firstChild);
    }

    try {
        // Fetch all users except current user
        // Note: You need to implement /api/users endpoint or modify this
        const response = await apiRequest('/api/users', 'GET');
        if (!response.ok) {
            console.error('Failed to load users');
            userSelectionDiv.querySelector('.user-list').innerHTML = '<div class="error">Failed to load users</div>';
            return;
        }
        
        const users = await response.json();
        const userList = userSelectionDiv.querySelector('.user-list');
        
        if (!userList) return;
        
        userList.innerHTML = '';

        const filteredUsers = users.filter(user => user.username !== currentUsername);
        
        if (filteredUsers.length === 0) {
            userList.innerHTML = '<div class="info">No other users found</div>';
            return;
        }

        filteredUsers.forEach(user => {
            const userBtn = document.createElement('button');
            userBtn.className = 'user-btn';
            userBtn.textContent = `${user.display_name || user.username} (@${user.username})`;
            userBtn.onclick = () => {
                currentChat = user.username;
                document.querySelectorAll('.user-btn').forEach(btn => btn.classList.remove('active'));
                userBtn.classList.add('active');
                refreshMessages();
            };
            userList.appendChild(userBtn);
        });
    } catch (error) {
        console.error('Failed to load users:', error);
        const userList = userSelectionDiv.querySelector('.user-list');
        if (userList) {
            userList.innerHTML = '<div class="error">❌ Failed to load users. Make sure backend is running.</div>';
        }
    }
}

// Add this endpoint to your backend or use a workaround
// Temporary workaround - fetch users from registration list
async function getUsersList() {
    // This is a workaround. Better to implement /api/users endpoint on backend
    try {
        const response = await apiRequest('/api/users', 'GET');
        return await response.json();
    } catch (error) {
        console.error('Failed to get users list:', error);
        return [];
    }
}

// ============ ИНИЦИАЛИЗАЦИЯ ============
async function init() {
    const app = document.getElementById('app');
    if (!app) {
        console.error('App element not found');
        return;
    }
    
    app.innerHTML = '<div class="loading">🔐 Initializing secure messenger...</div>';
    
    try {
        // Initialize libsodium with timeout
        const initPromise = initSodium();
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Libsodium initialization timeout')), 10000)
        );
        
        await Promise.race([initPromise, timeoutPromise]);
        
        console.log('Checking stored session...');
        const token = localStorage.getItem('speak_token');
        const username = localStorage.getItem('speak_username');
        const displayName = localStorage.getItem('speak_displayName');
        const uid = localStorage.getItem('speak_userId');
        const key = localStorage.getItem('speak_privateKey');
        const sigKey = localStorage.getItem('speak_signaturePrivateKey');

        if (token && username && key && sigKey) {
            console.log('Found stored session, validating...');
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
                    console.log('Session valid, loading chat UI');
                    await showChatUI();
                    return;
                } else {
                    console.log('Session invalid, showing login');
                }
            } catch (error) {
                console.error('Token verification failed:', error);
                // If backend is not running, show error but still try to show login
                if (error.message.includes('Failed to fetch')) {
                    app.innerHTML = '<div class="error">⚠️ Cannot connect to server. Make sure backend is running at ' + API_URL + '</div>';
                    return;
                }
            }
        }

        console.log('Showing login UI');
        showLoginUI();
    } catch (error) {
        console.error('Failed to initialize app:', error);
        app.innerHTML = `<div class="error">
            ❌ Failed to initialize application<br><br>
            <strong>Error:</strong> ${error.message}<br><br>
            <button onclick="location.reload()">🔄 Retry</button>
        </div>`;
    }
}

// Start the app when page loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
