/**
 * Fixed index.js — BUGFIXED-SULEXH-TECH (cleaned)
 * - Does NOT auto-delete ./session
 * - Removes branded forwarded connect messages
 * - Keeps QR / pairing-code printing (optional)
 * - Safer reconnection (exponential backoff)
 * - Saves credentials on creds.update
 *
 * NOTE: No hacking/crash/admin-abuse features included.
 */

require('./settings')
const fs = require('fs')
const path = require('path')
const chalk = require('chalk')
const pino = require('pino')
const { Boom } = require('@hapi/boom')
const NodeCache = require('node-cache')
const readline = require('readline')

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

const store = require('./lib/lightweight_store')
const { handleMessages, handleGroupParticipantUpdate, handleStatus } = require('./main')

// --- initialization & store
if (!fs.existsSync('./session')) fs.mkdirSync('./session')
store.readFromFile()
setInterval(() => store.writeToFile(), settings.storeWriteInterval || 10000)

// --- config flags
const pairingCodeFlag = !!global.phoneNumber || process.argv.includes("--pairing-code")
const useMobile = process.argv.includes("--mobile")
const rl = process.stdin.isTTY ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null
const question = (text) => rl ? new Promise(res => rl.question(text, res)) : Promise.resolve(settings.ownerNumber || (global.phoneNumber || ""))

// watchdog / activity
let lastActivity = Date.now()
function touchActivity() { lastActivity = Date.now() }

// safe single-start guard
let starting = false
async function safeStart() {
  if (starting) return
  starting = true
  try { await startXeonBotInc() } catch (e) { console.error('safeStart:', e) }
  starting = false
}

async function startXeonBotInc() {
  try {
    const { version } = await fetchLatestBaileysVersion()
    const { state, saveCreds } = await useMultiFileAuthState('./session')
    const msgRetryCounterCache = new NodeCache()

    const sock = makeWASocket({
      version,
      logger: pino({ level: 'silent' }),
      // you asked QR printed in terminal as optional: set printQRInTerminal to true
      // If you prefer pairing code only, use --pairing-code flag and set printQRInTerminal:false
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
      defaultQueryTimeoutMs: 60_000,
      connectTimeoutMs: 60_000,
      keepAliveIntervalMs: 10_000
    })

    // expose and bind
    sock.msgRetryCounterCache = msgRetryCounterCache
    sock.ev.on('creds.update', saveCreds)
    store.bind(sock.ev)

    // touch activity on key events
    sock.ev.on('messages.upsert', () => touchActivity())
    sock.ev.on('connection.update', () => touchActivity())

    // unified messages handler
    sock.ev.on('messages.upsert', async (upsert) => {
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

        // privacy/public checks
        if (!sock.public && !msg.key?.fromMe && type === 'notify') {
          const isGroup = msg.key?.remoteJid?.endsWith?.('@g.us')
          if (!isGroup) return
        }

        if (msg.key?.id && typeof msg.key.id === 'string' && msg.key.id.startsWith('BAE5') && msg.key.id.length === 16) return

        const chatUpdate = { messages: [msg], type }
        await handleMessages(sock, chatUpdate, true)
      } catch (err) {
        console.error('messages.upsert error:', err)
        try {
          const jid = upsert?.messages?.[0]?.key?.remoteJid
          if (jid) await sock.sendMessage(jid, { text: '❌ An error occurred while processing your message.' }).catch(()=>{})
        } catch {}
      }
    })

    // other event bindings
    sock.ev.on('group-participants.update', async (ev) => {
      await handleGroupParticipantUpdate(sock, ev).catch(()=>{})
    })
    sock.ev.on('status.update', async (s) => handleStatus(sock, s).catch(()=>{}))
    sock.ev.on('messages.reaction', async (s) => handleStatus(sock, s).catch(()=>{}))

    // contacts
    sock.ev.on('contacts.update', updates => {
      for (const c of updates) {
        const id = sock.decodeJid ? sock.decodeJid(c.id) : c.id
        store.contacts[id] = { id, name: c.notify }
      }
    })

    // helper methods
    sock.decodeJid = (jid) => {
      if (!jid) return jid
      if (/:\d+@/gi.test(jid)) {
        const d = jidDecode(jid) || {}
        return (d.user ? d.user + '@' + d.server : jid)
      }
      return jid
    }
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
    sock.serializeM = m => (typeof m === 'object' ? m : m)

    // pairing-code flow (if requested)
    if (pairingCodeFlag && !state.creds.registered) {
      if (useMobile) throw new Error('Cannot use pairing code with mobile api')
      const pnRaw = await question('Enter your WhatsApp number (e.g. 254712345678): ')
      const pn = (pnRaw || '').replace(/\D/g,'')
      const apn = require('awesome-phonenumber')
      if (!apn('+'+pn).isValid()) {
        console.log(chalk.red('Invalid phone number format for pairing code.'))
      } else {
        setTimeout(async () => {
          try {
            if (typeof sock.requestPairingCode === 'function') {
              let code = await sock.requestPairingCode(pn)
              code = code?.match(/.{1,4}/g)?.join('-') ?? code
              console.log(chalk.bgGreen('PAIRING CODE:'), code)
            } else {
              console.log(chalk.yellow('Pairing code flow not supported by this Baileys version — use QR.'))
            }
          } catch (err) {
            console.error('Error requesting pairing code:', err)
          }
        }, 1000)
      }
    }

    // connection.update — safer
    let reconnectAttempts = 0
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update

      if (qr) {
        console.log(chalk.yellow('📌 QR generated (scan if you want).'))
      }

      if (connection === 'open') {
        reconnectAttempts = 0
        console.log(chalk.green('✔ Bot connected successfully!'))
        console.log(chalk.gray(`Connected as: ${sock.user?.id || 'unknown'}`))
        // no promotional/forwarded messages sent here
      }

      if (connection === 'close') {
        // get numeric status code if present
        const statusCode = lastDisconnect?.error ? new Boom(lastDisconnect.error).output.statusCode : null
        // log full error for debugging (cleaned)
        console.warn('Connection closed:', lastDisconnect?.error || 'unknown reason', 'statusCode=', statusCode)

        // If credentials invalid (loggedOut or 401) — ask for manual re-auth
        if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
          console.error('⚠️ Credentials rejected / logged out. Session no longer valid. Please re-authenticate manually.')
          // Do NOT delete session automatically — keep files so user can inspect and re-upload if needed.
          return
        }

        // For stream/connection conflicts and other transient errors, retry with backoff.
        reconnectAttempts++
        const waitSec = Math.min(60, Math.pow(2, Math.min(6, reconnectAttempts))) // 2,4,8,16,32,64 -> capped 60s
        console.log(`Reconnecting in ${waitSec}s (attempt ${reconnectAttempts})...`)
        await delay(waitSec * 1000).catch(()=>{})
        safeStart()
      }
    })

    // presence heartbeat (keep bot visible)
    setInterval(async () => { try { if (sock?.user?.id) await sock.sendPresenceUpdate('available').catch(()=>{}) } catch {} }, 20_000)

    // watchdog: restart if no activity
    setInterval(() => {
      if (Date.now() - lastActivity > (5 * 60 * 1000)) {
        console.warn('Watchdog: no activity >5m — restarting...')
        safeStart()
      }
    }, 60_000)

    return sock
  } catch (err) {
    console.error('Failed to start bot:', err)
    await delay(2000).catch(()=>{})
    safeStart()
  }
}

// start
safeStart().catch(e => { console.error('Fatal start error:', e); process.exit(1) })

// crash handlers
process.on('uncaughtException', (err) => {
  console.error('uncaughtException:', err)
  safeStart()
})
process.on('unhandledRejection', (err) => {
  console.error('unhandledRejection:', err)
  safeStart()
})

// hot reload (optional)
let file = require.resolve(__filename)
fs.watchFile(file, () => {
  fs.unwatchFile(file)
  console.log('♻️ Reloading index.js')
  delete require.cache[file]
  require(file)
})
