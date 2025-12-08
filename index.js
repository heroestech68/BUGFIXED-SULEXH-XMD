/**
 * Cleaned index.js — BUGFIXED-SULEXH-TECH
 * - settings declared early (fixes ReferenceError)
 * - No branded forwarded messages on connect
 * - QR printed in terminal (scan optional)
 * - Pairing code printed if pairing flow used
 * - Auto reconnect with exponential backoff
 * - No automatic deletion of session files
 */

const fs = require('fs')
const path = require('path')
const chalk = require('chalk')
const pino = require('pino')
const readline = require('readline')
const { rmSync } = require('fs')
const NodeCache = require('node-cache')

// --- must load config/store before using them (fix ReferenceError) ---
const settings = require('./settings')                           // your settings.js
const store = require('./lib/lightweight_store')                // lightweight store implementation
const { handleMessages, handleGroupParticipantUpdate, handleStatus } = require('./main')

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  jidDecode,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  delay
} = require('@whiskeysockets/baileys')

// persistent store init
store.readFromFile()
setInterval(() => store.writeToFile(), settings.storeWriteInterval || 10000)

// optional memory guard / GC (keep)
setInterval(() => { if (global.gc) global.gc() }, 60_000)
setInterval(() => {
  const used = process.memoryUsage().rss / 1024 / 1024
  if (used > (settings.maxMemoryMB || 450)) {
    console.log('⚠️ Memory too high, restarting bot (panel should restart container)...')
    process.exit(1)
  }
}, 30_000)

// small helpers / flags
let phoneNumber = settings.ownerNumber || process.env.OWNER_NUMBER || ''
let owner = null
try { owner = JSON.parse(fs.readFileSync('./data/owner.json', 'utf8')) } catch { owner = settings.ownerNumber || phoneNumber || [] }

global.botname = settings.botName || "KNIGHT BOT"
global.themeemoji = settings.themeemoji || '•'

const pairingCodeFlag = !!phoneNumber || process.argv.includes("--pairing-code")
const useMobile = process.argv.includes("--mobile")
const rl = process.stdin.isTTY ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null
const question = (text) => rl ? new Promise(res => rl.question(text, res)) : Promise.resolve(settings.ownerNumber || phoneNumber)

// watchdog activity
let lastActivity = Date.now()
function touchActivity() { lastActivity = Date.now() }

// safe single-start
let starting = false
async function safeStart() {
  if (starting) return
  starting = true
  try { await startBot() } catch (e) { console.error('safeStart error', e) }
  starting = false
}

/* ---------------- MAIN START ---------------- */
async function startBot() {
  try {
    if (!fs.existsSync('./session')) fs.mkdirSync('./session')

    const { version } = await fetchLatestBaileysVersion()
    const { state, saveCreds } = await useMultiFileAuthState('./session')
    const msgRetryCounterCache = new NodeCache()

    const sock = makeWASocket({
      version,
      logger: pino({ level: 'silent' }),
      // Print QR in terminal so scanning is optional — you asked for printed QR
      printQRInTerminal: true,
      browser: [settings.browserName || "KNIGHT BOT", "Chrome", "1.0"],
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }))
      },
      markOnlineOnConnect: true,
      generateHighQualityLinkPreview: true,
      syncFullHistory: false,
      getMessage: async (key) => {
        try {
          const jid = jidNormalizedUser(key.remoteJid || '')
          const msg = await store.loadMessage(jid, key.id)
          return msg?.message || ''
        } catch { return '' }
      },
      msgRetryCounterCache,
      keepAliveIntervalMs: 10000,
      defaultQueryTimeoutMs: 60000,
      connectTimeoutMs: 60000
    })

    // expose local caches & save credentials
    sock.msgRetryCounterCache = msgRetryCounterCache
    sock.ev.on('creds.update', saveCreds)
    store.bind(sock.ev)

    // update activity
    sock.ev.on('connection.update', () => touchActivity())
    sock.ev.on('messages.upsert', () => touchActivity())

    // messages handler (single unified)
    sock.ev.on('messages.upsert', async upsert => {
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
          await handleStatus(sock, upsert).catch(()=>{})
          return
        }

        // privacy/public checks (old behavior)
        if (!sock.public && !msg.key?.fromMe && type === 'notify') {
          const isGroup = msg.key?.remoteJid?.endsWith?.('@g.us')
          if (!isGroup) return
        }

        // skip some known ephemeral ids
        if (msg.key?.id && typeof msg.key.id === 'string' && msg.key.id.startsWith('BAE5') && msg.key.id.length === 16) return

        // forward to main handler
        const chatUpdate = { messages: [msg], type }
        await handleMessages(sock, chatUpdate, true)
      } catch (err) {
        console.error('Error in messages.upsert:', err)
        try {
          const jid = upsert?.messages?.[0]?.key?.remoteJid
          if (jid) await sock.sendMessage(jid, { text: '❌ An error occurred while processing your message.' }).catch(()=>{})
        } catch {}
      }
    })

    // group participants
    sock.ev.on('group-participants.update', async update => {
      await handleGroupParticipantUpdate(sock, update).catch(()=>{})
    })

    // status & reactions
    sock.ev.on('status.update', async s => handleStatus(sock, s).catch(()=>{}))
    sock.ev.on('messages.reaction', async s => handleStatus(sock, s).catch(()=>{}))

    // contact updates
    sock.ev.on('contacts.update', updates => {
      for (const c of updates) {
        const id = sock.decodeJid ? sock.decodeJid(c.id) : c.id
        store.contacts[id] = { id, name: c.notify }
      }
    })

    // decodeJid helper
    sock.decodeJid = (jid) => {
      if (!jid) return jid
      if (/:\d+@/gi.test(jid)) {
        const decode = jidDecode(jid) || {}
        return (decode.user ? decode.user + '@' + decode.server : jid)
      }
      return jid
    }

    // name helper
    sock.getName = (jid, withoutContact=false) => {
      jid = sock.decodeJid(jid)
      withoutContact = sock.withoutContact || withoutContact
      if (jid.endsWith('@g.us')) {
        return new Promise(async res => {
          const contact = store.contacts[jid] || await sock.groupMetadata(jid).catch(()=>({})) || {}
          res(contact.name || contact.subject || jid)
        })
      } else {
        const contact = jid === '0@s.whatsapp.net' ? { id: jid, name: 'WhatsApp' } : (store.contacts[jid] || {})
        return (!withoutContact && contact.name) || contact.subject || jid
      }
    }

    sock.public = true
    sock.serializeM = m => (typeof m === 'object' ? m : m) // keep compatibility for your handleMessages

    // Pairing code flow (if enabled): show pairing code in console (no auto-delete)
    if (pairingCodeFlag && !state.creds.registered) {
      if (useMobile) throw new Error('Cannot use pairing code with mobile api')
      let pn = phoneNumber || await question(chalk.greenBright('Enter your WhatsApp number (e.g. 254712345678): '))
      pn = pn.replace(/\D/g,'')
      const apn = require('awesome-phonenumber')
      if (!apn('+'+pn).isValid()) {
        console.log(chalk.red('Invalid phone number format for pairing code.'))
      } else {
        setTimeout(async ()=>{
          try {
            // requestPairingCode may be available depending on library version
            if (typeof sock.requestPairingCode === 'function') {
              let code = await sock.requestPairingCode(pn)
              code = code?.match(/.{1,4}/g)?.join('-') ?? code
              console.log(chalk.bgGreen('PAIRING CODE:'), code)
            } else {
              console.log(chalk.yellow('Pairing code flow not supported by this Baileys version — QR shown instead.'))
            }
          } catch (err) {
            console.error('Error requesting pairing code:', err)
          }
        }, 1000)
      }
    }

    // connection.update: auto reconnect with backoff, don't auto-delete session files
    let reconnectAttempts = 0
    sock.ev.on('connection.update', async update => {
      const { connection, lastDisconnect, qr } = update

      if (qr) {
        console.log(chalk.yellow('📌 QR generated (scan if you want)'))
      }

      if (connection === 'open') {
        reconnectAttempts = 0
        console.log(chalk.green('✔ Bot connected successfully!'))
        console.log(chalk.gray(`Connected as: ${sock.user?.id || 'unknown'}`))
        // DO NOT send branded or forwarded promotional messages here
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error ? new (require('@hapi/boom').Boom)(lastDisconnect.error).output.statusCode : null
        console.log('Connection closed - reason:', statusCode)

        // If logged out/401 → credentials invalid. Must re-authenticate manually.
        if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
          console.error('⚠️ Credentials rejected / logged out. Session invalid. Re-authentication required.')
          // Do NOT delete session automatically; stop reconnection attempts
          return
        }

        // transient errors: exponential backoff restart
        reconnectAttempts++
        const wait = Math.min(60, 2 ** reconnectAttempts) * 1000
        console.log(`Auto-restarting bot in ${wait/1000}s (attempt ${reconnectAttempts})...`)
        await delay(wait).catch(()=>{})
        safeStart()
      }
    })

    // presence heartbeat
    setInterval(async ()=>{ try { if (sock?.user?.id) await sock.sendPresenceUpdate('available').catch(()=>{}) } catch {} }, 20_000)

    // watchdog: restart if frozen
    setInterval(()=>{
      if (Date.now() - lastActivity > (5 * 60 * 1000)) {
        console.warn('Watchdog: no activity >5m. Restarting...')
        safeStart()
      }
    }, 60_000)

    return sock
  } catch (err) {
    console.error('Error starting bot:', err)
    await delay(2000).catch(()=>{})
    safeStart()
  }
}

/* ---------------- start ---------------- */
safeStart().catch(err => {
  console.error('Fatal start error:', err)
  process.exit(1)
})

// global crash handlers
process.on('uncaughtException', (err) => { console.error('uncaughtException', err); safeStart() })
process.on('unhandledRejection', (err) => { console.error('unhandledRejection', err); safeStart() })

// hot reload for development
let file = require.resolve(__filename)
fs.watchFile(file, () => {
  fs.unwatchFile(file)
  console.log('♻️ Reloading index.js')
  delete require.cache[file]
  require(file)
})
