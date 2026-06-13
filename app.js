let sodium = null;
let currentUser = null;
let privateKey = null;
let currentChat = null;

const API_URL = 'https://speak-backend-b43k.onrender.com'; // ⚠️ ЗАМЕНИТЕ! Например: 'https://speak-backend.onrender.com'

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
    const keys = await generateKeys();
    const response = await fetch(`${API_URL}/api/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            userId,
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
}

async function loadMessages(userId, privateKeyBase64) {
    const response = await fetch(`${API_URL}/api/messages/${userId}`);
    const messages = await response.json();
    
    const decryptedMessages = [];
    for (const msg of messages) {
        try {
            const senderPubRes = await fetch(`${API_URL}/api/public_key/${msg.sender_id}`);
            const senderData = await senderPubRes.json();
            const decryptedText = await decryptMessage(
                msg.encrypted_payload, msg.nonce, 
                senderData.public_key, privateKeyBase64
            );
            decryptedMessages.push({
                text: decryptedText,
                isOwn: msg.sender_id === userId,
                senderId: msg.sender_id,
                timestamp: msg.timestamp
            });
        } catch(e) {
            decryptedMessages.push({ text: "[🔒 Зашифровано]", isOwn: false, senderId: msg.sender_id });
        }
    }
    return decryptedMessages;
}

async function sendMessage(recipientId, messageText, senderId, senderPrivateKey) {
    const recipientKeyRes = await fetch(`${API_URL}/api/public_key/${recipientId}`);
    const recipientData = await recipientKeyRes.json();
    
    const encrypted = await encryptMessage(messageText, recipientData.public_key, senderPrivateKey);
    
    await fetch(`${API_URL}/api/send_message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            senderId,
            recipientId,
            encryptedPayload: encrypted.payload,
            nonce: encrypted.nonce
        })
    });
}

async function startApp() {
    await initSodium();
    
    const savedUserId = localStorage.getItem('speak_userId');
    if (savedUserId) {
        currentUser = savedUserId;
        privateKey = localStorage.getItem('speak_privateKey');
        showMainUI();
        await loadChatList();
    } else {
        showLoginUI();
    }
}

function showLoginUI() {
    document.getElementById('app').innerHTML = `
        <div class="login-area">
            <h2>🔒 Speak</h2>
            <p style="color:#888;">Безопасный мессенджер</p>
            <input type="text" id="userId" placeholder="Ваш ID (например: alice)" autocomplete="off">
            <button id="loginBtn">Начать общение</button>
            <p style="font-size: 12px; color: #888; margin-top: 20px;">⚠️ Сохраните ваш ID — он уникален</p>
            <p style="font-size: 11px; color: #555;">Сквозное шифрование | PWA | Без слежки</p>
        </div>
    `;
    document.getElementById('loginBtn').onclick = async () => {
        const userId = document.getElementById('userId').value.trim();
        if (!userId) return alert('Введите ID');
        const success = await register(userId);
        if (success) {
            location.reload();
        } else {
            alert('Ошибка регистрации');
        }
    };
}

async function loadChatList() {
    const response = await fetch(`${API_URL}/api/messages/${currentUser}`);
    const messages = await response.json();
    const chats = new Map();
    for (const msg of messages) {
        if (!chats.has(msg.sender_id)) {
            chats.set(msg.sender_id, { lastMessage: msg.timestamp, name: msg.sender_id });
        }
    }
    return Array.from(chats.keys());
}

function showMainUI() {
    document.getElementById('app').innerHTML = `
        <div class="container">
            <div class="header">
                💬 Speak — ${currentUser}
            </div>
            <div class="contacts-area" id="contactsArea">
                <div style="color:#888; padding: 8px;">Загрузка контактов...</div>
            </div>
            <div class="chat-area" id="chatArea">
                <div style="text-align:center; color:#888; margin-top: 40px;">👈 Выберите контакт</div>
            </div>
            <div class="input-area">
                <div class="file-attach" id="fileBtn">📎</div>
                <input type="text" id="messageInput" placeholder="Сообщение..." autocomplete="off">
                <button id="sendBtn">→</button>
            </div>
        </div>
    `;
    
    loadContactsAndMessages();
    
    document.getElementById('sendBtn').onclick = async () => {
        if (!currentChat) return alert('Выберите контакт');
        const input = document.getElementById('messageInput');
        const text = input.value.trim();
        if (!text) return;
        await sendMessage(currentChat, text, currentUser, privateKey);
        input.value = '';
        await loadMessagesForChat(currentChat);
    };
}

async function loadContactsAndMessages() {
    const chats = await loadChatList();
    const contactsDiv = document.getElementById('contactsArea');
    if (chats.length === 0) {
        contactsDiv.innerHTML = '<div style="color:#888; padding: 8px;">➕ Напишите кому-нибудь, указав его ID</div>';
    } else {
        contactsDiv.innerHTML = chats.map(contact => `
            <div class="contact-chip ${currentChat === contact ? 'active' : ''}" data-id="${contact}">
                ${contact}
            </div>
        `).join('');
        
        document.querySelectorAll('.contact-chip').forEach(el => {
            el.onclick = () => {
                currentChat = el.dataset.id;
                loadMessagesForChat(currentChat);
                loadContactsAndMessages();
            };
        });
    }
}

async function loadMessagesForChat(chatId) {
    const messages = await loadMessages(currentUser, privateKey);
    const chatArea = document.getElementById('chatArea');
    if (chatArea) {
        const relevantMessages = messages.filter(m => m.senderId === chatId || (m.senderId === currentUser && messages.some(x => x.senderId === chatId)));
        chatArea.innerHTML = relevantMessages.map(m => `
            <div class="message ${m.isOwn ? 'own' : 'other'}">
                <strong>${m.isOwn ? 'Вы' : m.senderId}:</strong> ${m.text}
            </div>
        `).join('');
        chatArea.scrollTop = chatArea.scrollHeight;
    }
}

startApp();

setInterval(async () => {
    if (currentUser && currentChat) {
        await loadMessagesForChat(currentChat);
    }
}, 5000);
