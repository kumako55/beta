import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  downloadMediaMessage
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import pino from 'pino'

const META_AI = "13135550002@s.whatsapp.net"
const userMap = new Map() // har user ka alag track

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('/data/auth')
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
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

  // pairing code — sirf jab register nahi
  if (!state.creds.registered) {
    setTimeout(async () => {
      try {
        const phone = process.env.PHONE?.replace(/[^0-9]/g, '')
        if (!phone) {
          console.log("PHONE env missing. e.g. PHONE=923001234567")
          return
        }
        const code = await sock.requestPairingCode(phone)
        console.log("\n=== PAIRING CODE ===")
        console.log(code)
        console.log("WhatsApp > Linked Devices > Link with phone number\n")
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
    }

    if (connection === 'close') {
      const status = new Boom(lastDisconnect?.error)?.output?.statusCode
      console.log("Disconnected:", status)

      if (status === DisconnectReason.loggedOut) {
        console.log("Logged out, delete /data/auth and pair again")
        return
      }
      // 5 sec wait karke reconnect, taake 408 na aaye
      console.log("Reconnecting in 5s...")
      setTimeout(start, 5000)
    }
  })

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const m = messages[0]
    if (!m.message || m.key.fromMe) return

    const from = m.key.remoteJid
    const text = m.message.conversation || m.message.extendedTextMessage?.text || ""

    // user -> Meta AI
    if (text.toLowerCase().startsWith("ai ") && from!== META_AI) {
      const prompt = text.slice(3).trim()
      if (!prompt) return

      userMap.set(META_AI, from) // is prompt ka jawab kis ko dena hai
      await sock.sendMessage(META_AI, { text: prompt })
      await sock.sendMessage(from, { text: "soch raha hun..." })
      return
    }

    // Meta AI -> user
    if (from === META_AI) {
      const target = userMap.get(META_AI)
      if (!target) return

      try {
        if (m.message.imageMessage) {
          const buf = await downloadMediaMessage(m, 'buffer', {}, { logger: undefined })
          await sock.sendMessage(target, { image: buf, caption: m.message.imageMessage.caption || "" })
        } else {
          const reply = m.message.conversation || m.message.extendedTextMessage?.text || "..."
          await sock.sendMessage(target, { text: reply })
        }
      } catch (e) {
        await sock.sendMessage(target, { text: "error: " + e.message })
      }
      userMap.delete(META_AI)
    }
  })
}

start()
