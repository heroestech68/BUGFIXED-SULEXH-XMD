/**
 * BUGFIXED SULEXH XMD - Cloud Safe WhatsApp Bot
 * Rebuilt for Katabump / Panels
 * License: MIT
 */

require('./settings')
const fs = require('fs')
const chalk = require('chalk')
const readline = require('readline')
const NodeCache = require('node-cache')
const pino = require('pino')
const PhoneNumber = require('awesome-phonenumber')

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

const { handleMessages, handleGroupParticipantUpdate, handleStatus } = require('./main')
const store = require('./lib/lightweight_store')
const presenceSettings = require('./presence_settings')
const settings = require('./settings')

/* ================= STORE ================= */
store.readFromFile()
setInterval(() => store.writeToFile(), settings.storeWriteInterval || 10000)

/* ================= MEMORY SAFETY ================= */
setInterval(() => {
    if (global.gc) global.gc()
}, 60000)

setInterval(() => {
    const used = process.memoryUsage().rss / 1024 / 1024
    if (used > 450) {
        console.log('⚠️ High RAM usage, restarting bot...')
        process.exit(1)
    }
}, 30000)

/* ================= GLOBALS ================= */
global.botname = 'BUGFIXED SULEXH XMD'
global.themeemoji = '•'

/* ================= PAIRING ================= */
const pairingCode = !!settings.ownerNumber || process.argv.includes('--pairing-code')

/* ================= CLI SAFE ================= */
const rl = process.stdin.isTTY
    ? readline.createInterface({ input: process.stdin, output: process.stdout })
    : null

const question = q =>
    rl ? new Promise(r => rl.question(q, r)) : Promise.resolve(settings.ownerNumber)

/* ================= START BOT ================= */
async function startXeonBotInc() {
    try {
        const { version } = await fetchLatestBaileysVersion()
        const { state, saveCreds } = await useMultiFileAuthState('./session')
        const msgRetryCounterCache = new NodeCache()

        const XeonBotInc = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: !pairingCode,
            browser: ['Ubuntu', 'Chrome', '20.0.04'],
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(
                    state.keys,
                    pino({ level: 'fatal' })
                )
            },
            markOnlineOnConnect: true,

            // 🔥 CLOUD SAFE OPTIONS (IMPORTANT)
            defaultQueryTimeoutMs: 60000,
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 10000,
            syncFullHistory: false,

            msgRetryCounterCache
        })

        XeonBotInc.ev.on('creds.update', saveCreds)
        store.bind(XeonBotInc.ev)

        /* ================= MESSAGE HANDLER ================= */
        XeonBotInc.ev.on('messages.upsert', async ({ messages }) => {
            try {
                const m = messages[0]
                if (!m?.message) return

                if (m.key.remoteJid === 'status@broadcast') {
                    await handleStatus(XeonBotInc, { messages })
                    return
                }

                // Prevent memory freeze
                if (XeonBotInc.msgRetryCounterCache) {
                    XeonBotInc.msgRetryCounterCache.clear()
                }

                await handleMessages(XeonBotInc, { messages }, true)
            } catch (err) {
                console.error('Message error:', err)
            }
        })

        /* ================= HELPERS ================= */
        XeonBotInc.decodeJid = jid => {
            if (!jid) return jid
            if (/:\d+@/.test(jid)) {
                const d = jidDecode(jid) || {}
                return `${d.user}@${d.server}`
            }
            return jid
        }

        XeonBotInc.getName = jid => {
            jid = XeonBotInc.decodeJid(jid)
            return (
                store.contacts[jid]?.name ||
                PhoneNumber('+' + jid.replace('@s.whatsapp.net', '')).getNumber('international')
            )
        }

        XeonBotInc.public = true

        /* ================= PRESENCE ENGINE ================= */
        function pickTargetChat() {
            const chats = Object.keys(store.chats || {})
            return chats.find(j => j.endsWith('@s.whatsapp.net') || j.endsWith('@g.us')) || null
        }

        setInterval(async () => {
            try {
                const ps = presenceSettings.getPresenceSettings()
                const target = pickTargetChat()
                if (!target) return

                if (ps.autorecording)
                    return XeonBotInc.sendPresenceUpdate('recording', target)
                if (ps.autotyping)
                    return XeonBotInc.sendPresenceUpdate('composing', target)
                if (ps.alwaysonline)
                    return XeonBotInc.sendPresenceUpdate('available', target)

                await XeonBotInc.sendPresenceUpdate('available', target)
            } catch {}
        }, 12000)

        /* ================= CONNECTION ================= */
        XeonBotInc.ev.on('connection.update', async update => {
            const { connection, lastDisconnect } = update

            if (connection === 'open') {
                console.log(chalk.green('🤖 BUGFIXED BOT CONNECTED SUCCESSFULLY'))
            }

            if (connection === 'close') {
                const shouldReconnect =
                    lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut
                if (shouldReconnect) {
                    console.log('🔄 Reconnecting...')
                    await delay(5000)
                    startXeonBotInc()
                }
            }
        })

        XeonBotInc.ev.on('group-participants.update', u =>
            handleGroupParticipantUpdate(XeonBotInc, u)
        )

        XeonBotInc.ev.on('status.update', s => handleStatus(XeonBotInc, s))
        XeonBotInc.ev.on('messages.reaction', s => handleStatus(XeonBotInc, s))

        return XeonBotInc
    } catch (e) {
        console.error('Startup error:', e)
        await delay(5000)
        startXeonBotInc()
    }
}

/* ================= START ================= */
startXeonBotInc()

process.on('uncaughtException', console.error)
process.on('unhandledRejection', console.error)
