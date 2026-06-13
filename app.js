let sodium = null;
let currentUser = null;
let privateKey = null;
let currentChat = null;

// ⚠️ ЗАМЕНИТЕ ЭТОТ АДРЕС НА ВАШ СЕРВЕР
const API_URL = 'https://speak-backend-b43k.onrender.com'; 

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

async function register(userId) {
    try {
        const keys = await generateKeys();
        const response = await fetch(`${API_URL}/api/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: userId,
                publicKey: keys.publicKey,
                signaturePublicKey: keys.signPublicKey,
                signaturePrivateKey: keys.signPrivateKey
            })
        });
        const data = await response.json();
        if (data.token) {
            localStorage.setItem('speak_userId', userId);
            localStorage.setItem('speak_privateKey', keys.privateKey);
            localStorage.setItem('speak_publicKey', keys.publicKey);
            return true;
        }
        return false;
    } catch (error) {
        console.error('Registration error:', error);
        return false;
    }
}

async function loadMessages(userId, privateKeyBase64) {
    try {
        const response = await fetch(`${API_URL}/api/messages/${userId}`);
        const messages = await response.json();
        
        const decryptedMessages = [];
        for (const msg of messages) {
            try {
                const senderPubRes = await fetch(`${API_URL}/api/public_key/${msg.sender_id}`);
                const senderData = await senderPubRes.json();
                const decryptedText = await decryptMessage(
                    msg.encrypted_payload,
                    msg.nonce,
                    senderData.public_key,
                    privateKeyBase64
                );
                decryptedMessages.push({
                    text: decryptedText,
                    isOwn: msg.sender_id === userId,
                    senderId: msg.sender_id
                });
            } catch(e) {
                decryptedMessages.push({
                    text: "[🔒 Зашифровано]",
                    isOwn: false,
                    senderId: msg.sender_id
                });
            }
        }
        return decryptedMessages;
    } catch (error) {
        console.error('Load messages error:', error);
        return [];
    }
}

async function sendMessage(recipientId, messageText, senderId, senderPrivateKey) {
    try {
        const recipientKeyRes = await fetch(`${API_URL}/api/public_key/${recipientId}`);
        const recipientData = await recipientKeyRes.json();
        
        const encrypted = await encryptMessage(messageText, recipientData.public_key, senderPrivateKey);
        
        await fetch(`${API_URL}/api/send_message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                senderId: senderId,
                recipientId: recipientId,
                encryptedPayload: encrypted.payload,
                nonce: encrypted.nonce
            })
        });
        return true;
    } catch (error) {
        console.error('Send message error:', error);
        return false;
    }
}

function showLoginUI() {
    const app = document.getElementById('app');
    if (!app) return;
    
    app.innerHTML = `
        <div class="login-area">
            <h2>🔒 Speak</h2>
            <p style="color:#888;">Безопасный мессенджер</p>
            <input type="text" id="userId" placeholder="Ваш ID (alice, bob...)" autocomplete="off">
            <button id="loginBtn">Начать общение</button>
            <p style="font-size: 12px; color:#888;">Сохраните ваш ID — он уникален</p>
        </div>
    `;
    
    const btn = document.getElementById('loginBtn');
    if (btn) {
        btn.onclick = async () => {
            const input = document.getElementById('userId');
            const userId = input ? input.value.trim() : '';
            if (!userId) {
                alert('Введите ID');
                return;
            }
            const success = await register(userId);
            if (success) {
                location.reload();
            } else {
                alert('Ошибка регистрации. Проверьте сервер.');
            }
        };
    }
}

async function loadChatList() {
    try {
        const response = await fetch(`${API_URL}/api/messages/${currentUser}`);
        const messages = await response.json();
        const chats = new Map();
        for (const msg of messages) {
            if (!chats.has(msg.sender_id)) {
                chats.set(msg.sender_id, msg.sender_id);
            }
        }
        
        const contactsDiv = document.getElementById('contactsArea');
        if (contactsDiv) {
            const chatIds = Array.from(chats.keys());
            if (chatIds.length === 0) {
                contactsDiv.innerHTML = '<div style="color:#888; padding:8px;">➕ Напишите кому-нибудь</div>';
            } else {
                contactsDiv.innerHTML = chatIds.map(id => `
                    <div class="contact-chip" data-id="${id}">${id}</div>
                `).join('');
                
                document.querySelectorAll('.contact-chip').forEach(el => {
                    el.onclick = () => {
                        currentChat = el.getAttribute('data-id');
                        loadMessagesForChat(currentChat);
                    };
                });
            }
        }
    } catch (error) {
        console.error('Load chat list error:', error);
    }
}

function showMainUI() {
    const app = document.getElementById('app');
    if (!app) return;
    
    app.innerHTML = `
        <div class="container">
            <div class="header">💬 Speak — ${currentUser}</div>
            <div class="contacts-area" id="contactsArea"></div>
            <div class="chat-area" id="chatArea"></div>
            <div class="input-area">
                <input type="text" id="messageInput" placeholder="Сообщение...">
                <button id="sendBtn">→</button>
            </div>
        </div>
    `;
    
    loadChatList();
    
    const sendBtn = document.getElementById('sendBtn');
    if (sendBtn) {
        sendBtn.onclick = async () => {
            if (!currentChat) {
                alert('Выберите контакт');
                return;
            }
            const input = document.getElementById('messageInput');
            const text = input ? input.value.trim() : '';
            if (!text) return;
            
            await sendMessage(currentChat, text, currentUser, privateKey);
            if (input) input.value = '';
            await loadMessagesForChat(currentChat);
        };
    }
}

async function loadMessagesForChat(chatId) {
    const messages = await loadMessages(currentUser, privateKey);
    const chatArea = document.getElementById('chatArea');
    if (chatArea) {
        const relevant = messages.filter(m => m.senderId === chatId || m.senderId === currentUser);
        if (relevant.length === 0) {
            chatArea.innerHTML = '<div style="text-align:center; color:#888;">💬 Напишите первое сообщение</div>';
        } else {
            chatArea.innerHTML = relevant.map(m => `
                <div class="message ${m.isOwn ? 'own' : 'other'}">
                    <strong>${m.isOwn ? 'Вы' : m.senderId}:</strong> ${m.text}
                </div>
            `).join('');
            chatArea.scrollTop = chatArea.scrollHeight;
        }
    }
}

async function startApp() {
    if (!window.sodium) {
        setTimeout(startApp, 100);
        return;
    }
    
    await initSodium();
    
    const savedUserId = localStorage.getItem('speak_userId');
    if (savedUserId) {
        currentUser = savedUserId;
        privateKey = localStorage.getItem('speak_privateKey');
        showMainUI();
    } else {
        showLoginUI();
    }
}

startApp();

setInterval(() => {
    if (currentUser && currentChat) {
        loadMessagesForChat(currentChat);
    }
}, 3000);
