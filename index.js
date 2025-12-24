/**
 * BUGFIXED SULEXH XMD
 * KnightBot-style core + per-chat long-lasting presence
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

/* ================= MEMORY (KNIGHTBOT STYLE) ================= */
setInterval(() => {
    const used = process.memoryUsage().rss / 1024 / 1024
    if (used > 400) process.exit(1)
}, 30000)

/* ================= GLOBALS ================= */
global.botname = 'BUGFIXED SULEXH XMD'
global.themeemoji = '•'

/* ================= PAIRING ================= */
const pairingCode = !!settings.ownerNumber || process.argv.includes('--pairing-code')
const rl = process.stdin.isTTY ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null
const question = text => rl ? new Promise(resolve => rl.question(text, resolve)) : Promise.resolve(settings.ownerNumber)

/* ================= PRESENCE STATE ================= */
const activePresenceChats = new Map()
const PRESENCE_TTL = 5 * 60 * 1000 // 5 minutes

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
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }))
            },
            markOnlineOnConnect: true,
            syncFullHistory: false,
            defaultQueryTimeoutMs: 60000,
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 10000,
            msgRetryCounterCache
        })

        XeonBotInc.ev.on('creds.update', saveCreds)
        store.bind(XeonBotInc.ev)

        /* ================= MESSAGE HANDLER ================= */
        XeonBotInc.ev.on('messages.upsert', async ({ messages }) => {
            try {
                const m = messages[0]
                if (!m?.message) return

                const jid = m.key.remoteJid
                if (jid) activePresenceChats.set(jid, Date.now())
                if (jid === 'status@broadcast') return handleStatus(XeonBotInc, { messages })

                msgRetryCounterCache.clear()
                await handleMessages(XeonBotInc, { messages }, true)
            } catch {}
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

        XeonBotInc.getName = jid =>
            store.contacts[jid]?.name ||
            PhoneNumber('+' + jid.replace('@s.whatsapp.net', '')).getNumber('international')

        XeonBotInc.public = true

        /* ================= PER-CHAT PRESENCE ================= */
        let presenceStarted = false
        const startPresenceEngine = () => {
            if (presenceStarted) return
            presenceStarted = true
            setInterval(async () => {
                try {
                    const now = Date.now()
                    const ps = presenceSettings.getPresenceSettings()
                    for (const [jid, lastActive] of activePresenceChats.entries()) {
                        if (now - lastActive > PRESENCE_TTL) {
                            activePresenceChats.delete(jid)
                            continue
                        }
                        if (ps.autorecording) await XeonBotInc.sendPresenceUpdate('recording', jid)
                        else if (ps.autotyping) await XeonBotInc.sendPresenceUpdate('composing', jid)
                        else if (ps.alwaysonline) await XeonBotInc.sendPresenceUpdate('available', jid)
                    }
                } catch {}
            }, 15000)
        }

        /* ================= KNIGHTBOT-STYLE PAIRING ================= */
        if (pairingCode && !XeonBotInc.authState.creds.registered) {
            let phoneNumber = settings.ownerNumber || await question('Enter your WhatsApp number (no + or spaces): ')
            phoneNumber = phoneNumber.replace(/[^0-9]/g, '')

            try {
                let code = await XeonBotInc.requestPairingCode(phoneNumber)
                code = code?.match(/.{1,4}/g)?.join('-') || code
                console.log(chalk.black(chalk.bgGreen(`\nYour Pairing Code:`)), chalk.black(chalk.white(code)))
                console.log(chalk.yellow(`
Please enter this code in your WhatsApp app:
1. Open WhatsApp
2. Go to Settings > Linked Devices
3. Tap "Link a Device"
4. Enter the code shown above
`))
            } catch (err) {
                console.error('Failed to request pairing code:', err)
            }
        }

        /* ================= CONNECTION ================= */
        XeonBotInc.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
            if (qr) console.log(chalk.yellow('📱 QR Code generated'))

            if (connection === 'connecting') console.log(chalk.yellow('🔄 Connecting to WhatsApp...'))

            if (connection === 'open') {
                console.log(chalk.green('🤖 BUGFIXED CONNECTED SUCCESSFULLY'))
                startPresenceEngine()
            }

            if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut
                if (shouldReconnect) {
                    await delay(5000)
                    startXeonBotInc()
                }
            }
        })

        XeonBotInc.ev.on('group-participants.update', u => handleGroupParticipantUpdate(XeonBotInc, u))
        XeonBotInc.ev.on('status.update', s => handleStatus(XeonBotInc, s))
        XeonBotInc.ev.on('messages.reaction', s => handleStatus(XeonBotInc, s))

        return XeonBotInc

    } catch (err) {
        console.error('Error starting bot:', err)
        await delay(5000)
        startXeonBotInc()
    }
}

/* ================= START ================= */
startXeonBotInc()
process.on('uncaughtException', () => {})
process.on('unhandledRejection', () => {})
