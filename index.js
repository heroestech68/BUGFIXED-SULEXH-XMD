/**
 * Bugfixed Xd - A WhatsApp Bot
 * Copyright (c) 2024 Professor
 * License: MIT
 */

require('./settings')
const { Boom } = require('@hapi/boom')
const fs = require('fs')
const chalk = require('chalk')
const axios = require('axios')
const readline = require('readline')
const NodeCache = require('node-cache')
const pino = require('pino')
const PhoneNumber = require('awesome-phonenumber')

// Ensure tmp directory exists
const path = require('path')
const tmpDir = path.join(__dirname, 'tmp')
if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true })
    console.log(`[Init] Created missing tmp directory at ${tmpDir}`)
}

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

// Store
store.readFromFile()
setInterval(() => store.writeToFile(), settings.storeWriteInterval || 10000)

// RAM safety
setInterval(() => {
    const used = process.memoryUsage().rss / 1024 / 1024
    if (used > 400) process.exit(1)
}, 30000)

// Globals
global.botname = 'BUGFIXED SULEXH XMD'
global.themeemoji = '•'

// Pairing
const phoneNumber = settings.ownerNumber
const pairingCode = !!phoneNumber || process.argv.includes('--pairing-code')

// CLI
const rl = process.stdin.isTTY
    ? readline.createInterface({ input: process.stdin, output: process.stdout })
    : null

const question = q =>
    rl ? new Promise(r => rl.question(q, r)) : Promise.resolve(phoneNumber)

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
            msgRetryCounterCache
        })

        XeonBotInc.ev.on('creds.update', saveCreds)
        store.bind(XeonBotInc.ev)

        // ===============================
        // MESSAGE HANDLER
        // ===============================
        XeonBotInc.ev.on('messages.upsert', async ({ messages }) => {
            const m = messages[0]
            if (!m?.message) return
            if (m.key.remoteJid === 'status@broadcast') return handleStatus(XeonBotInc, m)
            try {
                await handleMessages(XeonBotInc, { messages }, true)
            } catch (e) {
                console.error(e)
            }
        })

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

        // ===============================
        // ✅ COMMAND-CONTROLLED PRESENCE ENGINE
        // ===============================

        function pickTargetChat() {
            const chats = Object.keys(store.chats || {})
            return chats.find(j => j.endsWith('@s.whatsapp.net') || j.endsWith('@g.us')) || null
        }

        setInterval(async () => {
            try {
                const ps = presenceSettings.getPresenceSettings()
                const target = pickTargetChat()
                if (!target) return

                if (ps.autorecording) {
                    await XeonBotInc.sendPresenceUpdate('recording', target)
                    return
                }

                if (ps.autotyping) {
                    await XeonBotInc.sendPresenceUpdate('composing', target)
                    return
                }

                if (ps.alwaysonline) {
                    await XeonBotInc.sendPresenceUpdate('available', target)
                    return
                }

                // all off → reset
                await XeonBotInc.sendPresenceUpdate('available', target)

            } catch {}
        }, 12000) // SAFE INTERVAL

        // ===============================
        // CONNECTION HANDLER
        // ===============================
        XeonBotInc.ev.on('connection.update', async update => {
            const { connection, lastDisconnect } = update

            if (connection === 'open') {
                console.log(chalk.green('🤖 Bot Connected Successfully'))
            }

            if (connection === 'close') {
                const shouldReconnect =
                    lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut
                if (shouldReconnect) {
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
        console.error(e)
        await delay(5000)
        startXeonBotInc()
    }
}

startXeonBotInc()

process.on('uncaughtException', console.error)
process.on('unhandledRejection', console.error)
