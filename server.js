import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import pino from 'pino'
import express from 'express'
import fs from 'fs' // ✅ ADDED

const META_AI = "13135550002@s.whatsapp.net"
const waiting = []
let latestPairingCode = null
let sock
let pairingRequested = false

// ✅ AUTO CLEAR AUTH ON START
try {
  if (fs.existsSync('/data/auth')) {
    fs.rmSync('/data/auth', { recursive: true, force: true })
    console.log("🗑️ Old auth cleared automatically")
  }
  fs.mkdirSync('/data/auth', { recursive: true })
} catch (e) {
  console.log("Auth clear error:", e.message)
}

const app = express()
app.use(express.json({ limit: '15mb' }))
const PORT = process.env.PORT || 10000

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    whatsapp_connected:!!sock?.user,
    pairing_code: latestPairingCode,
    waiting: waiting.length
  })
})

app.post('/prompt', async (req, res) => {
  const prompt = req.body.prompt
  if (!prompt) return res.status(400).json({ error: "prompt missing" })
  if (!sock?.user) return res.status(503).json({ error: "WhatsApp not ready" })

  const timer = setTimeout(() => {
    waiting.splice(waiting.indexOf(res), 1)
    res.status(504).json({ error: "Meta AI timeout" })
  }, 90000)

  waiting.push(res)
  res._timer = timer

  try {
    await sock.sendPresenceUpdate('composing', META_AI)
    await new Promise(r => setTimeout(r, 2000))
    await sock.sendMessage(META_AI, { text: prompt })
    console.log("→ Meta AI:", prompt)
  } catch (e) {
    clearTimeout(timer)
    waiting.pop()
    res.status(500).json({ error: e.message })
  }
})

app.listen(PORT, '0.0.0.0', () => console.log(`Listening on ${PORT}`))

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('/data/auth')
  const { version } = await fetchLatestBaileysVersion()

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: ['iPhone', 'Safari', '17.0'],
    markOnlineOnConnect: true
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update
    console.log("Connection:", connection)

    if (connection === 'open') {
      console.log("✅ Connected!")
      latestPairingCode = null
    }

    if (connection === 'connecting' &&!state.creds.registered &&!pairingRequested) {
      pairingRequested = true
      setTimeout(async () => {
        try {
          const phone = process.env.PHONE?.replace(/[^0-9]/g, '')
          if (!phone) return console.log("❌ Set PHONE=92300...")

          const code = await sock.requestPairingCode(phone)
          latestPairingCode = code

          console.log("\n================================")
          console.log("PAIRING CODE:", code)
          console.log("20 seconds me enter karo!")
          console.log("================================")

          setTimeout(() => latestPairingCode = null, 25000)
        } catch (e) {
          console.log("Pairing fail:", e.message)
          pairingRequested = false
        }
      }, 2000)
    }

    if (connection === 'close') {
      const status = new Boom(lastDisconnect?.error)?.output?.statusCode
      if (status!== DisconnectReason.loggedOut) setTimeout(start, 3000)
    }
  })

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const m = messages[0]
    if (!m.message || m.key.fromMe) return

    const from = m.key.remoteJid
    const text = m.message.conversation || m.message.extendedTextMessage?.text || ""

    if (from.includes('1313555')) {
      console.log("← Meta AI:", text)
      if (waiting.length) {
        const res = waiting.shift()
        clearTimeout(res._timer)
        res.json({ reply: text })
      }
    }
  })
}

start()
