/**
 * Final fixed index.js - Bugfixed-xmd-bot
 * Includes: auto-reconnect, no session deletion, heartbeat, watchdog, safe handlers
 */

const settings = require('./settings')
const { Boom } = require('@hapi/boom')
const fs = require('fs')
const chalk = require('chalk')
const path = require('path')
const axios = require('axios')
const { handleMessages, handleGroupParticipantUpdate, handleStatus } = require('./main')
const PhoneNumber = require('awesome-phonenumber')
const { imageToWebp, videoToWebp, writeExifImg, writeExifVid } = require('./lib/exif')
const { smsg, isUrl, generateMessageTag, getBuffer, getSizeMedia, fetch, sleep, reSize } = require('./lib/myfunc')

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    jidDecode,
    proto,
    jidNormalizedUser,
    makeCacheableSignalKeyStore,
    delay
} = require("@whiskeysockets/baileys")

const NodeCache = require("node-cache")
const pino = require("pino")
const readline = require("readline")
const { rmSync } = require('fs')
const store = require('./lib/lightweight_store')

/* -------------------------- Persistent store -------------------------- */
store.readFromFile()
setInterval(() => store.writeToFile(), settings.storeWriteInterval || 10000)

/* ---------------------------- Garbage & RAM --------------------------- */
setInterval(() => {
    if (global.gc) {
        global.gc()
    }
}, 60_000)

setInterval(() => {
    const used = process.memoryUsage().rss / 1024 / 1024
    if (used > 400) {
        console.log('⚠️ RAM too high (>400MB), restarting bot...')
        process.exit(1)
    }
}, 30_000)

/* ----------------------- Basic globals & config ----------------------- */
let phoneNumber = "911234567890"
let owner = JSON.parse(fs.readFileSync('./data/owner.json', 'utf8') || '[]')

global.botname = "KNIGHT BOT"
global.themeemoji = "•"
const pairingCode = !!phoneNumber || process.argv.includes("--pairing-code")
const useMobile = process.argv.includes("--mobile")

/* --------------------------- Ask for number --------------------------- */
const rl = process.stdin.isTTY ? readline.createInterface({
    input: process.stdin,
    output: process.stdout
}) : null

const question = (text) => {
    if (rl) return new Promise((resolve) => rl.question(text, resolve))
    else return Promise.resolve(settings.ownerNumber || phoneNumber)
}

/* ------------------------- Watchdog / Health -------------------------- */
let lastActivity = Date.now()
function touchActivity() { lastActivity = Date.now() }

/* restart helper to avoid overlapping starts */
let starting = false
async function safeStart() {
    if (starting) return
    starting = true
    try {
        await startXeonBotInc()
    } catch (e) {
        console.error("safeStart error:", e)
    } finally {
        starting = false
    }
}

/* ------------------------------ Main --------------------------------- */
async function startXeonBotInc() {
    try {
        let { version } = await fetchLatestBaileysVersion()
        const { state, saveCreds } = await useMultiFileAuthState(`./session`)
        const msgRetryCounterCache = new NodeCache()

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
            generateHighQualityLinkPreview: true,
            syncFullHistory: false,
            getMessage: async (key) => {
                try {
                    let jid = jidNormalizedUser(key.remoteJid)
                    let msg = await store.loadMessage(jid, key.id)
                    return msg?.message || ""
                } catch (e) {
                    return ""
                }
            },
            msgRetryCounterCache,
            defaultQueryTimeoutMs: 60000,
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 10000
        })

        // expose local cache on socket for compatibility
        XeonBotInc.msgRetryCounterCache = msgRetryCounterCache

        XeonBotInc.ev.on('creds.update', saveCreds)
        store.bind(XeonBotInc.ev)

        // update activity on any incoming events
        XeonBotInc.ev.on('connection.update', () => touchActivity())
        XeonBotInc.ev.on('messages.upsert', () => touchActivity())

        /* ----------------------- messages.upsert ----------------------- */
        XeonBotInc.ev.on('messages.upsert', async (upsert) => {
            let msg = null
            try {
                const messages = upsert?.messages || upsert
                const type = upsert?.type || (Array.isArray(messages) ? 'notify' : undefined)
                msg = Array.isArray(messages) ? messages[0] : messages

                if (!msg || !msg.message) return

                // unwrap ephemeral
                if (msg.message && Object.keys(msg.message)[0] === 'ephemeralMessage') {
                    msg.message = msg.message.ephemeralMessage?.message ?? msg.message
                }

                // ignore status broadcast
                if (msg.key?.remoteJid === 'status@broadcast') {
                    await handleStatus(XeonBotInc, upsert).catch(() => {})
                    return
                }

                // privacy/public checks (keep previous behavior)
                if (!XeonBotInc.public && !msg.key?.fromMe && type === 'notify') {
                    const isGroup = msg.key?.remoteJid?.endsWith?.('@g.us')
                    if (!isGroup) return
                }

                if (msg.key?.id && typeof msg.key.id === 'string' && msg.key.id.startsWith('BAE5') && msg.key.id.length === 16) return

                // Build chatUpdate like previous code expects
                const chatUpdate = { messages: [msg], type }
                await handleMessages(XeonBotInc, chatUpdate, true)
            } catch (err) {
                console.error("Error in messages.upsert:", err)
                try {
                    if (msg?.key?.remoteJid) {
                        await XeonBotInc.sendMessage(msg.key.remoteJid, { text: '❌ An error occurred while processing your message.' }).catch(() => {})
                    }
                } catch {}
            }
        })

        /* ----------------------- connection.update ---------------------- */
        XeonBotInc.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect, qr } = update

            if (qr) console.log(chalk.yellow("Scan QR Code to login"))

            if (connection === 'open') {
                console.log(chalk.green("Bot connected successfully!"))
                const botNumber = XeonBotInc.user?.id?.split?.(":")?.[0] + "@s.whatsapp.net"
                try {
                    if (botNumber) await XeonBotInc.sendMessage(botNumber, { text: `🤖 Bot Connected Successfully!` }).catch(() => {})
                } catch {}
            }

            if (connection === "close") {
                const reason = lastDisconnect?.error ? new Boom(lastDisconnect.error).output.statusCode : null
                console.log("Connection closed - reason:", reason)

                // ALWAYS attempt restart without deleting session
                console.log("Auto-restarting bot in 2s (session preserved)...")
                await delay(2000).catch(() => {})
                safeStart()
            }
        })

        /* ------------------------ contacts.update ------------------------ */
        XeonBotInc.ev.on('contacts.update', updates => {
            for (const contact of updates) {
                let id = XeonBotInc.decodeJid ? XeonBotInc.decodeJid(contact.id) : contact.id
                store.contacts[id] = { id, name: contact.notify }
            }
        })

        /* -------------------------- decodeJid --------------------------- */
        XeonBotInc.decodeJid = (jid) => {
            if (!jid) return jid
            if (/:\d+@/gi.test(jid)) {
                let decode = jidDecode(jid) || {}
                return (decode.user ? decode.user + '@' + decode.server : jid)
            } else return jid
        }

        /* --------------------------- getName ---------------------------- */
        XeonBotInc.getName = (jid, withoutContact = false) => {
            jid = XeonBotInc.decodeJid(jid)
            withoutContact = XeonBotInc.withoutContact || withoutContact

            if (jid.endsWith("@g.us")) {
                return new Promise(async (resolve) => {
                    const contact = store.contacts[jid] || await XeonBotInc.groupMetadata(jid).catch(() => ({})) || {}
                    resolve(contact.name || contact.subject || jid)
                })
            } else {
                const contact =
                    jid === '0@s.whatsapp.net' ? { id: jid, name: 'WhatsApp' }
                        : jid === XeonBotInc.decodeJid(XeonBotInc.user?.id || '') ? XeonBotInc.user
                            : store.contacts[jid] || {}

                return (!withoutContact && contact.name) || contact.subject || jid
            }
        }

        XeonBotInc.public = true
        XeonBotInc.serializeM = (m) => smsg(XeonBotInc, m, store)

        /* --------------------------- Pairing --------------------------- */
        if (pairingCode && !state.creds.registered) {
            if (useMobile) throw new Error('Cannot use pairing code with mobile api')

            let phone
            if (global.phoneNumber) phone = global.phoneNumber
            else phone = await question(chalk.greenBright("Enter your WhatsApp number (e.g. 254712345678): "))

            phone = phone.replace(/\D/g, '')

            const pn = require('awesome-phonenumber')
            if (!pn("+" + phone).isValid()) {
                console.log(chalk.red("Invalid phone number format"))
                process.exit(1)
            }

            setTimeout(async () => {
                try {
                    let code = await XeonBotInc.requestPairingCode(phone)
                    code = code?.match(/.{1,4}/g)?.join("-")
                    console.log(chalk.bgGreen("PAIRING CODE:"), code)
                } catch (err) {
                    console.error(err)
                }
            }, 3000)
        }

        /* ---------------------------- ANTI-CALL ------------------------- */
        const antiCallNotified = new Set()
        XeonBotInc.ev.on("call", async (calls) => {
            try {
                const { readState: readAnticallState } = require('./commands/anticall')
                const state = readAnticallState()
                if (!state?.enabled) return

                for (const call of calls) {
                    const callerJid = call.from || call.peerJid || call.chatId
                    if (!callerJid) continue

                    try {
                        if (!antiCallNotified.has(callerJid)) {
                            antiCallNotified.add(callerJid)
                            setTimeout(() => antiCallNotified.delete(callerJid), 60000)
                            await XeonBotInc.sendMessage(callerJid, { text: '📵 Calls are not allowed. You will be blocked.' }).catch(() => {})
                        }
                    } catch {}
                    setTimeout(async () => { try { await XeonBotInc.updateBlockStatus(callerJid, 'block') } catch {} }, 800)
                }
            } catch {}
        })

        /* ------------------------ GROUP PARTICIPANTS --------------------- */
        XeonBotInc.ev.on('group-participants.update', async (update) => {
            await handleGroupParticipantUpdate(XeonBotInc, update).catch(() => {})
        })

        /* ---------------------- STATUS & REACTIONS ---------------------- */
        XeonBotInc.ev.on("status.update", async (s) => handleStatus(XeonBotInc, s).catch(() => {}))
        XeonBotInc.ev.on("messages.reaction", async (s) => handleStatus(XeonBotInc, s).catch(() => {}))

        /* ----------------------- Presence Heartbeat --------------------- */
        setInterval(async () => {
            try {
                if (XeonBotInc?.user?.id) {
                    await XeonBotInc.sendPresenceUpdate("available").catch(() => {})
                }
            } catch {}
        }, 20_000)

        /* --------------------------- Watchdog --------------------------- */
        setInterval(() => {
            const now = Date.now()
            // if no activity for 5 minutes, attempt restart
            if (now - lastActivity > (5 * 60 * 1000)) {
                console.warn("Watchdog: no activity detected >5m, restarting...")
                safeStart()
            }
        }, 60_000)

        /* ----------------------- Return socket -------------------------- */
        return XeonBotInc

    } catch (e) {
        console.error("Error starting bot:", e)
        await delay(2000).catch(() => {})
        safeStart()
    }
}

/* --------------------------- Start bot ----------------------------- */
safeStart().catch(err => {
    console.error("Fatal start error:", err)
    process.exit(1)
})

/* ------------------------- Global errors --------------------------- */
process.on("uncaughtException", (err) => {
    console.error("uncaughtException:", err)
    // attempt to restart
    safeStart()
})

process.on("unhandledRejection", (err) => {
    console.error("unhandledRejection:", err)
    safeStart()
})

/* ---------------------------- Hot reload --------------------------- */
let file = require.resolve(__filename)
fs.watchFile(file, () => {
    fs.unwatchFile(file)
    console.log("♻️ Reloading...")
    delete require.cache[file]
    require(file)
})
