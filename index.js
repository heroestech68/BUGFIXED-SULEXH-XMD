/**
 * Knight Bot - fixed index.js
 * - No branded forwarded message on connect
 * - Do NOT auto-delete session on loggedOut
 * - Pairing-code printed once per run (throttled)
 * - Exponential backoff reconnect for transient errors
 * - Cleaner connection logging and conflict handling
 *
 * NOTE: I will not add or help add hacking/crashing features.
 */

require('./settings')
const { Boom } = require('@hapi/boom')
const fs = require('fs')
const chalk = require('chalk')
const path = require('path')
const pino = require('pino')
const readline = require('readline')
const NodeCache = require('node-cache')

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  delay
} = require('@whiskeysockets/baileys')

const store = require('./lib/lightweight_store')
const { handleMessages, handleGroupParticipantUpdate, handleStatus } = require('./main')

// persist store
store.readFromFile()
setInterval(() => store.writeToFile(), (global.settings && global.settings.storeWriteInterval) || 10000)

// small helpers
const rl = process.stdin.isTTY ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null
const question = (text) => rl ? new Promise(res => rl.question(text, res)) : Promise.resolve((global.settings && global.settings.ownerNumber) || '')

// Flags to avoid repeated pairing requests
let pairingRequested = false

// Activity watchdog
let lastActivity = Date.now()
function touchActivity(){ lastActivity = Date.now() }

// Single start guard
let starting = false
async function safeStart(){ if (starting) return; starting = true; try { await startXeonBotInc() } catch(e){ console.error('safeStart error', e) } finally { starting = false } }

async function startXeonBotInc(){
  try {
    if (!fs.existsSync('./session')) fs.mkdirSync('./session', { recursive: true })

    const { version } = await fetchLatestBaileysVersion()
    const { state, saveCreds } = await useMultiFileAuthState('./session')
    const msgRetryCounterCache = new NodeCache()

    const sock = makeWASocket({
      version,
      logger: pino({ level: 'silent' }),
      // you wanted QR printed in terminal so keep it enabled
      printQRInTerminal: true,
      browser: ["KnightBot", "Chrome", "1.0"],
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
      keepAliveIntervalMs: 10_000,
    })

    // attach store and credential saver
    sock.msgRetryCounterCache = msgRetryCounterCache
    sock.ev.on('creds.update', saveCreds)
    store.bind(sock.ev)

    // touch activity when certain events happen
    sock.ev.on('connection.update', () => touchActivity())
    sock.ev.on('messages.upsert', () => touchActivity())

    // unified messages handler (keeps your handleMessages logic)
    sock.ev.on('messages.upsert', async upsert => {
      try {
        const messages = upsert?.messages || upsert
        const type = upsert?.type || (Array.isArray(messages) ? 'notify' : undefined)
        const msg = Array.isArray(messages) ? messages[0] : messages
        if (!msg || !msg.message) return

        // unwrap ephemeral messages
        if (msg.message && Object.keys(msg.message)[0] === 'ephemeralMessage') {
          msg.message = msg.message.ephemeralMessage?.message ?? msg.message
        }

        // don't process status broadcast
        if (msg.key?.remoteJid === 'status@broadcast') {
          await handleStatus(sock, upsert).catch(() => {})
          return
        }

        // privacy/public: same behavior as before
        if (!sock.public && !msg.key?.fromMe && type === 'notify') {
          const isGroup = msg.key?.remoteJid?.endsWith?.('@g.us')
          if (!isGroup) return
        }

        // skip certain ephemeral IDs
        if (msg.key?.id && typeof msg.key.id === 'string' && msg.key.id.startsWith('BAE5') && msg.key.id.length === 16) return

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

    // group participant updates
    sock.ev.on('group-participants.update', async update => {
      await handleGroupParticipantUpdate(sock, update).catch(()=>{})
    })

    // status and reactions -> forward to your handler
    sock.ev.on('status.update', async s => handleStatus(sock, s).catch(()=>{}))
    sock.ev.on('messages.reaction', async s => handleStatus(sock, s).catch(()=>{}))

    // contacts update -> keep store consistent
    sock.ev.on('contacts.update', updates => {
      for (const c of updates) {
        const id = sock.decodeJid ? sock.decodeJid(c.id) : c.id
        store.contacts[id] = { id, name: c.notify }
      }
    })

    // helper: decodeJid
    sock.decodeJid = (jid) => {
      if (!jid) return jid
      if (/:\d+@/gi.test(jid)) {
        const decode = jidDecode(jid) || {}
        return decode.user ? (decode.user + '@' + decode.server) : jid
      }
      return jid
    }

    // helper: getName
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
    sock.serializeM = (m) => m

    // Pairing-code flow: request pairing code once per process if needed
    try {
      if (!pairingRequested && !state.creds?.registered) {
        pairingRequested = true
        // If your settings provide a number, use it; else ask (non-interactive returns settings.ownerNumber or '')
        const phone = (global.phoneNumber || (process.argv.includes('--owner') ? process.argv[process.argv.indexOf('--owner')+1] : null) || (global.settings && global.settings.ownerNumber)) || await question('Enter WhatsApp number (international, no +): ')
        const pn = (String(phone || '')).replace(/\D/g, '')
        if (pn) {
          const apn = require('awesome-phonenumber')
          if (!apn('+' + pn).isValid()) {
            console.log(chalk.red('Pairing number invalid. Skipping pairing-code request.'))
          } else {
            // request pairing code if supported
            if (typeof sock.requestPairingCode === 'function') {
              try {
                const raw = await sock.requestPairingCode(pn)
                const code = raw?.match(/.{1,4}/g)?.join('-') ?? raw
                console.log(chalk.bgGreen('PAIRING CODE:'), code)
                console.log(chalk.yellow('Insert this code in WhatsApp > Settings > Linked Devices > Link a device'))
              } catch (err) {
                console.error('Failed to request pairing code:', err)
              }
            } else {
              console.log(chalk.yellow('Pairing-code API not available in this Baileys version. Use QR instead.'))
            }
          }
        } else {
          console.log(chalk.yellow('No phone provided for pairing-code flow; use QR or upload creds.json via panel.'))
        }
      }
    } catch (err) {
      console.error('Pairing code flow error:', err)
    }

    // connection.update handler with safer behavior
    let reconnectAttempts = 0
    sock.ev.on('connection.update', async update => {
      const { connection, lastDisconnect, qr } = update

      if (qr) {
        console.log(chalk.yellow('📌 QR generated (scan if you want)'))
      }

      if (connection === 'connecting') {
        console.log(chalk.yellow('🔄 Connecting to WhatsApp...'))
      }

      if (connection === 'open') {
        reconnectAttempts = 0
        console.log(chalk.green('✔ Bot connected successfully!'))
        console.log(chalk.gray(`Connected as: ${sock.user?.id || 'unknown'}`))
        // intentionally do not send promotional/forwarded messages
      }

      if (connection === 'close') {
        // get reason code safely
        let statusCode = null
        try {
          statusCode = lastDisconnect?.error ? new Boom(lastDisconnect.error).output.statusCode : null
        } catch (e) {
          // fallback when Boom can't parse
          statusCode = (lastDisconnect?.error && lastDisconnect.error.status) || null
        }

        console.log(chalk.red('Connection closed - reason:'), statusCode, lastDisconnect?.error?.toString?.() || lastDisconnect)

        // if logged out / credentials rejected -> do NOT delete session automatically
        if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
          console.error(chalk.red('⚠️ Credentials rejected / logged out (401). Session invalid. Please re-authenticate or upload new creds.json via panel.'))
          // stop trying to auto-restart here — require manual intervention
          return
        }

        // handle conflict stream errors or transient errors with backoff
        reconnectAttempts++
        const waitSec = Math.min(60, 2 ** Math.min(reconnectAttempts, 8))
        console.log(chalk.yellow(`Transient disconnect — restarting in ${waitSec}s (attempt ${reconnectAttempts})`))
        await delay(waitSec * 1000).catch(()=>{})
        safeStart()
      }
    })

    // presence / heartbeat
    setInterval(async () => {
      try { if (sock?.user?.id) await sock.sendPresenceUpdate('available').catch(()=>{}) } catch {}
    }, 20_000)

    // watchdog: restart if frozen
    setInterval(() => {
      if (Date.now() - lastActivity > (5 * 60 * 1000)) {
        console.warn('Watchdog: no activity >5m -> restarting...')
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

// start safely
safeStart().catch(err => {
  console.error('Fatal start error:', err)
  process.exit(1)
})

// global crash handlers
process.on('uncaughtException', (err) => {
  console.error('uncaughtException', err)
  // try to restart safely
  safeStart()
})

process.on('unhandledRejection', (err) => {
  console.error('unhandledRejection', err)
  safeStart()
})

// optional hot reload for dev
try {
  const file = require.resolve(__filename)
  fs.watchFile(file, () => {
    fs.unwatchFile(file)
    console.log('♻️ Reloading index.js')
    delete require.cache[file]
    try { require(file) } catch (e) { console.error('reload error', e) }
  })
} catch (e) { /* ignore in restricted environments */ }
