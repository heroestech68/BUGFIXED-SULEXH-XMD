/**
 * Bugfixed Sulexh - A WhatsApp Bot
 */
require('./settings')
const fs = require('fs')
const chalk = require('chalk')
const path = require('path')
const axios = require('axios')
const { handleMessages, handleGroupParticipantUpdate, handleStatus } = require('./main')
const PhoneNumber = require('awesome-phonenumber')
const { smsg } = require('./lib/myfunc')
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    jidDecode,
    jidNormalizedUser,
    makeCacheableSignalKeyStore,
    delay
} = require("@whiskeysockets/baileys")
const pino = require("pino")
const readline = require("readline")
const { rmSync } = require('fs')

// Store
const store = require('./lib/lightweight_store')
store.readFromFile()
setInterval(() => store.writeToFile(), 10000)

// Memory safety
setInterval(() => global.gc && global.gc(), 60000)
setInterval(() => {
    if (process.memoryUsage().rss / 1024 / 1024 > 400) process.exit(1)
}, 30000)

let phoneNumber = "254768161116"
global.botname = "BUGFIXED SULEXH XMD"
global.themeemoji = "•"

const pairingCode = !!phoneNumber
const rl = process.stdin.isTTY
    ? readline.createInterface({ input: process.stdin, output: process.stdout })
    : null

async function startXeonBotInc() {
    try {
        // ✅ STATIC VERSION (NO FREEZE)
        const version = [2, 3000, 1015901307]

        const { state, saveCreds } = await useMultiFileAuthState('./session')

        // ✅ CORRECT TYPE
        const msgRetryCounterCache = new Map()

        const XeonBotInc = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: !pairingCode,
            browser: ["Ubuntu", "Chrome", "20.0.04"],
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }))
            },
            markOnlineOnConnect: true,
            msgRetryCounterCache,
            getMessage: async (key) => {
                const jid = jidNormalizedUser(key.remoteJid)
                return (await store.loadMessage(jid, key.id))?.message || ""
            }
        })

        XeonBotInc.ev.on('creds.update', saveCreds)
        store.bind(XeonBotInc.ev)

        XeonBotInc.ev.on('messages.upsert', async (chatUpdate) => {
            try {
                const mek = chatUpdate.messages[0]
                if (!mek?.message) return

                mek.message = mek.message?.ephemeralMessage?.message || mek.message

                if (mek.key.remoteJid === 'status@broadcast') {
                    await handleStatus(XeonBotInc, chatUpdate)
                    return
                }

                if (mek.key.id?.startsWith('BAE5')) return

                await handleMessages(XeonBotInc, chatUpdate, true)
            } catch (e) {
                console.error('messages.upsert error:', e)
            }
        })

        XeonBotInc.ev.on('connection.update', (s) => {
            if (s.connection === 'open') {
                console.log('✅ Connected:', XeonBotInc.user.id)
            }
            if (s.connection === 'close') {
                const code = s.lastDisconnect?.error?.output?.statusCode
                if (code !== DisconnectReason.loggedOut) startXeonBotInc()
                else rmSync('./session', { recursive: true, force: true })
            }
        })

    } catch (err) {
        console.error(err)
        await delay(3000)
        startXeonBotInc()
    }
}

startXeonBotInc()

process.on('uncaughtException', console.error)
process.on('unhandledRejection', console.error)
