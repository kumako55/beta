import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import http from 'http';

// Create HTTP server for health checks
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

// Start HTTP server on port 10000
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`🌐 HTTP Server running on port ${PORT}`);
    console.log(`✅ Health check available at: http://localhost:${PORT}/health\n`);
});

// WhatsApp Bot Logic
async function connectWithPairingCode() {
    const PHONE_NUMBER = process.env.PHONE;
    
    if (!PHONE_NUMBER) {
        console.error('❌ Error: PHONE environment variable not set!');
        console.log('Please add PHONE in Render Environment Variables');
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
        shouldSyncHistoryMessage: () => false,
        markOnlineOnConnect: false,
        // Keep connection alive
        keepAliveInterval: 30000,
        patchMessageBeforeSending: (message) => message,
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
    
    // Handle connection errors
    sock.ev.on('connection.update', (update) => {
        if (update.connection === 'connecting') {
            console.log('🟡 Connecting to WhatsApp...');
        }
    });
}

async function testMetaAI(sock) {
    console.log('📤 Testing Meta AI connection...');
    
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
                    text: '👋 Hello! This is an automated response from WhatsApp Bot running on Render.com' 
                });
                console.log(`✓ Replied to ${from}`);
            }
        }
    });
    
    console.log('👂 Listening for incoming messages...\n');
}

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, closing server...');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('Unhandled Rejection:', error);
});

// Start the bot
console.log('🚀 Starting WhatsApp Bot on Render...');
console.log(`🖥️  Environment: ${process.env.NODE_ENV || 'production'}\n`);
connectWithPairingCode().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
