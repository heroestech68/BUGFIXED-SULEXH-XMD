/**
 * index.js — BUGFIXED-SULEXH-XMD / SULEXH BOT
 * - Minimal, non-branded start file
 * - Auto-reconnect, keep session, print QR/pairing code
 * - Watches ./session/creds.json for uploads from panel and reloads
 */

const fs = require('fs')
const path = require('path')
const chalk = require('chalk')
const pino = require('pino')
const NodeCache = require('node-cache')

/* --------- local modules (do not change) --------- */
const settings = require('./settings')                      // your settings file
const store = require('./lib/lightweight_store')            // your lightweight store (must implement readFromFile, writeToFile, bind, loadMessage, contacts)
const { handleMessages, handleGroupParticipantUpdate, handleStatus } = require('./main')

/* --------- baileys --------- */
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  jidNormalizedUser,
  jidDecode,
  makeCacheableSignalKeyStore,
  delay
} = require('@whiskeysockets/baileys')

/* --------- basic init --------- */
const SESSION_DIR = path.resolve(process.cwd(), 'session')
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true })

store.readFromFile()
setInterval(() => store.writeToFile(), settings.storeWriteInterval || 10000)

/* small GC & memory guard (optional) */
setInterval(() => { if (global.gc) global.gc() }, 60_000)
setInterval(() => {
  const used = process.memoryUsage().rss / 1024 / 1024
  if (used > (settings.maxMemoryMB || 600)) {
    console.log(chalk.red('Memory high, exiting so panel restarts container'))
    process.exit(1)
  }
}, 30_000)

/* pairing flags (use settings.ownerNumber or env) */
const phoneNumber = settings.ownerNumber || process.env.OWNER_NUMBER || ''
const pairingCodeFlag = !!phoneNumber || process.argv.includes('--pairing-code')
const useMobile = process.argv.includes('--mobile')

/* activity watchdog */
let lastActivity = Date.now()
function touchActivity(){ lastActivity = Date.now() }

/* single-start guard */
let starting = false
async function safeStart(){
  if (starting) return
  starting = true
  try {
    await startBot()
  } catch(e){
    console.error('safeStart error', e)
  } finally { starting = false }
}

/* attempt backoff state */
let backoffAttempt = 0
let socketInstance = null

async function startBot(){
  try {
    // fetch version
    const { version } = await fetchLatestBaileysVersion()
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR)
    const msgRetryCounterCache = new NodeCache()

    const sock = makeWASocket({
      version,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: true,                     // prints QR in terminal (scan optional)
      browser: [settings.browserName || 'SULEXH BOT', 'Chrome', '1.0'],
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }))
      },
      markOnlineOnConnect: true,
      generateHighQualityLinkPreview: true,
      syncFullHistory: false,
      getMessage: async (key) => {
        try {
          const jid = jidNormalizedUser(key?.remoteJid || '')
          const msg = await store.loadMessage(jid, key.id)
          return msg?.message || ''
        } catch { return '' }
      },
      msgRetryCounterCache,
      keepAliveIntervalMs: 10000,
      defaultQueryTimeoutMs: 60000,
      connectTimeoutMs: 60000
    })

    // expose for other parts if needed
    socketInstance = sock
    sock.msgRetryCounterCache = msgRetryCounterCache

    // save creds on updates
    sock.ev.on('creds.update', saveCreds)
    store.bind(sock.ev)

    // update activity on incoming events
    sock.ev.on('connection.update', () => touchActivity())
    sock.ev.on('messages.upsert', () => touchActivity())

    /* ---------- messages handler (delegates to your main handler) ---------- */
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

        // status updates
        if (msg.key?.remoteJid === 'status@broadcast') {
          await handleStatus(sock, upsert).catch(()=>{})
          return
        }

        // keep old privacy behavior (don't handle DMs in private mode)
        if (!sock.public && !msg.key?.fromMe && type === 'notify') {
          const isGroup = msg.key?.remoteJid?.endsWith?.('@g.us')
          if (!isGroup) return
        }

        // ignore handshake ephemeral ids
        if (msg.key?.id && typeof msg.key.id === 'string' && msg.key.id.startsWith('BAE5') && msg.key.id.length === 16) return

        // forward to user-provided handler
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

    /* ---------- contact & group handlers ---------- */
    sock.ev.on('contacts.update', updates => {
      for (const contact of updates) {
        const id = sock.decodeJid ? sock.decodeJid(contact.id) : contact.id
        store.contacts[id] = { id, name: contact.notify }
      }
    })

    sock.ev.on('group-participants.update', async (ev) => {
      await handleGroupParticipantUpdate(sock, ev).catch(()=>{})
    })

    sock.ev.on('status.update', async s => handleStatus(sock, s).catch(()=>{}))
    sock.ev.on('messages.reaction', async s => handleStatus(sock, s).catch(()=>{}))

    /* ---------- small helpers ---------- */
    sock.decodeJid = (jid) => {
      if (!jid) return jid
      if (/:\d+@/gi.test(jid)) {
        const dec = jidDecode(jid) || {}
        return dec.user && dec.server ? `${dec.user}@${dec.server}` : jid
      }
      return jid
    }

    sock.getName = (jid, withoutContact=false) => {
      jid = sock.decodeJid(jid)
      withoutContact = sock.withoutContact || withoutContact
      if (jid.endsWith('@g.us')) {
        return new Promise(async (res) => {
          const contact = store.contacts[jid] || await sock.groupMetadata(jid).catch(()=>({})) || {}
          res(contact.name || contact.subject || jid)
        })
      } else {
        const contact = jid === '0@s.whatsapp.net' ? { id: jid, name: 'WhatsApp' } : (store.contacts[jid] || {})
        return (!withoutContact && contact.name) || contact.subject || jid
      }
    }

    sock.public = true
    sock.serializeM = m => m

    /* ---------- pairing code (if requested) ---------- */
    if (pairingCodeFlag && !state.creds.registered) {
      if (useMobile) console.warn('Pairing code not supported with mobile flag')
      else if (typeof sock.requestPairingCode === 'function' && phoneNumber) {
        try {
          const raw = await sock.requestPairingCode(phoneNumber)
          const code = raw?.match(/.{1,4}/g)?.join('-') ?? String(raw)
          console.log(chalk.bgGreen.black('PAIRING CODE:'), chalk.greenBright(code))
          console.log(chalk.gray('Insert that code in WhatsApp -> Settings -> Linked devices -> Link a device'))
        } catch (err) {
          console.warn('Pairing code request failed (this is non-fatal):', err?.message ?? err)
        }
      } else {
        // library may not support pairing code -> QR shown in terminal
        console.log(chalk.yellow('Pairing-code flow unavailable — QR will be printed in terminal if needed.'))
      }
    }

    /* ---------- connection lifecycle ---------- */
    let reconnectAttempts = 0
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update

      if (qr) {
        console.log(chalk.yellow('📌 QR generated. (You can scan it or use your panel to upload creds.json)'))
      }

      if (connection === 'open') {
        reconnectAttempts = 0
        backoffAttempt = 0
        console.log(chalk.green('✔ Bot connected — ready'))
        // do not send any branded/forwarded promotional message here
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error ? new (require('@hapi/boom').Boom)(lastDisconnect.error).output.statusCode : null
        console.log(chalk.red('Connection closed — reason:'), statusCode)

        // If credentials invalid (logged out/401) — keep files, inform and wait for manual re-auth
        if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
          console.error('⚠️ Logged out or credentials rejected. Please upload new creds.json via panel or re-pair manually.')
          // do not delete session folder automatically
          // stop automatic restart so user can upload creds.json; file watcher will restart the bot when creds.json replaced
          return
        }

        // otherwise transient: exponential backoff restart
        reconnectAttempts++
        const wait = Math.min(60, 2 ** reconnectAttempts) * 1000
        console.log(`Auto-restarting in ${wait/1000}s (attempt ${reconnectAttempts})...`)
        await delay(wait).catch(()=>{})
        safeStart()
      }
    })

    /* ---------- presence heartbeat ---------- */
    setInterval(async () => {
      try { if (sock?.user?.id) await sock.sendPresenceUpdate('available').catch(()=>{}) } catch {}
    }, 20_000)

    /* ---------- watchdog ---------- */
    setInterval(() => {
      if (Date.now() - lastActivity > (5 * 60 * 1000)) {
        console.warn('Watchdog: no activity >5m; restarting...')
        safeStart()
      }
    }, 60_000)

    // success: return socket
    return sock

  } catch (err) {
    console.error('Error starting bot:', err)
    backoffAttempt = (backoffAttempt || 0) + 1
    const wait = Math.min(60, 2 ** backoffAttempt) * 1000
    console.log(`Retry start in ${wait/1000}s...`)
    await delay(wait).catch(()=>{})
    safeStart()
  }
}

/* ---------- watch session/creds.json uploaded by panel and restart when changed ---------- */
const CREDS_PATH = path.join(SESSION_DIR, 'creds.json')
fs.watch(SESSION_DIR, { persistent: false }, (eventType, filename) => {
  if (!filename) return
  const f = filename.toLowerCase()
  if (f === 'creds.json' || f.endsWith('.json')) {
    // small debounce
    setTimeout(() => {
      console.log(chalk.blue(`[watcher] Detected session file change (${eventType} ${filename}). Restarting bot to pick new credentials.`))
      safeStart()
    }, 1200)
  }
})

/* ---------- start ---------- */
safeStart().catch(err => {
  console.error('Fatal start error:', err)
  process.exit(1)
})

/* ---------- global crash handlers ---------- */
process.on('uncaughtException', (err) => {
  console.error('uncaughtException', err)
  safeStart()
})
process.on('unhandledRejection', (err) => {
  console.error('unhandledRejection', err)
  safeStart()
})

/* ---------- hot reload while developing (optional) ---------- */
try {
  const file = require.resolve(__filename)
  fs.watchFile(file, () => {
    fs.unwatchFile(file)
    console.log('♻️ Reloading index.js...')
    delete require.cache[file]
    require(file)
  })
} catch (e) { /* ignore when not allowed */ }
