import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';

async function connectWithPairingCode() {
    const PHONE_NUMBER = process.env.PHONE;
    
    if (!PHONE_NUMBER) {
        console.error('❌ Error: PHONE environment variable not set!');
        process.exit(1);
    }
    
    console.log(`\n📱 Phone: ${PHONE_NUMBER}`);
    console.log('🔄 Requesting 8-digit pairing code...\n');
    
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,     // QR band
        qrTimeout: 30000,              // QR timeout
        browser: ['Render WhatsApp Bot', 'Chrome', '120.0.0'],
        // Important: QR generate hi na ho
        shouldSyncHistoryMessage: () => false,
        markOnlineOnConnect: false,
    });

    // Handle connection events
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'open') {
            console.log('\n✅ WhatsApp Connected Successfully!');
            console.log('🎉 Bot is online on Render\n');
            await testMetaAI(sock);
            listenForMessages(sock);
        }
        
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                console.log('🔄 Reconnecting...');
                connectWithPairingCode();
            } else {
                console.log('❌ Logged out. Please restart the service.');
            }
        }
    });

    // Request 8-digit pairing code (No QR!)
    try {
        // Wait a bit for socket to be ready
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const pairingCode = await sock.requestPairingCode(PHONE_NUMBER);
        
        console.log('\n╔════════════════════════════════════════╗');
        console.log('║     YOUR 8-DIGIT PAIRING CODE         ║');
        console.log(`║                                       ║`);
        console.log(`║        🔐 ${pairingCode} 🔐        ║`);
        console.log(`║                                       ║`);
        console.log('╚════════════════════════════════════════╝\n');
        console.log('📱 Instructions:');
        console.log('1. Open WhatsApp on your phone');
        console.log('2. Go to Settings → Linked Devices');
        console.log('3. Tap on "Link a Device"');
        console.log(`4. Enter this code: ${pairingCode}`);
        console.log('\n⏳ Waiting for connection...\n');
        
    } catch (error) {
        console.error('❌ Failed to get pairing code:', error.message);
        console.log('Retrying in 5 seconds...');
        setTimeout(() => connectWithPairingCode(), 5000);
        return;
    }

    // Save credentials
    sock.ev.on('creds.update', saveCreds);
}

async function testMetaAI(sock) {
    console.log('📤 Testing Meta AI connection...');
    
    // Different possible Meta AI numbers
    const testNumbers = [
        '13135550002@s.whatsapp.net',
        '12025550181@s.whatsapp.net',
    ];
    
    for (const number of testNumbers) {
        try {
            await sock.sendMessage(number, { 
                text: 'Hello! Testing connection.' 
            });
            console.log(`✓ Sent to ${number}`);
        } catch (err) {
            console.log(`✗ Failed to send to ${number}: ${err.message}`);
        }
    }
}

function listenForMessages(sock) {
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.key.fromMe && msg.message?.conversation) {
            const from = msg.key.remoteJid;
            const text = msg.message.conversation;
            
            console.log(`\n📨 Message from ${from}: ${text}`);
            
            // Auto reply
            if (text.toLowerCase().includes('hello') || text.toLowerCase().includes('hi')) {
                await sock.sendMessage(from, { 
                    text: '👋 Hello! This is an automated response.' 
                });
                console.log(`✓ Replied to ${from}`);
            }
        }
    });
    
    console.log('👂 Listening for incoming messages...\n');
}

// Start the bot
console.log('🚀 Starting WhatsApp Bot on Render...\n');
connectWithPairingCode().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
