import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  downloadMediaMessage
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import pino from 'pino'
import http from 'http'

const META_AI = "13135550002@s.whatsapp.net"
const userMap = new Map()
let globalPairingCode = null // Store code for browser display

// HTTP server for Render health checks and CODE display
const server = http.createServer((req, res) => {
  if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>WhatsApp Meta AI Bot</title>
        <style>
          body {
            font-family: monospace;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            padding: 20px;
          }
          .container {
            background: white;
            border-radius: 20px;
            padding: 40px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            text-align: center;
            max-width: 500px;
          }
          .status {
            color: #10b981;
            font-size: 24px;
            margin-bottom: 20px;
          }
          .code-box {
            background: #f3f4f6;
            padding: 30px;
            border-radius: 15px;
            margin: 20px 0;
            border: 2px dashed #667eea;
          }
          .code {
            font-size: 48px;
            font-weight: bold;
            letter-spacing: 10px;
            color: #667eea;
            font-family: monospace;
          }
          .instruction {
            text-align: left;
            background: #e5e7eb;
            padding: 20px;
            border-radius: 10px;
            margin-top: 20px;
          }
          .step {
            margin: 10px 0;
            font-size: 14px;
          }
          .timestamp {
            color: #6b7280;
            font-size: 12px;
            margin-top: 20px;
          }
          button {
            background: #667eea;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 5px;
            cursor: pointer;
            margin-top: 10px;
            font-size: 16px;
          }
          button:hover {
            background: #764ba2;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="status">✅ WhatsApp Bot is Active</div>
          <div class="code-box">
            <div style="font-size: 14px; margin-bottom: 10px;">🔐 YOUR 8-DIGIT PAIRING CODE</div>
            <div class="code" id="code">${globalPairingCode ? globalPairingCode : 'Loading...'}</div>
            <button onclick="copyCode()">📋 Copy Code</button>
          </div>
          <div class="instruction">
            <strong>📱 INSTRUCTIONS:</strong><br/>
            <div class="step">1️⃣ Open WhatsApp on your phone</div>
            <div class="step">2️⃣ Go to Settings → Linked Devices</div>
            <div class="step">3️⃣ Tap on "Link a Device"</div>
            <div class="step">4️⃣ Enter the code above</div>
          </div>
          <div class="timestamp">
            Last Update: ${new Date().toISOString()}<br/>
            Status: Bot is running and waiting for connection
          </div>
        </div>
        <script>
          function copyCode() {
            const code = document.getElementById('code').innerText;
            navigator.clipboard.writeText(code).then(() => {
              alert('Code copied: ' + code);
            });
          }
          // Auto refresh every 30 seconds to get updated code
          setTimeout(() => {
            location.reload();
          }, 30000);
        </script>
      </body>
      </html>
    `);
  } else if (req.url === '/api/code') {
    // API endpoint to get code as JSON
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      code: globalPairingCode,
      status: 'active',
      timestamp: new Date().toISOString()
    }));
  } else if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'healthy', code: globalPairingCode ? 'generated' : 'pending' }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`🌐 Web server running on port ${PORT}`);
  console.log(`✅ Open browser at: http://localhost:${PORT}\n`);
});

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('/data/auth')
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: ['Render', 'Chrome', '124.0.0'],
    connectTimeoutMs: 60000,
    keepAliveIntervalMs: 25000,
    markOnlineOnConnect: false,
    syncFullHistory: false
  })

  sock.ev.on('creds.update', saveCreds)

  // Generate pairing code
  if (!state.creds.registered) {
    console.log('\n🔄 No existing session found. Generating pairing code...\n')
    
    setTimeout(async () => {
      try {
        const phone = process.env.PHONE?.replace(/[^0-9]/g, '')
        if (!phone) {
          console.log("❌ PHONE env missing. Example: PHONE=923001234567")
          return
        }
        
        const code = await sock.requestPairingCode(phone)
        globalPairingCode = code // Store for browser display
        
        // Display in console as well
        console.log('\n' + '='.repeat(60))
        console.log('🔐 YOUR 8-DIGIT PAIRING CODE 🔐')
        console.log('='.repeat(60))
        console.log(`\n     ${code.split('').join(' ')}     \n`)
        console.log('='.repeat(60))
        console.log('\n📱 Browser mein code open karein:')
        console.log(`🌐 http://localhost:${PORT}\n`)
        
      } catch (e) {
        console.log("❌ Pairing error:", e.message)
      }
    }, 3000)
  }

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update
    console.log("📡 Connection state:", connection)

    if (connection === 'open') {
      console.log('\n✅ WhatsApp Connected Successfully!')
      console.log('🎉 Meta AI Bot is now online on Render!\n')
      console.log('💡 Usage: Send "ai your question" to bot\n')
      globalPairingCode = 'CONNECTED' // Update browser status
    }

    if (connection === 'close') {
      const status = new Boom(lastDisconnect?.error)?.output?.statusCode
      console.log("❌ Disconnected:", status)

      if (status === DisconnectReason.loggedOut) {
        console.log("🔴 Logged out! Delete /data/auth folder and restart")
        return
      }
      
      console.log("🔄 Reconnecting in 5 seconds...")
      setTimeout(start, 5000)
    }
  })

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const m = messages[0]
    if (!m.message || m.key.fromMe) return

    const from = m.key.remoteJid
    const text = m.message.conversation || m.message.extendedTextMessage?.text || ""

    // User to Meta AI
    if (text.toLowerCase().startsWith("ai ") && from !== META_AI) {
      const prompt = text.slice(3).trim()
      if (!prompt) return

      console.log(`📨 User ${from}: ${prompt}`)
      userMap.set(META_AI, from)
      await sock.sendMessage(META_AI, { text: prompt })
      await sock.sendMessage(from, { text: "🤔 Soch raha hun..." })
      console.log(`💬 Forwarded to Meta AI: ${prompt}`)
      return
    }

    // Meta AI to User
    if (from === META_AI) {
      const target = userMap.get(META_AI)
      if (!target) return

      try {
        if (m.message.imageMessage) {
          const buf = await downloadMediaMessage(m, 'buffer', {}, { logger: undefined })
          await sock.sendMessage(target, { image: buf, caption: m.message.imageMessage.caption || "" })
          console.log(`🖼️ Sent image to ${target}`)
        } else {
          const reply = m.message.conversation || m.message.extendedTextMessage?.text || "..."
          await sock.sendMessage(target, { text: reply })
          console.log(`🤖 Meta AI response to ${target}: ${reply.substring(0, 100)}`)
        }
      } catch (e) {
        await sock.sendMessage(target, { text: "❌ Error: " + e.message })
        console.error(`Error sending response: ${e.message}`)
      }
      userMap.delete(META_AI)
    }
  })
}

// Keep alive
setInterval(() => {
  console.log('💓 Bot heartbeat:', new Date().toISOString())
}, 45000)

// Error handlers
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error)
})

process.on('unhandledRejection', (error) => {
  console.error('Unhandled Rejection:', error)
})

console.log('🚀 Starting WhatsApp Meta AI Bot on Render...\n')
console.log(`🌐 Open browser to get pairing code: http://localhost:${PORT}\n`)
start().catch(console.error)
