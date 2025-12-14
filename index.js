/**
 * Bugfixed xmd  - A WhatsApp Bot
 * Clean version (NO forwarded message, NO branding)
 */

require('./settings')
const { Boom } = require('@hapi/boom')
const fs = require('fs')
const chalk = require('chalk')
const axios = require('axios')
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

const NodeCache = require('node-cache')
const pino = require('pino')
const readline = require('readline')

/* ================= STORE ================= */
const store = require('./lib/lightweight_store')
store.readFromFile()
setInterval(() => store.writeToFile(), 10_000)

/* ================= GLOBALS ================= */
global.botname = "BUGFIXED SULEXH XMD"
global.themeemoji = "•"

let phoneNumber = "254768161116"
const pairingCode = true
const useMobile = false

/* ================= UTILS ================= */
const rl = process.stdin.isTTY
    ? readline.createInterface({ input: process.stdin, output: process.stdout })
    : null

const question = (text) => rl
    ? new Promise(resolve => rl.question(text, resolve))
    : Promise.resolve(phoneNumber)

/* ================= START BOT ================= */
async function startXeonBotInc() {
    try {
        const { version } = await fetchLatestBaileysVersion()
        const { state, saveCreds } = await useMultiFileAuthState('./session')
        const msgRetryCounterCache = new NodeCache()

        const sock = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: true,
            browser: ['Ubuntu', 'Chrome', '20.0.04'],
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(
                    state.keys,
                    pino({ level: 'silent' })
                )
            },
            msgRetryCounterCache,
            markOnlineOnConnect: true
        })

        store.bind(sock.ev)
        sock.ev.on('creds.update', saveCreds)

        /* ================= MESSAGE HANDLER ================= */
        sock.ev.on('messages.upsert', async ({ messages }) => {
            const msg = messages[0]
            if (!msg?.message) return

            if (msg.key.remoteJid === 'status@broadcast') {
                await handleStatus(sock, { messages })
                return
            }

            await handleMessages(sock, { messages }, true)
        })

        /* ================= CONNECTION ================= */
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update

            if (qr) {
                console.log(chalk.yellow('📱 Scan QR Code'))
            }

            if (connection === 'open') {
                console.log(chalk.green('✔ BOT CONNECTED SUCCESSFULLY'))

                const selfJid =
                    sock.user.id.split(':')[0] + '@s.whatsapp.net'

                // ✅ SIMPLE notification (NO forwarded / NO branding)
                await sock.sendMessage(selfJid, {
                    text:
                        `🤖 Bot Connected Successfully\n` +
                        `⏰ ${new Date().toLocaleString()}`
                })
            }

            if (connection === 'close') {
                const code =
                    lastDisconnect?.error?.output?.statusCode

                console.log('Connection closed:', code)

                if (code === DisconnectReason.loggedOut || code === 401) {
                    console.log('Session logged out. Re-auth required.')
                    return
                }

                await delay(3000)
                startXeonBotInc()
            }
        })

        /* ================= GROUP EVENTS ================= */
        sock.ev.on('group-participants.update', async (update) => {
            await handleGroupParticipantUpdate(sock, update)
        })

        return sock

    } catch (err) {
        console.error('START ERROR:', err)
        await delay(5000)
        startXeonBotInc()
    }
}

/* ================= RUN ================= */
startXeonBotInc()

process.on('uncaughtException', err => {
    console.error('Uncaught:', err)
})

process.on('unhandledRejection', err => {
    console.error('Unhandled:', err)
})

/* ================= HOT RELOAD ================= */
let file = require.resolve(__filename)
fs.watchFile(file, () => {
    fs.unwatchFile(file)
    console.log('♻ Reloading index.js')
    delete require.cache[file]
    require(file)
})
