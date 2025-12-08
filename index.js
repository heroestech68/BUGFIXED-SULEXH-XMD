/**
 * Cleaned index.js — BUGFIXED-SULEXH-TECH
 * - No branded forwarded message on connect
 * - No automatic session deletion
 * - QR/pair-code printing preserved if enabled
 * - Auto-reconnect logic kept
 */

require('./settings')
const { Boom } = require('@hapi/boom')
const fs = require('fs')
const chalk = require('chalk')
const path = require('path')
const axios = require('axios')
const { handleMessages, handleGroupParticipantUpdate, handleStatus } = require('./main')
const PhoneNumber = require('awesome-phonenumber')
const { imageToWebp, videoToWebp, writeExifImg, writeExifVid } = require('./lib/exif')
const { smsg, isUrl, generateMessageTag, getBuffer, getSizeMedia, fetch, sleep, reSize } = require('./lib/myfunc')

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  jidDecode,
  proto,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  delay
} = require("@whiskeysockets/baileys")

const NodeCache = require("node-cache")
const pino = require("pino")
const readline = require("readline")
const { rmSync } = require('fs')
const store = require('./lib/lightweight_store')

// --- persistent store
store.readFromFile()
setInterval(() => store.writeToFile(), settings.storeWriteInterval || 10000)

// --- small GC & memory guard (optional)
setInterval(() => { if (global.gc) global.gc() }, 60_000)
setInterval(() => {
  const used = process.memoryUsage().rss / 1024 / 1024
  if (used > 450) {
    console.log('⚠️ Memory too high, restarting bot...')
    process.exit(1)
  }
}, 30_000)

// --- globals / pairing flags
let phoneNumber = "911234567890"
let owner = JSON.parse(fs.readFileSync('./data/owner.json', 'utf8') || '[]')

global.botname = "KNIGHT BOT"
global.themeemoji = "•"
const pairingCode = !!phoneNumber || process.argv.includes("--pairing-code")
const useMobile = process.argv.includes("--mobile")

// only create readline in interactive shells
const rl = process.stdin.isTTY ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null
const question = (text) => rl ? new Promise((res) => rl.question(text, res)) : Promise.resolve(settings.ownerNumber || phoneNumber)

// --- watchdog and safe start
let lastActivity = Date.now()
function touchActivity() { lastActivity = Date.now() }

let starting = false
async function safeStart() {
  if (starting) return
  starting = true
  try {
    await startXeonBotInc()
  } catch (e) {
    console.error("safeStart error:", e)
  } finally { starting = false }
}

// --- main start
async function startXeonBotInc() {
  try {
    if (!fs.existsSync('./session')) fs.mkdirSync('./session')

    let { version } = await fetchLatestBaileysVersion()
    const { state, saveCreds } = await useMultiFileAuthState(`./session`)
    const msgRetryCounterCache = new NodeCache()

    const XeonBotInc = makeWASocket({
      version,
      logger: pino({ level: 'silent' }),
      // keep old behavior: print QR in terminal only when pairingCode is false
      printQRInTerminal: !pairingCode,
      browser: ["BUGFIXED-SULEXH-TECH", "Chrome", "20.0.04"],
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }))
      },
      markOnlineOnConnect: true,
      generateHighQualityLinkPreview: true,
      syncFullHistory: false,
      getMessage: async (key) => {
        try {
          let jid = jidNormalizedUser(key.remoteJid)
          let msg = await store.loadMessage(jid, key.id)
          return msg?.message || ""
        } catch (e) { return "" }
      },
      msgRetryCounterCache,
      defaultQueryTimeoutMs: 60000,
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 10000
    })

    // expose caches and save creds
    XeonBotInc.msgRetryCounterCache = msgRetryCounterCache
    XeonBotInc.ev.on('creds.update', saveCreds)
    store.bind(XeonBotInc.ev)

    // update activity on events
    XeonBotInc.ev.on('connection.update', () => touchActivity())
    XeonBotInc.ev.on('messages.upsert', () => touchActivity())

    // messages.upsert — single handler
    XeonBotInc.ev.on('messages.upsert', async (upsert) => {
      try {
        const messages = upsert?.messages || upsert
        const type = upsert?.type || (Array.isArray(messages) ? 'notify' : undefined)
        const msg = Array.isArray(messages) ? messages[0] : messages
        if (!msg || !msg.message) return

        // unwrap ephemeral
        if (msg.message && Object.keys(msg.message)[0] === 'ephemeralMessage') {
          msg.message = msg.message.ephemeralMessage?.message ?? msg.message
        }

        // ignore status broadcast
        if (msg.key?.remoteJid === 'status@broadcast') {
          await handleStatus(XeonBotInc, upsert).catch(() => {})
          return
        }

        // privacy/public checks (keep older behavior)
        if (!XeonBotInc.public && !msg.key?.fromMe && type === 'notify') {
          const isGroup = msg.key?.remoteJid?.endsWith?.('@g.us')
          if (!isGroup) return
        }

        if (msg.key?.id && typeof msg.key.id === 'string' && msg.key.id.startsWith('BAE5') && msg.key.id.length === 16) return

        const chatUpdate = { messages: [msg], type }
        await handleMessages(XeonBotInc, chatUpdate, true)
      } catch (err) {
        console.error("Error in messages.upsert:", err)
        try {
          if (upsert?.messages?.[0]?.key?.remoteJid) {
            await XeonBotInc.sendMessage(upsert.messages[0].key.remoteJid, { text: '❌ An error occurred while processing your message.' }).catch(() => {})
          }
        } catch {}
      }
    })

    // connection.update — clearer, non-branded
    let reconnectAttempts = 0
    XeonBotInc.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update

      if (qr) {
        // The library may print QR when `printQRInTerminal` is true.
        // We'll also show a minimal console hint.
        console.log(chalk.yellow("📌 QR generated (scan or use pair-code flow if enabled)"))
      }

      if (connection === 'open') {
        reconnectAttempts = 0
        console.log(chalk.green("Bot connected successfully!"))
        console.log(chalk.gray(`Connected as: ${XeonBotInc.user?.id ?? 'unknown'}`))
        // do NOT send forwarded/promo messages to your own number — remove that behavior
      }

      if (connection === "close") {
        const reason = lastDisconnect?.error ? new Boom(lastDisconnect.error).output.statusCode : null
        console.log("Connection closed - reason:", reason)

        // If credentials are rejected (logged out), inform but DO NOT auto-delete session files.
        if (reason === DisconnectReason.loggedOut || reason === 401) {
          console.error("⚠️ Credentials rejected / logged out. Session is no longer valid. You must re-authenticate manually.")
          // stop auto restart so you can re-pair manually; do not delete session automatically
          return
        }

        // other reasons — attempt exponential-backoff restart
        reconnectAttempts++
        const wait = Math.min(60, 2 ** reconnectAttempts) * 1000
        console.log(`Auto-restarting bot in ${wait/1000}s (attempt ${reconnectAttempts})...`)
        await delay(wait).catch(() => {})
        safeStart()
      }
    })

    // contacts.update
    XeonBotInc.ev.on('contacts.update', updates => {
      for (const contact of updates) {
        let id = XeonBotInc.decodeJid ? XeonBotInc.decodeJid(contact.id) : contact.id
        store.contacts[id] = { id, name: contact.notify }
      }
    })

    // small convenience helpers
    XeonBotInc.decodeJid = (jid) => {
      if (!jid) return jid
      if (/:\d+@/gi.test(jid)) {
        let decode = jidDecode(jid) || {}
        return (decode.user ? decode.user + '@' + decode.server : jid)
      } else return jid
    }

    XeonBotInc.getName = (jid, withoutContact = false) => {
      jid = XeonBotInc.decodeJid(jid)
      withoutContact = XeonBotInc.withoutContact || withoutContact

      if (jid.endsWith("@g.us")) {
        return new Promise(async (resolve) => {
          const contact = store.contacts[jid] || await XeonBotInc.groupMetadata(jid).catch(() => ({})) || {}
          resolve(contact.name || contact.subject || jid)
        })
      } else {
        const contact =
          jid === '0@s.whatsapp.net' ? { id: jid, name: 'WhatsApp' }
            : jid === XeonBotInc.decodeJid(XeonBotInc.user?.id || '') ? XeonBotInc.user
              : store.contacts[jid] || {}

        return (!withoutContact && contact.name) || contact.subject || jid
      }
    }

    XeonBotInc.public = true
    XeonBotInc.serializeM = (m) => smsg(XeonBotInc, m, store)

    // Pairing code behavior: keep existing flow but minimal output
    if (pairingCode && !state.creds.registered) {
      if (useMobile) throw new Error('Cannot use pairing code with mobile api')

      let pn = !!global.phoneNumber ? global.phoneNumber : await question(chalk.greenBright("Enter your WhatsApp number (e.g. 254712345678): "))
      pn = pn.replace(/\D/g, '')
      const apn = require('awesome-phonenumber')
      if (!apn("+" + pn).isValid()) {
        console.log(chalk.red("Invalid phone number format"))
        process.exit(1)
      }

      setTimeout(async () => {
        try {
          let code = await XeonBotInc.requestPairingCode(pn)
          code = code?.match(/.{1,4}/g)?.join("-")
          console.log(chalk.bgGreen("PAIRING CODE:"), code)
        } catch (err) {
          console.error("Failed to request pairing code:", err)
        }
      }, 1500)
    }

    // presence heartbeat
    setInterval(async () => {
      try { if (XeonBotInc?.user?.id) await XeonBotInc.sendPresenceUpdate("available").catch(()=>{}) } catch {}
    }, 20_000)

    // watchdog - if no activity for 5 min, restart
    setInterval(() => {
      const now = Date.now()
      if (now - lastActivity > (5 * 60 * 1000)) {
        console.warn("Watchdog: no activity detected >5m, restarting...")
        safeStart()
      }
    }, 60_000)

    return XeonBotInc

  } catch (e) {
    console.error("Error starting bot:", e)
    await delay(2000).catch(() => {})
    safeStart()
  }
}

// start
safeStart().catch(err => {
  console.error("Fatal start error:", err)
  process.exit(1)
})

// global crash handlers
process.on("uncaughtException", (err) => {
  console.error("uncaughtException:", err)
  safeStart()
})

process.on("unhandledRejection", (err) => {
  console.error("unhandledRejection:", err)
  safeStart()
})

// hot reload (optional)
let file = require.resolve(__filename)
fs.watchFile(file, () => {
  fs.unwatchFile(file)
  console.log("♻️ Reloading...")
  delete require.cache[file]
  require(file)
})
