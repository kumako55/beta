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
let pairingRequested = false

const app = express()
app.use(express.json({ limit: '15mb' }))
const PORT = process.env.PORT || 10000

app.get('/', (req, res) => {
  res.json({
    status: "running",
    phone: process.env.PHONE || "not set",
    pairingCode: latestPairingCode,
    whatsapp_connected:!!sock?.user
  })
})

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
    const idx = waiting.indexOf(res)
    if (idx!== -1) {
      waiting.splice(idx, 1)
      res.status(504).json({ error: "Meta AI timeout" })
    }
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
    return res.status(500).json({ error: e.message })
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
    markOnlineOnConnect: true,
    syncFullHistory: false
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update
    console.log("Connection:", connection)

    if (connection === 'open') {
      console.log("✅ WhatsApp connected!")
      latestPairingCode = null
      pairingRequested = false
    }

    // ✅ FIX: pairing code tab mango jab connecting ho
    if (connection === 'connecting' &&!state.creds.registered &&!pairingRequested) {
      pairingRequested = true
      setTimeout(async () => {
        try {
          const phone = process.env.PHONE?.replace(/[^0-9]/g, '')
          if (!phone) {
            console.log("❌ PHONE env missing! Set PHONE=923001234567")
            return
          }
          console.log("Requesting pairing code for:", phone)
          const code = await sock.requestPairingCode(phone)
          latestPairingCode = code
          console.log("\n=================================")
          console.log("PAIRING CODE:", code)
          console.log("WhatsApp > Linked Devices > Link with phone number")
          console.log("Code expires in 20 seconds!")
          console.log("=================================\n")

          // 25 sec baad code clear karo
          setTimeout(() => { latestPairingCode = null }, 25000)

        } catch (e) {
          console.log("Pairing error:", e.message)
          pairingRequested = false
        }
      }, 3000)
    }

    if (connection === 'close') {
      const status = new Boom(lastDisconnect?.error)?.output?.statusCode
      if (status!== DisconnectReason.loggedOut) {
        setTimeout(start, 5000)
      } else {
        console.log("Logged out - delete /data/auth")
      }
    }
  })

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const m = messages[0]
    if (!m.message || m.key.fromMe) return
    const from = m.key.remoteJid
    const text = m.message.conversation || m.message.extendedTextMessage?.text || ""

    console.log("IN:", from, text.slice(0,30))

    if (text.toLowerCase().startsWith("ai ") &&!from.includes('1313555')) {
      const prompt = text.slice(3)
      userMap.set('target', from)
      await sock.sendMessage(META_AI, { text: prompt })
      await sock.sendMessage(from, { text: "soch raha..." })
      return
    }

    if (from.includes('1313555')) {
      console.log("← Meta AI:", text)
      if (waiting.length) {
        const res = waiting.shift()
        clearTimeout(res._timer)
        res.json({ type: "text", reply: text })
      }
      const target = userMap.get('target')
      if (target) {
        await sock.sendMessage(target, { text })
        userMap.delete('target')
      }
    }
  })
}

start()
