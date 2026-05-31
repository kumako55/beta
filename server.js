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

// ✅ FIX 1: health ab JSON dega
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

// HTTP se prompt bhejo
app.post('/prompt', async (req, res) => {
  const prompt = req.body.prompt
  if (!prompt) return res.status(400).json({ error: "prompt missing" })
  if (!sock?.user) return res.status(503).json({ error: "WhatsApp not ready" })

  // ✅ FIX 2: timeout add
  const timer = setTimeout(() => {
    const idx = waiting.indexOf(res)
    if (idx!== -1) {
      waiting.splice(idx, 1)
      res.status(504).json({ error: "Meta AI timeout (90s)" })
    }
  }, 90000)

  waiting.push(res)

  try {
    await sock.sendMessage(META_AI, { text: prompt })
    console.log("→ Meta AI:", prompt)
  } catch (e) {
    clearTimeout(timer)
    waiting.pop()
    console.log("✗ SEND FAIL:", e.message) // ✅ FIX 3: error log
    return res.status(500).json({ error: "Send failed: " + e.message })
  }

  // timer ko response ke sath store karo
  res._timer = timer
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
    browser: ['Ubuntu', 'Chrome', '124.0.0'],
    connectTimeoutMs: 60000,
    keepAliveIntervalMs: 25000,
    markOnlineOnConnect: false,
    syncFullHistory: false
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
    if (!m.message || m.key.fromMe) return

    const from = m.key.remoteJid
    const text = m.message.conversation || m.message.extendedTextMessage?.text || ""

    // WhatsApp user -> ai command
    if (text.toLowerCase().startsWith("ai ") && from!== META_AI) {
      const prompt = text.slice(3).trim()
      if (!prompt) return
      userMap.set(META_AI, from)
      await sock.sendMessage(META_AI, { text: prompt })
      await sock.sendMessage(from, { text: "soch raha hun..." })
      return
    }

    // Meta AI ka reply
    if (from === META_AI) {
      console.log("← Meta AI:", text || "[image]")

      if (waiting.length > 0) {
        const res = waiting.shift()
        if (res._timer) clearTimeout(res._timer) // ✅ timer clear

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
            const reply = m.message.conversation || m.message.extendedTextMessage?.text || ""
            return res.json({ type: "text", reply })
          }
        } catch (e) {
          return res.status(500).json({ error: e.message })
        }
      }

      // WhatsApp user ko forward
      const target = userMap.get(META_AI)
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
        userMap.delete(META_AI)
      }
    }
  })
}

start()
