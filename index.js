/**
 * index.js (cleaned & fixed)
 * Keeps sessions permanent (no auto-delete), preserves pairing code printing,
 * avoids branded forwarded messages and adds safer reconnect/backoff logic.
 */

require('./settings')
const { Boom } = require('@hapi/boom')
const fs = require('fs')
const chalk = require('chalk')
const pino = require('pino')
const NodeCache = require('node-cache')
const readline = require('readline')

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

/* ---------- init store & settings ---------- */
store.readFromFile()
const settings = require('./settings')
setInterval(() => store.writeToFile(), settings.storeWriteInterval || 10000)

/* ---------- flags / helpers ---------- */
const rl = process.stdin.isTTY ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null
const question = (text) => rl ? new Promise(res => rl.question(text, res)) : Promise.resolve(settings.ownerNumber || '')

let phoneNumber = settings.ownerNumber || process.env.OWNER_NUMBER || ''   // keep your existing owner number if present
const pairingCodeFlag = !!phoneNumber || process.argv.includes('--pairing-code')
const useMobile = process.argv.includes('--mobile')

let pairingRequested = false           // ensure we only request pairing code once per run
let lastActivity = Date.now()
function touchActivity(){ lastActivity = Date.now() }

/* ---------- main start function ---------- */
async function startBot(){
  try {
    if (!fs.existsSync('./session')) fs.mkdirSync('./session', { recursive: true })

    const { version } = await fetchLatestBaileysVersion()
    const { state, saveCreds } = await useMultiFileAuthState('./session')
    const msgRetryCounterCache = new NodeCache()

    const sock = makeWASocket({
      version,
      logger: pino({ level: 'silent' }),
      // print QR in terminal so scanning is optional (you asked for printed QR)
      // NOTE: modern Baileys may deprecate this - connection.update 'qr' event will still show.
      printQRInTerminal: true,
      browser: [settings.browserName || 'KNIGHT BOT', 'Chrome', '1.0'],
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }))
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
      defaultQueryTimeoutMs: 60000,
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 10000
    })

    // persist credentials
    sock.ev.on('creds.update', saveCreds)
    store.bind(sock.ev)

    // track activity
    sock.ev.on('connection.update', () => touchActivity())
    sock.ev.on('messages.upsert', () => touchActivity())

    // unified messages.upsert handler (compatible with your existing handleMessages)
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

        // ignore status broadcasts
        if (msg.key?.remoteJid === 'status@broadcast') {
          await handleStatus(sock, upsert).catch(()=>{})
          return
        }

        // privacy/public behavior (leave as original)
        if (!sock.public && !msg.key?.fromMe && type === 'notify') {
          const isGroup = msg.key?.remoteJid?.endsWith?.('@g.us')
          if (!isGroup) return
        }

        // skip certain ephemeral ids
        if (msg.key?.id && typeof msg.key.id === 'string' && msg.key.id.startsWith('BAE5') && msg.key.id.length === 16) return

        // pass to main handler
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

    // contacts update to store
    sock.ev.on('contacts.update', updates => {
      for (const c of updates) {
        const id = sock.decodeJid ? sock.decodeJid(c.id) : c.id
        store.contacts[id] = { id, name: c.notify }
      }
    })

    // helpers
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
    sock.serializeM = m => m

    /* ---------- pairing code flow (requested only once) ---------- */
    if (pairingCodeFlag && !state.creds.registered && !pairingRequested) {
      pairingRequested = true
      if (useMobile) throw new Error('Cannot use pairing code with mobile api')

      let pn = phoneNumber || await question('Enter your WhatsApp number (international, e.g. 2547xxxxxxx): ')
      pn = pn.replace(/\D/g,'')
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
              console.log('Insert that code in WhatsApp -> Settings -> Linked devices -> Link a device')
            } else {
              console.log(chalk.yellow('Pairing code API not available in this Baileys version; scan the QR shown in terminal/connection.update.'))
            }
          } catch (err) {
            console.error('Error requesting pairing code:', err)
          }
        }, 1000)
      }
    }

    /* ---------- connection.update: backoff reconnect, DO NOT auto-delete creds ---------- */
    let reconnectAttempts = 0
    sock.ev.on('connection.update', async update => {
      const { connection, lastDisconnect, qr } = update

      if (qr) console.log(chalk.yellow('📌 QR generated (scan if you want)'))

      if (connection === 'open') {
        reconnectAttempts = 0
        console.log(chalk.green('✔ Bot connected successfully!'))
        console.log(chalk.gray(`Connected as: ${sock.user?.id || 'unknown'}`))
        // Do NOT send promotional/forwarded messages to your number here.
      }

      if (connection === 'close') {
        // get status code safely
        const statusCode = lastDisconnect?.error ? new Boom(lastDisconnect.error).output.statusCode : null
        console.log('Connection closed - reason:', statusCode, lastDisconnect?.error?.toString?.() ?? '')

        // If credentials are invalid/logged out (401), log clearly and stop auto-reconnect.
        // Do NOT auto-delete ./session so you can upload new creds if needed.
        if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
          console.error('⚠️ Credentials rejected / logged out (401). Session is invalid and must be re-authenticated.')
          console.error('Upload new creds.json via your pairing panel or re-pair manually.')
          // stop here — do not try to delete files or auto-repair
          return
        }

        // For transient errors (conflict/stream errors etc) attempt reconnect with backoff
        reconnectAttempts++
        const waitSec = Math.min(60, Math.pow(2, reconnectAttempts))
        console.log(`Transient error: auto-restarting in ${waitSec}s (attempt ${reconnectAttempts})`)
        await delay(waitSec * 1000).catch(()=>{})
        startSafe()
      }
    })

    // presence heartbeat to keep session alive
    setInterval(async () => {
      try { if (sock?.user?.id) await sock.sendPresenceUpdate('available').catch(()=>{}) } catch {}
    }, 20_000)

    // watchdog to restart if frozen
    setInterval(() => {
      if (Date.now() - lastActivity > 5 * 60 * 1000) {
        console.warn('Watchdog: no activity >5m; restarting bot.')
        startSafe()
      }
    }, 60_000)

    return sock

  } catch (err) {
    console.error('Error starting bot:', err)
    await delay(2000).catch(()=>{})
    startSafe()
  }
}

/* ---------- safe single-start wrapper ---------- */
let starting = false
async function startSafe(){
  if (starting) return
  starting = true
  try { await startBot() } catch (e) { console.error('safeStart error', e) }
  starting = false
}

/* ---------- run ---------- */
startSafe().catch(err => { console.error('Fatal start error:', err); process.exit(1) })

/* ---------- global crash handlers ---------- */
process.on('uncaughtException', (err) => { console.error('uncaughtException', err); startSafe() })
process.on('unhandledRejection', (err) => { console.error('unhandledRejection', err); startSafe() })

/* ---------- hot reload (dev) ---------- */
let file = require.resolve(__filename)
fs.watchFile(file, () => {
  fs.unwatchFile(file)
  console.log('♻️ Reloading index.js')
  delete require.cache[file]
  require(file)
})
