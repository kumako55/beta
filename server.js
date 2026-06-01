import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import http from 'http';

const server = http.createServer((req, res) => {
    if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            status: 'active', 
            message: 'WhatsApp Bot is running',
            timestamp: new Date().toISOString()
        }));
    } else if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'healthy' }));
    } else {
        res.writeHead(404);
        res.end();
    }
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`🌐 HTTP Server running on port ${PORT}`);
});

async function connectWithPairingCode() {
    const PHONE_NUMBER = process.env.PHONE;
    
    if (!PHONE_NUMBER) {
        console.error('❌ Error: PHONE environment variable not set!');
        process.exit(1);
    }
    
    console.log(`\n📱 Phone: ${PHONE_NUMBER}`);
    console.log('🔄 Generating 8-digit pairing code...\n');
    
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: ['Render WhatsApp Bot', 'Chrome', '120.0.0'],
        shouldSyncHistoryMessage: () => false,
        markOnlineOnConnect: true,
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'open') {
            console.log('\n✅ WhatsApp Connected Successfully!');
            console.log('🎉 Bot is online\n');
            listenForMessages(sock);
        }
        
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                console.log('🔄 Reconnecting...');
                setTimeout(() => connectWithPairingCode(), 5000);
            }
        }
    });

    // Generate pairing code and wait
    try {
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const pairingCode = await sock.requestPairingCode(PHONE_NUMBER);
        
        // Clear screen type effect (optional)
        console.log('\n' + '='.repeat(60));
        console.log('🔐 YOUR 8-DIGIT PAIRING CODE 🔐');
        console.log('='.repeat(60));
        console.log(`\n     ${pairingCode.split('').join(' ')}     \n`);
        console.log('='.repeat(60));
        console.log('\n📱 INSTRUCTIONS:');
        console.log('1️⃣  Open WhatsApp on your phone');
        console.log('2️⃣  Go to Settings → Linked Devices');
        console.log('3️⃣  Tap on "Link a Device"');
        console.log('4️⃣  Enter this code:', pairingCode);
        console.log('\n⏰ This code will expire in 2 minutes');
        console.log('💡 You have 120 seconds to enter the code\n');
        
        // ⭐ IMPORTANT: Wait 2 minutes before continuing
        console.log('⏳ Waiting for you to enter the code...');
        console.log('   Bot will stay active for 2 minutes\n');
        
        // Wait for 2 minutes (120 seconds) for user to enter code
        await new Promise(resolve => setTimeout(resolve, 120000));
        
        console.log('✅ Time is up! Checking connection status...\n');
        
        // Keep bot running even after time is up
        console.log('🤖 Bot is still running and waiting for connection');
        console.log('   It will connect automatically when you scan\n');
        
    } catch (error) {
        console.error('❌ Failed to get pairing code:', error.message);
        console.log('Retrying in 10 seconds...');
        setTimeout(() => connectWithPairingCode(), 10000);
    }

    sock.ev.on('creds.update', saveCreds);
}

function listenForMessages(sock) {
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.key.fromMe && msg.message?.conversation) {
            const from = msg.key.remoteJid;
            const text = msg.message.conversation;
            
            console.log(`\n📨 Message from ${from}: ${text}`);
            
            if (text.toLowerCase().includes('hello') || text.toLowerCase().includes('hi')) {
                await sock.sendMessage(from, { 
                    text: '👋 Hello! This is WhatsApp Bot.' 
                });
                console.log(`✓ Replied to ${from}`);
            }
        }
    });
    
    console.log('👂 Listening for messages...\n');
}

// Keep bot alive
setInterval(() => {
    console.log('💓 Bot is alive:', new Date().toLocaleTimeString());
}, 60000);

// Start bot
console.log('🚀 Starting WhatsApp Bot...\n');
connectWithPairingCode().catch(console.error);
