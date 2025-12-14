
/**
 * Bugfixed Xmd - WhatsApp Bot
 * FULLY CORRECTED & STABLE
 */

/* ================= SAFETY FIX (CRITICAL) ================= */

// Restore console.log if overwritten anywhere
if (typeof console.log !== 'function') {
    console.log = (...args) => {
        try {
            process.stdout.write(args.join(' ') + '\n')
        } catch {}
    }
}

// Protect console.log from future overwrite
try {
    Object.defineProperty(console, 'log', {
        writable: false,
        configurable: false
    })
} catch {}

/* ========================================================= */

require('./settings')
const fs = require('fs')
const chalk = require('chalk')
const axios = require('axios')
const pino = require('pino')
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
} = require("@whiskeysockets/baileys")

const { handleMessages, handleGroupParticipantUpdate, handleStatus } = require('./main')
const store = require('./lib/lightweight_store')
const settings = require('./settings')

/* ================= STORE ================= */

store.readFromFile()
setInterval(() => store.writeToFile(), settings.storeWriteInterval || 10000)

/* ================= MEMORY SAFETY ================= */

setInterval(() => {
    if (global.gc) {
        global.gc()
        console.log('🧹 Garbage collected')
    }
}, 60000)

setInterval(() => {
    const used = process.memoryUsage().rss / 1024 / 1024
    if (used > 400) {
        console.log('⚠️ RAM too high, restarting...')
        process.exit(1)
    }
}, 30000)

/* ================= OWNER ================= */

let phoneNumber = settings.ownerNumber || "254768161116"
let owner
try {
    owner = JSON.parse(fs.readFileSync('./data/owner.json', 'utf8'))
} catch {
    owner = phoneNumber
}

const ownerJid = owner.replace(/\D/g, '') + '@s.whatsapp.net'

/* ================= MEDIA ================= */

const CONNECT_IMAGE_URL = "https://files.catbox.moe/x6k68g.png"
const CONNECT_AUDIO_URL = "https://files.catbox.moe/pox4r9.m4a"

async function fetchBuffer(url) {
    try {
        const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 20000 })
        return Buffer.from(res.data)
    } catch {
        return null
    }
}

/* ================= START CONTROL ================= */

let starting = false
let connectionNotified = false

async function safeStart() {
    if (starting) return
    starting = true
    try {
        await startBot()
    } catch (e) {
        console.error('safeStart error:', e)
    }
    starting = false
}

/* ================= MAIN BOT ================= */

async function startBot() {
    if (!fs.existsSync('./session')) fs.mkdirSync('./session')

    const { state, saveCreds } = await useMultiFileAuthState('./session')
    const { version } = await fetchLatestBaileysVersion()

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: true,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }))
        },
        markOnlineOnConnect: true
    })

    store.bind(sock.ev)
    sock.ev.on('creds.update', saveCreds)

    /* ========== CONNECTION ========== */

    sock.ev.on('connection.update', async (u) => {
        try {
            const { connection, lastDisconnect } = u

            if (connection === 'open') {
                console.log(chalk.green('✔ BOT CONNECTED'))
                console.log(`Logged in as: ${sock.user?.id}`)

                if (!connectionNotified) {
                    connectionNotified = true
                    await delay(3000)

                    const img = await fetchBuffer(CONNECT_IMAGE_URL)
                    const audio = await fetchBuffer(CONNECT_AUDIO_URL)

                    const caption = [
                        "🚀 BUGFIXED-SULEXH-XMD 🚀",
                        "",
                        "Your WhatsApp Bot is now ONLINE ✅",
                        `Time: ${new Date().toLocaleString()}`,
                        "",
                        "Powered by SULEXH TECH"
                    ].join('\n')

                    try {
                        if (img) {
                            await sock.sendMessage(ownerJid, { image: img, caption })
                        } else {
                            await sock.sendMessage(ownerJid, { text: caption })
                        }

                        if (audio) {
                            await sock.sendMessage(ownerJid, {
                                audio,
                                mimetype: 'audio/m4a'
                            })
                        }

                        console.log('✔ Connection notification sent')
                    } catch (e) {
                        console.error('Notification error:', e.message)
                    }
                }
            }

            if (connection === 'close') {
                connectionNotified = false

                const code = lastDisconnect?.error?.output?.statusCode
                console.log(chalk.red('Connection closed:'), code)

                if (code !== DisconnectReason.loggedOut) {
                    await delay(3000)
                    safeStart()
                } else {
                    console.log('❌ Logged out. Re-pair manually.')
                }
            }
        } catch (err) {
            console.error('connection.update error:', err)
        }
    })

    /* ========== EVENTS ========== */

    sock.ev.on('messages.upsert', async (m) => {
        try {
            await handleMessages(sock, m, true)
        } catch (e) {
            console.error('Message handler error:', e)
        }
    })

    sock.ev.on('group-participants.update', async (u) => {
        await handleGroupParticipantUpdate(sock, u).catch(() => {})
    })

    sock.ev.on('status.update', async (s) => {
        await handleStatus(sock, s).catch(() => {})
    })
}

/* ================= START ================= */

safeStart()

/* ================= CRASH GUARD ================= */

process.on('uncaughtException', err => {
    console.error('uncaughtException:', err)
    safeStart()
})

process.on('unhandledRejection', err => {
    console.error('unhandledRejection:', err)
    safeStart()
})

/* ================= HOT RELOAD ================= */

const file = require.resolve(__filename)
fs.watchFile(file, () => {
    fs.unwatchFile(file)
    console.log('♻ Reloading index.js...')
    delete require.cache[file]
    require(file)
})
