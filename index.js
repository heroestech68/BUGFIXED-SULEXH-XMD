/**
 * Bugfixed-xmd-bot - A WhatsApp Bot
 * Copyright (c) 2024
 */

require('./settings')
const { Boom } = require('@hapi/boom')
const fs = require('fs')
const chalk = require('chalk')
const FileType = require('file-type')
const path = require('path')
const axios = require('axios')
const { handleMessages, handleGroupParticipantUpdate, handleStatus } = require('./main')
const PhoneNumber = require('awesome-phonenumber')
const { imageToWebp, videoToWebp, writeExifImg, writeExifVid } = require('./lib/exif')
const { smsg, isUrl, generateMessageTag, getBuffer, getSizeMedia, fetch, await, sleep, reSize } = require('./lib/myfunc')

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
const { join } = require('path')
const store = require('./lib/lightweight_store')

store.readFromFile()
const settings = require('./settings')
setInterval(() => store.writeToFile(), settings.storeWriteInterval || 10000)

// Garbage collection
setInterval(() => {
    if (global.gc) {
        global.gc()
        console.log('🧹 Garbage collection completed')
    }
}, 60_000)

// RAM monitor
setInterval(() => {
    const used = process.memoryUsage().rss / 1024 / 1024
    if (used > 400) {
        console.log('⚠️ RAM too high (>400MB), restarting bot...')
        process.exit(1)
    }
}, 30_000)

let phoneNumber = "911234567890"
let owner = JSON.parse(fs.readFileSync('./data/owner.json'))

global.botname = "KNIGHT BOT"
global.themeemoji = "•"
const pairingCode = !!phoneNumber || process.argv.includes("--pairing-code")
const useMobile = process.argv.includes("--mobile")

// Ask number in terminal
const rl = process.stdin.isTTY ? readline.createInterface({
    input: process.stdin,
    output: process.stdout
}) : null

const question = (text) => {
    if (rl) {
        return new Promise((resolve) => rl.question(text, resolve))
    } else {
        return Promise.resolve(settings.ownerNumber || phoneNumber)
    }
}

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
                let jid = jidNormalizedUser(key.remoteJid)
                let msg = await store.loadMessage(jid, key.id)
                return msg?.message || ""
            },
            msgRetryCounterCache,
            defaultQueryTimeoutMs: 60000,
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 10000
        })

        XeonBotInc.ev.on('creds.update', saveCreds)
        store.bind(XeonBotInc.ev)

        // MAIN MESSAGE HANDLER
        XeonBotInc.ev.on('messages.upsert', async chatUpdate => {
            let mek = null
            try {
                mek = chatUpdate.messages[0]
                if (!mek?.message) return

                mek.message =
                    (Object.keys(mek.message)[0] === 'ephemeralMessage')
                        ? mek.message.ephemeralMessage.message
                        : mek.message

                // Status handler
                if (mek.key?.remoteJid === 'status@broadcast') {
                    await handleStatus(XeonBotInc, chatUpdate)
                    return
                }

                if (!XeonBotInc.public &&
                    !mek.key.fromMe &&
                    chatUpdate.type === 'notify') {

                    const isGroup = mek.key.remoteJid.endsWith('@g.us')
                    if (!isGroup) return
                }

                if (mek.key.id.startsWith('BAE5') &&
                    mek.key.id.length === 16) return

                msgRetryCounterCache.clear()

                await handleMessages(XeonBotInc, chatUpdate, true)

            } catch (err) {
                console.error("Error in messages.upsert:", err)

                try {
                    if (mek?.key?.remoteJid) {
                        await XeonBotInc.sendMessage(mek.key.remoteJid, {
                            text: '❌ An error occurred while processing your message.'
                        })
                    }
                } catch { }
            }
        })

        // Decode JID
        XeonBotInc.decodeJid = (jid) => {
            if (!jid) return jid
            if (/:\d+@/gi.test(jid)) {
                let decode = jidDecode(jid) || {}
                return decode.user + '@' + decode.server
            } else return jid
        }

        // Contact update
        XeonBotInc.ev.on('contacts.update', updates => {
            for (const contact of updates) {
                let id = XeonBotInc.decodeJid(contact.id)
                store.contacts[id] = {
                    id,
                    name: contact.notify
                }
            }
        })

        // Get name
        XeonBotInc.getName = (jid, withoutContact = false) => {
            jid = XeonBotInc.decodeJid(jid)
            withoutContact = XeonBotInc.withoutContact || withoutContact

            let contact
            if (jid.endsWith("@g.us")) {
                return new Promise(async (resolve) => {
                    contact = store.contacts[jid] || await XeonBotInc.groupMetadata(jid) || {}
                    resolve(contact.name || contact.subject)
                })
            } else {
                contact =
                    jid === '0@s.whatsapp.net'
                        ? { id: jid, name: 'WhatsApp' }
                        : jid === XeonBotInc.decodeJid(XeonBotInc.user.id)
                            ? XeonBotInc.user
                            : store.contacts[jid] || {}

                return (!withoutContact && contact.name) || contact.subject
            }
        }

        XeonBotInc.public = true
        XeonBotInc.serializeM = (m) => smsg(XeonBotInc, m, store)

        // Pairing code
        if (pairingCode && !state.creds.registered) {
            if (useMobile) throw new Error('Cannot use pairing code with mobile api')

            let phone
            if (global.phoneNumber) {
                phone = global.phoneNumber
            } else {
                phone = await question(chalk.greenBright("Enter your WhatsApp number (e.g. 254712345678): "))
            }

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

        // Connection update
        XeonBotInc.ev.on("connection.update", async (s) => {
            const { connection, lastDisconnect, qr } = s

            if (qr) {
                console.log(chalk.yellow("Scan QR Code to login"))
            }

            if (connection === 'open') {
                console.log(chalk.green("Bot connected successfully!"))
                const botNumber = XeonBotInc.user.id.split(':')[0] + '@s.whatsapp.net'
                try {
                    await XeonBotInc.sendMessage(botNumber, {
                        text: `🤖 Bot Connected Successfully!`
                    })
                } catch { }
            }

            if (connection === "close") {
                const shouldReconnect =
                    (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut

                if (!shouldReconnect) {
                    rmSync("./session", { recursive: true, force: true })
                    console.log(chalk.red("Session expired. Re-authenticate."))
                }

                if (shouldReconnect) {
                    console.log("Reconnecting...")
                    startXeonBotInc()
                }
            }
        })

        // ANTI-CALL
        const antiCallNotified = new Set()

        XeonBotInc.ev.on("call", async (calls) => {
            try {
                const { readState: readAnticallState } = require('./commands/anticall')
                const state = readAnticallState()
                if (!state.enabled) return

                for (const call of calls) {
                    const callerJid = call.from || call.peerJid || call.chatId
                    if (!callerJid) continue

                    try {
                        if (!antiCallNotified.has(callerJid)) {
                            antiCallNotified.add(callerJid)
                            setTimeout(() => antiCallNotified.delete(callerJid), 60000)

                            await XeonBotInc.sendMessage(callerJid, {
                                text: '📵 Calls are not allowed. You will be blocked.'
                            })
                        }
                    } catch { }

                    setTimeout(async () => {
                        try {
                            await XeonBotInc.updateBlockStatus(callerJid, 'block')
                        } catch { }
                    }, 800)
                }
            } catch { }
        })

        // MEMBER UPDATE
        XeonBotInc.ev.on('group-participants.update', async (update) => {
            await handleGroupParticipantUpdate(XeonBotInc, update)
        })

        // Status updates
        XeonBotInc.ev.on("status.update", async (s) => handleStatus(XeonBotInc, s))
        XeonBotInc.ev.on("messages.reaction", async (s) => handleStatus(XeonBotInc, s))

        return XeonBotInc

    } catch (e) {
        console.error("Error:", e)
        delay(2000)
        startXeonBotInc()
    }
}

// Start bot
startXeonBotInc().catch(err => {
    console.error("Fatal error:", err)
    process.exit(1)
})

// Global errors
process.on("uncaughtException", console.error)
process.on("unhandledRejection", console.error)

// Hot-reload
let file = require.resolve(__filename)
fs.watchFile(file, () => {
    fs.unwatchFile(file)
    console.log("♻️ Reloading...")
    delete require.cache[file]
    require(file)
})
