import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function connectWithPairingCode() {
    // Environment variable se phone number lo
    const PHONE_NUMBER = process.env.PHONE;
    
    if (!PHONE_NUMBER) {
        console.error('❌ Error: PHONE number not found in environment variables!');
        console.log('Please create .env file with: PHONE=923001234567');
        process.exit(1);
    }
    
    console.log(`\n📱 Using phone number: ${PHONE_NUMBER}\n`);
    
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: ['Chrome (Linux)', '', ''],
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'open') {
            console.log('\n✅ Successfully connected!');
            console.log('🎉 WhatsApp is now linked with your number!\n');
            await sendToMetaAI(sock);
            setupMessageListener(sock);
        }
        
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                console.log('Reconnecting...');
                connectWithPairingCode();
            } else {
                console.log('Logged out. Please run again.');
            }
        }
    });

    console.log('🔐 Requesting 8-digit pairing code...\n');
    
    try {
        // Request pairing code using phone number from env
        const code = await sock.requestPairingCode(PHONE_NUMBER);
        console.log(`\n📱 YOUR 8-DIGIT CODE: ${code}\n`);
        console.log('👉 Open WhatsApp on your phone:');
        console.log('   Settings > Linked Devices > Link a Device');
        console.log(`   Enter this code: ${code}\n`);
        console.log('⏳ Waiting for connection...\n');
        
    } catch (error) {
        console.error('Error requesting pairing code:', error);
    }

    sock.ev.on('creds.update', saveCreds);
}

async function sendToMetaAI(sock) {
    const metaNumbers = [
        '13135550002@s.whatsapp.net',
        '12025550181@s.whatsapp.net',
    ];
    
    console.log('🤖 Attempting to contact Meta AI...\n');
    
    for (const jid of metaNumbers) {
        try {
            await sock.sendMessage(jid, { 
                text: 'Hello! Is this Meta AI?' 
            });
            console.log(`✓ Message sent to ${jid}`);
            await new Promise(r => setTimeout(r, 1000));
        } catch (err) {
            console.log(`✗ Failed: ${err.message}`);
        }
    }
}

function setupMessageListener(sock) {
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.key.fromMe && msg.message?.conversation) {
            console.log(`\n📨 Message: ${msg.message.conversation}`);
            
            // Auto-reply
            await sock.sendMessage(msg.key.remoteJid, { 
                text: '🤖 Auto-reply: I got your message!' 
            });
        }
    });
    
    console.log('👂 Listening for messages...\n');
}

// Run the code
connectWithPairingCode().catch(console.error);
