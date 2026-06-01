import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import pino from 'pino'
import express from 'express'
import fs from 'fs'
import path from 'path'

const META_AI = "13135550002@s.whatsapp.net"
const waiting = []
let latestPairingCode = null
let sock

// ✅ SAFE AUTH CLEAR - EBUSY fix
const AUTH_DIR = '/data/auth'
try {
  if (fs.existsSync(AUTH_DIR)) {
    const files = fs.readdirSync(AUTH_DIR)
    for (const file of files) {
      try {
        fs.unlinkSync(path.join(AUTH_DIR, file))
      } catch {}
    }
    console.log(`🗑️ Cleared ${files.length} auth files`)
  } else {
    fs.mkdirSync(AUTH_DIR, { recursive: true })
  }
} catch (e) {
  console.log("Auth clear skipped:", e.message)
}

const app = express()
app.use(express.json())
const PORT = process.env.PORT || 10000

app.get('/health', (req, res) => res.json({
  ok: true,
  connected:!!sock?.user,
  pairing_code: latestPairingCode
}))

app.post('/prompt', async (req, res) => {
  if (!sock?.user) return res.status(503).json({ error: "not ready" })
  const prompt = req.body.prompt
  waiting.push(res)
  setTimeout(() => {
    const i = waiting.indexOf(res)
    if (i>-1) { waiting.splice(i,1); res.status(504).json({error:"timeout"}) }
  }, 90000)

  await sock.sendMessage(META_AI, { text: prompt })
})

app.listen(PORT, () => console.log("Listening on", PORT))

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
  const { version } = await fetchLatestBaileysVersion()

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    browser: ['iPhone', 'Safari', '17.0'],
    markOnlineOnConnect: true
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
    console.log("Connection:", connection)

    if (connection === 'open') {
      console.log("✅ WhatsApp connected!")
      latestPairingCode = null
    }

    if (connection === 'close' &&!state.creds.registered) {
      // auto request pairing
      setTimeout(async () => {
        try {
          const phone = process.env.PHONE?.replace(/[^0-9]/g, '')
          if (!phone) return
          const code = await sock.requestPairingCode(phone)
          latestPairingCode = code
          console.log("\n=== PAIRING CODE:", code, "===\n")
        } catch (e) {
          console.log("Pairing error:", e.message)
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

    if (from.includes('1313555') && waiting.length) {
      const res = waiting.shift()
      res.json({ reply: text })
      console.log("← Meta AI:", text)
    }
  })
}

start()
