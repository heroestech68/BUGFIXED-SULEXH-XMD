/**
 * Bugfixed Xmd - A WhatsApp Bot (fixed + connection notification)
 * Keeps your original structure; added robustness fixes:
 *  - Removed mandatory @hapi/boom import (safer status extraction)
 *  - Safer status-code extraction (handles various error shapes)
 *  - Protected connection handler from throwing, robust logging
 *
 * Image: https://files.catbox.moe/x6k68g.png
 * Audio: https://files.catbox.moe/pox4r9.m4a
 *
 * NOTE: replace URLs with local paths if you prefer bundled assets.
 */

require('./settings')
const fs = require('fs')
const chalk = require('chalk')
const FileType = require('file-type')
const path = require('path')
const axios = require('axios')
const { handleMessages, handleGroupParticipantUpdate, handleStatus } = require('./main');
const PhoneNumber = require('awesome-phonenumber')
const { imageToWebp, videoToWebp, writeExifImg, writeExifVid } = require('./lib/exif')
const { smsg, isUrl, generateMessageTag, getBuffer, getSizeMedia, fetch, await: _await, sleep, reSize } = require('./lib/myfunc')
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    generateForwardMessageContent,
    prepareWAMessageMedia,
    generateWAMessageFromContent,
    generateMessageID,
    downloadContentFromMessage,
    jidDecode,
    proto,
    jidNormalizedUser,
    makeCacheableSignalKeyStore,
    delay
} = require("@whiskeysockets/baileys")
const NodeCache = require("node-cache")
const pino = require("pino")
const readline = require("readline")
const { parsePhoneNumber } = require("libphonenumber-js")
const { PHONENUMBER_MCC } = require('@whiskeysockets/baileys/lib/Utils/generics')
const { rmSync, existsSync } = require('fs')
const { join } = require('path')

// Import lightweight store
const store = require('./lib/lightweight_store')

// Initialize store
store.readFromFile()
const settings = require('./settings')
setInterval(() => store.writeToFile(), settings.storeWriteInterval || 10000)

// Memory optimization - Force garbage collection if available
setInterval(() => {
    if (global.gc) {
        global.gc()
        console.log('🧹 Garbage collection completed')
    }
}, 60_000) // every 1 minute

// Memory monitoring - Restart if RAM gets too high
setInterval(() => {
    const used = process.memoryUsage().rss / 1024 / 1024
    if (used > 400) {
        console.log('⚠️ RAM too high (>400MB), restarting bot...')
        process.exit(1) // Panel will auto-restart
    }
}, 30_000) // check every 30 seconds

// prefer settings.ownerNumber if present; fallback to hardcoded
let phoneNumber = settings.ownerNumber || process.env.OWNER_NUMBER || "254768161116"
let owner = null
try { owner = JSON.parse(fs.readFileSync('./data/owner.json', 'utf8')) } catch { owner = settings.ownerNumber || phoneNumber }

global.botname = settings.botName || "BUGFIXED-SULEXH-XMD"
global.themeemoji = settings.themeemoji || "•"
const pairingCode = !!phoneNumber || process.argv.includes("--pairing-code")
const useMobile = process.argv.includes("--mobile")

// Only create readline interface if we're in an interactive environment
const rl = process.stdin.isTTY ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null
const question = (text) => {
    if (rl) {
        return new Promise((resolve) => rl.question(text, resolve))
    } else {
        // In non-interactive environment, use ownerNumber from settings
        return Promise.resolve(settings.ownerNumber || phoneNumber)
    }
}

// Safe restart helper to avoid parallel starts
let starting = false
async function safeStart() {
    if (starting) return
    starting = true
    try { await startXeonBotInc() } catch (e) { console.error('safeStart error', e) }
    starting = false
}

// activity watchdog
let lastActivity = Date.now()
function touch() { lastActivity = Date.now() }

// ----- Notification media URLs (use your provided links) -----
const CONNECT_IMAGE_URL = "https://files.catbox.moe/x6k68g.png"
const CONNECT_AUDIO_URL = "https://files.catbox.moe/pox4r9.m4a"

// helper: fetch binary via axios (returns Buffer)
async function fetchBuffer(url) {
    try {
        const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 20000 })
        return Buffer.from(res.data)
    } catch (e) {
        console.error("fetchBuffer error for", url, e?.message || e)
        return null
    }
}

async function startXeonBotInc() {
    try {
        if (!fs.existsSync('./session')) fs.mkdirSync('./session', { recursive: true })

        let { version, isLatest } = await fetchLatestBaileysVersion()
        const { state, saveCreds } = await useMultiFileAuthState(`./session`)
        const msgRetryCounterCache = new NodeCache()

        const XeonBotInc = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            // Print QR in terminal if we're NOT using paircode flag (so scan optional).
            printQRInTerminal: !pairingCode,
            browser: ["Ubuntu", "Chrome", "20.0.04"],
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
            },
            markOnlineOnConnect: true,
            generateHighQualityLinkPreview: true,
            syncFullHistory: false,
            getMessage: async (key) => {
                try {
                    let jid = jidNormalizedUser(key.remoteJid || '')
                    let msg = await store.loadMessage(jid, key.id)
                    return msg?.message || ""
                } catch { return "" }
            },
            msgRetryCounterCache,
            defaultQueryTimeoutMs: 60000,
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 10000,
        })

        // Save credentials when they update
        XeonBotInc.ev.on('creds.update', saveCreds)
        store.bind(XeonBotInc.ev)

        // update watchdog/activity hooks
        XeonBotInc.ev.on('messages.upsert', () => touch())
        XeonBotInc.ev.on('connection.update', () => touch())

        // Message handling (preserve your original handler)
        XeonBotInc.ev.on('messages.upsert', async (chatUpdate) => {
            try {
                const mek = chatUpdate.messages?.[0]
                if (!mek?.message) return
                // unwrap ephemeral wrapper
                if (mek.message && Object.keys(mek.message)[0] === 'ephemeralMessage') {
                    mek.message = mek.message.ephemeralMessage?.message ?? mek.message
                }
                if (mek.key?.remoteJid === 'status@broadcast') {
                    await handleStatus(XeonBotInc, chatUpdate);
                    return;
                }
                // privacy/public checks (keep backward compatibility)
                if (!XeonBotInc.public && !mek.key?.fromMe && chatUpdate.type === 'notify') {
                    const isGroup = mek.key?.remoteJid?.endsWith('@g.us')
                    if (!isGroup) return
                }
                if (mek.key?.id && typeof mek.key.id === 'string' && mek.key.id.startsWith('BAE5') && mek.key.id.length === 16) return

                // clear retry cache if set
                if (XeonBotInc?.msgRetryCounterCache) XeonBotInc.msgRetryCounterCache.clear()

                // call your main handler
                await handleMessages(XeonBotInc, chatUpdate, true)
            } catch (err) {
                console.error("Error in messages.upsert:", err)
                try {
                    const jid = chatUpdate?.messages?.[0]?.key?.remoteJid
                    if (jid) await XeonBotInc.sendMessage(jid, { text: '❌ An error occurred while processing your message.' }).catch(()=>{})
                } catch {}
            }
        })

        // group participants
        XeonBotInc.ev.on('group-participants.update', async (update) => {
            await handleGroupParticipantUpdate(XeonBotInc, update).catch(() => {})
        })

        // status & reactions
        XeonBotInc.ev.on('status.update', async (s) => handleStatus(XeonBotInc, s).catch(() => {}))
        XeonBotInc.ev.on('messages.reaction', async (s) => handleStatus(XeonBotInc, s).catch(() => {}))

        // contacts update
        XeonBotInc.ev.on('contacts.update', updates => {
            for (const contact of updates) {
                let id = XeonBotInc.decodeJid ? XeonBotInc.decodeJid(contact.id) : contact.id
                if (store && store.contacts) store.contacts[id] = { id, name: contact.notify }
            }
        })

        // helpers
        XeonBotInc.decodeJid = (jid) => {
            if (!jid) return jid
            if (/:\d+@/gi.test(jid)) {
                let decode = jidDecode(jid) || {}
                return decode.user && decode.server && decode.user + '@' + decode.server || jid
            } else return jid
        }

        XeonBotInc.getName = (jid, withoutContact = false) => {
            jid = XeonBotInc.decodeJid(jid)
            withoutContact = XeonBotInc.withoutContact || withoutContact
            if (jid.endsWith("@g.us")) return new Promise(async (resolve) => {
                let v = store.contacts[jid] || {}
                if (!(v.name || v.subject)) v = await XeonBotInc.groupMetadata(jid).catch(() => ({}))
                resolve(v.name || v.subject || jid)
            })
            const v = jid === '0@s.whatsapp.net' ? { id: jid, name: 'WhatsApp' } : (store.contacts[jid] || {})
            return (withoutContact ? '' : v.name) || v.subject || jid
        }

        XeonBotInc.public = true
        XeonBotInc.serializeM = (m) => smsg(XeonBotInc, m, store)

        /* ---------------- Pairing code flow ----------------
           Use state.creds.registered (correct) and requestPairingCode when available.
           This prints a pairing code (if supported) or falls back to QR printing.
        */
        if (pairingCode && !state.creds?.registered) {
            if (useMobile) throw new Error('Cannot use pairing code with mobile api')

            // get phone number from settings or prompt (non-interactive fallback)
            let pn = phoneNumber || await question(chalk.greenBright("Enter your WhatsApp number (e.g. 254712345678): "))
            pn = String(pn).replace(/\D/g, '')
            const apn = require('awesome-phonenumber')
            if (!apn("+" + pn).isValid()) {
                console.log(chalk.red("Invalid phone number format for pairing code. Pairing will likely fail."))
            } else {
                setTimeout(async () => {
                    try {
                        if (typeof XeonBotInc.requestPairingCode === 'function') {
                            let code = await XeonBotInc.requestPairingCode(pn)
                            if (code) {
                                // nice format
                                code = String(code).match(/.{1,4}/g)?.join("-") ?? code
                                console.log(chalk.bgGreen.black("PAIRING CODE:"), chalk.white(code))
                                console.log(chalk.yellow("\nUse Settings > Linked Devices > Link a Device on WhatsApp and enter the code above."))
                            } else {
                                console.log(chalk.yellow("Pairing code requested but got empty response. QR will be printed if supported."))
                            }
                        } else {
                            console.log(chalk.yellow("Pairing code flow not supported by this Baileys version — QR shown instead."))
                        }
                    } catch (err) {
                        console.error("Error requesting pairing code:", err)
                    }
                }, 1200)
            }
        }

        /* ---------------- connection.update handler ---------------- */
        let attempts = 0
        XeonBotInc.ev.on("connection.update", async (u) => {
            try {
                const { connection, lastDisconnect, qr } = u

                if (qr) console.log(chalk.yellow("📌 QR generated — scan with WhatsApp (or use pair-code flow if enabled)."))

                if (connection === "open") {
                    attempts = 0
                    console.log(chalk.green("✔ BOT CONNECTED SUCCESSFULLY ✔"))
                    console.log(chalk.gray(`Connected as: ${XeonBotInc.user?.id ?? 'unknown'}`))

                    // Send a branded, attractive connection notification (image + caption + audio)
                    (async () => {
                        try {
                            // Compose target bot chat (your WhatsApp account)
                            const botNumber = (XeonBotInc.user?.id || '').split(':')[0] + '@s.whatsapp.net'
                            if (!botNumber) return

                            // Fetch media buffers (image then audio)
                            const imgBuf = await fetchBuffer(CONNECT_IMAGE_URL)
                            const audioBuf = await fetchBuffer(CONNECT_AUDIO_URL)

                            // caption text — attractive and branded
                            const caption = [
                                "🚀 BUGFIXED-SULEXH-XMD 🚀",
                                "",
                                "Your Advanced WhatsApp Bot is now online.",
                                `Time: ${new Date().toLocaleString()}`,
                                "",
                                "Powered by BUGFIXED-SULEXH-TECH",
                                "Visit: https://t.me/BUGFIXED-SULEXH-XMD"
                            ].join("\n")

                            // send image (if available) with caption
                            if (imgBuf) {
                                try {
                                    await XeonBotInc.sendMessage(botNumber, {
                                        image: imgBuf,
                                        caption,
                                    })
                                } catch (e) {
                                    console.error("Failed to send connect image:", e?.message || e)
                                }
                            } else {
                                // fallback: send plain text caption
                                try { await XeonBotInc.sendMessage(botNumber, { text: caption }) } catch {}
                            }

                            // send audio (if available)
                            if (audioBuf) {
                                try {
                                    // attempt to determine mime type (m4a)
                                    await XeonBotInc.sendMessage(botNumber, {
                                        audio: audioBuf,
                                        mimetype: 'audio/m4a',
                                        ptt: false
                                    })
                                } catch (e) {
                                    console.error("Failed to send connect audio:", e?.message || e)
                                }
                            }
                        } catch (err) {
                            console.error("Error sending connect notification:", err)
                        }
                    })()
                }

                if (connection === "close") {
                    // safe extraction of status / error code (works across different versions/shapes)
                    let code = null
                    try {
                        if (lastDisconnect?.error) {
                            // If error is a Boom-like object with output.statusCode
                            if (lastDisconnect.error.output && typeof lastDisconnect.error.output.statusCode !== 'undefined') {
                                code = lastDisconnect.error.output.statusCode
                            } else if (typeof lastDisconnect.error.statusCode !== 'undefined') {
                                code = lastDisconnect.error.statusCode
                            } else if (typeof lastDisconnect.error.status !== 'undefined') {
                                code = lastDisconnect.error.status
                            } else if (typeof lastDisconnect?.statusCode !== 'undefined') {
                                code = lastDisconnect.statusCode
                            } else {
                                // fallback: string codes exist sometimes (try parse)
                                const maybe = lastDisconnect.error?.toString?.() || ''
                                const m = maybe.match(/status code:? (\d{3})/i)
                                if (m) code = Number(m[1])
                            }
                        }
                    } catch (e) {
                        // never throw here
                        console.error("Error while extracting disconnect code:", e?.message || e)
                    }

                    console.log(chalk.red("Connection closed, code:"), code)

                    // If logged out (credentials invalid) -> notify and stop automatic deletion/restart
                    if (code === DisconnectReason.loggedOut || code === 401) {
                        console.error("⚠️ Credentials rejected / logged out. Session is invalid. Re-authenticate manually (do NOT rely on automatic deletion).")
                        // Do NOT auto-delete session folder here. Stop reconnection to allow manual fix.
                        return
                    }

                    // Otherwise attempt reconnect with exponential backoff
                    attempts++
                    const wait = Math.min(60, 2 ** attempts) * 1000
                    console.log(`Reconnecting in ${wait/1000}s (attempt ${attempts})...`)
                    await delay(wait).catch(() => {})
                    safeStart()
                }
            } catch (handlerErr) {
                // Fatal guard so connection.update never throws and kills process
                console.error("connection.update handler error:", handlerErr)
            }
        })

        // presence heartbeat
        setInterval(() => {
            try { if (XeonBotInc.user) XeonBotInc.sendPresenceUpdate("available").catch(()=>{}) } catch {}
        }, 20_000)

        // watchdog: restart if frozen for >5min
        setInterval(() => {
            if (Date.now() - lastActivity > (5 * 60 * 1000)) {
                console.warn("Watchdog: inactivity >5m, restarting...")
                safeStart()
            }
        }, 60_000)

        return XeonBotInc
    } catch (err) {
        console.error("Fatal startBot error:", err)
        await delay(3000).catch(()=>{})
        safeStart()
    }
}

/* ---------------- START ---------------- */
safeStart()

/* ---------------- CRASH HANDLERS ---------------- */
process.on("uncaughtException", (err) => {
    console.error("uncaughtException:", err)
    // attempt safe restart
    safeStart()
})
process.on("unhandledRejection", (err) => {
    console.error("unhandledRejection:", err)
    safeStart()
})

/* ---------------- HOT RELOAD ---------------- */
let file = require.resolve(__filename)
fs.watchFile(file, () => {
    fs.unwatchFile(file)
    console.log("♻ Reloading index.js...")
    delete require.cache[file]
    require(file)
})
