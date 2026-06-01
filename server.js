import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  downloadMediaMessage
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import pino from 'pino'
import express from 'express'

const META_AI = "13135550002@s.whatsapp.net"
const userMap = new Map()
const waiting = []
let latestPairingCode = null
let sock

// ---------- EXPRESS ----------
const app = express()
app.use(express.json({ limit: '15mb' }))
const PORT = process.env.PORT || 10000

app.get('/', (req, res) => {
  res.json({
    status: "running",
    bot: "WhatsApp Meta AI",
    phone: process.env.PHONE || "not set",
    pairingCode: latestPairingCode || null,
    whatsapp_connected:!!sock?.user
  })
})

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    whatsapp_connected:!!sock?.user,
    pairing_needed:!!latestPairingCode,
    pairing_code: latestPairingCode,
    waiting: waiting.length,
    uptime: Math.floor(process.uptime())
  })
})

app.get('/test', (req,res) => res.json({pong: Date.now()}))

app.post('/prompt', async (req, res) => {
  const prompt = req.body.prompt
  if (!prompt) return res.status(400).json({ error: "prompt missing" })
  if (!sock?.user) return res.status(503).json({ error: "WhatsApp not ready" })

  const timer = setTimeout(() => {
    const idx = waiting.indexOf(res)
    if (idx!== -1) {
      waiting.splice(idx, 1)
      res.status(504).json({ error: "Meta AI timeout (90s)" })
    }
  }, 90000)

  waiting.push(res)
  res._timer = timer

  try {
    // ✅ UPDATE 1: phone jaisa behavior
    await sock.sendPresenceUpdate('available', META_AI)
    await new Promise(r => setTimeout(r, 1500))
    await sock.sendPresenceUpdate('composing', META_AI)
    await new Promise(r => setTimeout(r, 2500))

    await sock.sendMessage(META_AI, { text: prompt })
    await sock.sendPresenceUpdate('paused', META_AI)

    console.log("→ Meta AI:", prompt)
  } catch (e) {
    clearTimeout(timer)
    waiting.pop()
    console.log("✗ SEND FAIL:", e.message)
    return res.status(500).json({ error: "Send failed: " + e.message })
  }
})

app.listen(PORT, '0.0.0.0', () => console.log(`Express listening on ${PORT}`))

// ---------- WHATSAPP ----------
async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('/data/auth')
  const { version } = await fetchLatestBaileysVersion()

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    // ✅ UPDATE 2: iPhone bano, Ubuntu nahi
    browser: ['iPhone', 'Safari', '17.0'],
    connectTimeoutMs: 60000,
    keepAliveIntervalMs: 20000,
    markOnlineOnConnect: true, // ✅ UPDATE 3
    syncFullHistory: true, // ✅ UPDATE 4
    defaultQueryTimeoutMs: 0
  })

  sock.ev.on('creds.update', saveCreds)

  if (!state.creds.registered) {
    setTimeout(async () => {
      try {
        const phone = process.env.PHONE?.replace(/[^0-9]/g, '')
        if (!phone) return console.log("PHONE env missing")
        const code = await sock.requestPairingCode(phone)
        latestPairingCode = code
        console.log("\n=== PAIRING CODE ===", code)
      } catch (e) {
        console.log("Pairing error:", e.message)
      }
    }, 3000)
  }

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update
    console.log("Connection:", connection)

    if (connection === 'open') {
      console.log("WhatsApp connected!")
      latestPairingCode = null
      // ✅ UPDATE 5: connect hote hi presence
      await sock.sendPresenceUpdate('available')
    }
    if (connection === 'close') {
      const status = new Boom(lastDisconnect?.error)?.output?.statusCode
      console.log("Disconnected:", status)
      if (status!== DisconnectReason.loggedOut) {
        setTimeout(start, 5000)
      }
    }
  })

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const m = messages[0]
    if (!m.message) return

    const from = m.key.remoteJid
    const text = m.message.conversation || m.message.extendedTextMessage?.text || ""

    // ✅ UPDATE 6: har message log
    console.log("IN:", from, "fromMe:", m.key.fromMe, "text:", text.slice(0,40))

    if (m.key.fromMe) return

    // WhatsApp user -> ai command
    if (text.toLowerCase().startsWith("ai ") &&!from.includes('1313555')) {
      const prompt = text.slice(3).trim()
      if (!prompt) return
      userMap.set('target', from)

      await sock.sendPresenceUpdate('composing', META_AI)
      await new Promise(r => setTimeout(r, 1500))
      await sock.sendMessage(META_AI, { text: prompt })
      await sock.sendMessage(from, { text: "soch raha hun..." })
      return
    }

    // ✅ UPDATE 7: includes check (lid bhi pakde)
    if (from.includes('1313555')) {
      console.log("← Meta AI REPLY:", text || "[image]")

      if (waiting.length > 0) {
        const res = waiting.shift()
        if (res._timer) clearTimeout(res._timer)

        try {
          if (m.message.imageMessage) {
            const buf = await downloadMediaMessage(m, 'buffer', {}, { logger: pino({ level: 'silent' }) })
            return res.json({
              type: "image",
              mime: "image/jpeg",
              caption: m.message.imageMessage.caption || "",
              data: buf.toString('base64')
            })
          } else {
            return res.json({ type: "text", reply: text })
          }
        } catch (e) {
          return res.status(500).json({ error: e.message })
        }
      }

      const target = userMap.get('target')
      if (target) {
        try {
          if (m.message.imageMessage) {
            const buf = await downloadMediaMessage(m, 'buffer', {}, { logger: pino({ level: 'silent' }) })
            await sock.sendMessage(target, { image: buf, caption: m.message.imageMessage.caption || "" })
          } else {
            await sock.sendMessage(target, { text: text || "..." })
          }
        } catch (e) {
          await sock.sendMessage(target, { text: "error: " + e.message })
        }
        userMap.delete('target')
      }
    }
  })
}

start()
