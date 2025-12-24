/**
 * Knight Bot - A WhatsApp Bot
 * Copyright (c) 2024 Professor
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 * 
 * Credits:
 * - Baileys Library by @adiwajshing
 * - Pair Code implementation inspired by TechGod143 & DGXEON
 */
require('./settings')
const { Boom } = require('@hapi/boom')
const fs = require('fs')
const chalk = require('chalk')
const FileType = require('file-type')
const path = require('path')
const axios = require('axios')
const { handleMessages, handleGroupParticipantUpdate, handleStatus } = require('./main');
const PhoneNumber = require('awesome-phonenumber')
const { imageToWebp, videoToWebp, writeExifImg, writeExifVid } = require('./lib/exif')
const { smsg, isUrl, generateMessageTag, getBuffer, getSizeMedia, fetch, await, sleep, reSize } = require('./lib/myfunc')
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
const { rmSync } = require('fs')

// Import lightweight store
const store = require('./lib/lightweight_store')
store.readFromFile()
const settings = require('./settings')
setInterval(() => store.writeToFile(), settings.storeWriteInterval || 10000)

// Memory optimization
setInterval(() => { if (global.gc) global.gc() }, 60_000)
setInterval(() => { if ((process.memoryUsage().rss / 1024 / 1024) > 400) process.exit(1) }, 30_000)

let phoneNumber = "911234567890"
let owner = JSON.parse(fs.readFileSync('./data/owner.json'))

global.botname = "KNIGHT BOT"
global.themeemoji = "•"
const pairingCode = !!phoneNumber || process.argv.includes("--pairing-code")
const useMobile = process.argv.includes("--mobile")

const rl = process.stdin.isTTY ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null
const question = (text) => rl ? new Promise(resolve => rl.question(text, resolve)) : Promise.resolve(settings.ownerNumber || phoneNumber)

// === Start Bot ===
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
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
            },
            markOnlineOnConnect: true,
            generateHighQualityLinkPreview: true,
            syncFullHistory: false,
            getMessage: async key => {
                let jid = jidNormalizedUser(key.remoteJid)
                let msg = await store.loadMessage(jid, key.id)
                return msg?.message || ""
            },
            msgRetryCounterCache,
            defaultQueryTimeoutMs: 60000,
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 10000,
        })

        XeonBotInc.ev.on('creds.update', saveCreds)
        store.bind(XeonBotInc.ev)

        // ========== Message Handling ==========
        XeonBotInc.ev.on('messages.upsert', async chatUpdate => {
            try {
                const mek = chatUpdate.messages[0]
                if (!mek.message) return
                mek.message = Object.keys(mek.message)[0] === 'ephemeralMessage' ? mek.message.ephemeralMessage.message : mek.message
                if (mek.key && mek.key.remoteJid === 'status@broadcast') {
                    await handleStatus(XeonBotInc, chatUpdate); return;
                }
                if (!XeonBotInc.public && !mek.key.fromMe && chatUpdate.type === 'notify') {
                    const isGroup = mek.key?.remoteJid?.endsWith('@g.us')
                    if (!isGroup) return
                }
                if (mek.key.id.startsWith('BAE5') && mek.key.id.length === 16) return
                if (XeonBotInc?.msgRetryCounterCache) XeonBotInc.msgRetryCounterCache.clear()
                try { await handleMessages(XeonBotInc, chatUpdate, true) } catch (err) {
                    console.error("Error in handleMessages:", err)
                    if (mek.key && mek.key.remoteJid) await XeonBotInc.sendMessage(mek.key.remoteJid, { text: '❌ Error processing message.' }).catch(console.error)
                }
            } catch (err) { console.error("Error in messages.upsert:", err) }
        })

        // ========== Decode JID ==========
        XeonBotInc.decodeJid = jid => {
            if (!jid) return jid
            if (/:\d+@/gi.test(jid)) {
                let decode = jidDecode(jid) || {}
                return decode.user && decode.server ? decode.user + '@' + decode.server : jid
            } else return jid
        }

        // ========== Contacts ==========
        XeonBotInc.ev.on('contacts.update', update => {
            for (let contact of update) {
                let id = XeonBotInc.decodeJid(contact.id)
                if (store && store.contacts) store.contacts[id] = { id, name: contact.notify }
            }
        })

        XeonBotInc.getName = (jid, withoutContact = false) => {
            let id = XeonBotInc.decodeJid(jid)
            withoutContact = XeonBotInc.withoutContact || withoutContact
            let v
            if (id.endsWith("@g.us")) return new Promise(async resolve => {
                v = store.contacts[id] || {}
                if (!(v.name || v.subject)) v = XeonBotInc.groupMetadata(id) || {}
                resolve(v.name || v.subject || PhoneNumber('+' + id.replace('@s.whatsapp.net', '')).getNumber('international'))
            })
            else v = id === '0@s.whatsapp.net' ? { id, name: 'WhatsApp' } : id === XeonBotInc.decodeJid(XeonBotInc.user.id) ? XeonBotInc.user : (store.contacts[id] || {})
            return (withoutContact ? '' : v.name) || v.subject || v.verifiedName || PhoneNumber('+' + jid.replace('@s.whatsapp.net', '')).getNumber('international')
        }

        XeonBotInc.public = true
        XeonBotInc.serializeM = m => smsg(XeonBotInc, m, store)

        // ========== Pairing Code ==========
        if (pairingCode && !XeonBotInc.authState.creds.registered) {
            if (useMobile) throw new Error('Cannot use pairing code with mobile api')
            let phoneNumber
            if (!!global.phoneNumber) phoneNumber = global.phoneNumber
            else phoneNumber = await question(chalk.bgBlack(chalk.greenBright(`Please type your WhatsApp number 😍\nFormat: 6281376552730 (without + or spaces) : `)))
            phoneNumber = phoneNumber.replace(/[^0-9]/g, '')
            const pn = require('awesome-phonenumber')
            if (!pn('+' + phoneNumber).isValid()) {
                console.log(chalk.red('Invalid phone number.'))
                process.exit(1)
            }
            setTimeout(async () => {
                try {
                    let code = await XeonBotInc.requestPairingCode(phoneNumber)
                    code = code?.match(/.{1,4}/g)?.join("-") || code
                    console.log(chalk.black(chalk.bgGreen(`Your Pairing Code : `)), chalk.black(chalk.white(code)))
                } catch (error) { console.log(chalk.red('Failed to get pairing code.')) }
            }, 3000)
        }

        // ========== Connection Updates ==========
        XeonBotInc.ev.on('connection.update', async s => {
            const { connection, lastDisconnect, qr } = s
            if (qr) console.log(chalk.yellow('📱 QR Code generated.'))
            if (connection === 'connecting') console.log(chalk.yellow('🔄 Connecting to WhatsApp...'))
            if (connection == "open") {
                console.log(chalk.magenta(`Connected to => ` + JSON.stringify(XeonBotInc.user, null, 2)))
                try {
                    const botNumber = XeonBotInc.user.id.split(':')[0] + '@s.whatsapp.net';
                    await XeonBotInc.sendMessage(botNumber, { text: `🤖 Bot Connected Successfully!\n⏰ Time: ${new Date().toLocaleString()}\n✅ Status: Online` });
                } catch {}
            }
            if (connection === 'close') {
                const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut
                if (lastDisconnect?.error?.output?.statusCode === DisconnectReason.loggedOut || lastDisconnect?.error?.output?.statusCode === 401) rmSync('./session', { recursive: true, force: true })
                if (shouldReconnect) { await delay(5000); startXeonBotInc() }
            }
        })

        // ========== Anticall ==========
        const antiCallNotified = new Set()
        XeonBotInc.ev.on('call', async calls => {
            try {
                const { readState: readAnticallState } = require('./commands/anticall');
                const state = readAnticallState();
                if (!state.enabled) return;
                for (const call of calls) {
                    const callerJid = call.from || call.peerJid || call.chatId;
                    if (!callerJid) continue;
                    try { if (typeof XeonBotInc.rejectCall === 'function' && call.id) await XeonBotInc.rejectCall(call.id, callerJid) } catch {}
                    if (!antiCallNotified.has(callerJid)) {
                        antiCallNotified.add(callerJid)
                        setTimeout(() => antiCallNotified.delete(callerJid), 60000)
                        await XeonBotInc.sendMessage(callerJid, { text: '📵 Anticall is enabled. Your call was rejected.' })
                    }
                    setTimeout(async () => { try { await XeonBotInc.updateBlockStatus(callerJid, 'block') } catch {} }, 800)
                }
            } catch {}
        })

        XeonBotInc.ev.on('group-participants.update', async update => await handleGroupParticipantUpdate(XeonBotInc, update))
        XeonBotInc.ev.on('messages.upsert', async m => { if (m.messages[0].key?.remoteJid === 'status@broadcast') await handleStatus(XeonBotInc, m) })
        XeonBotInc.ev.on('status.update', async status => await handleStatus(XeonBotInc, status))
        XeonBotInc.ev.on('messages.reaction', async status => await handleStatus(XeonBotInc, status))

        // =======================
        // PROLONGED FAKE PRESENCE ENGINE
        // =======================
        const presenceSettings = require('./presence_settings')
        let lastPresenceChat = null
        let lastPulse = 0
        function pickActiveChat() {
            const chats = Object.keys(store.chats || {})
            return chats.find(j => j.endsWith('@s.whatsapp.net') || j.endsWith('@g.us')) || null
        }
        setInterval(async () => {
            try {
                const ps = presenceSettings;
                const chatId = pickActiveChat()
                if (!chatId) return
                const now = Date.now()
                if (now - lastPulse < 9000) return
                lastPulse = now
                lastPresenceChat = chatId

                if (ps.alwaysonline) { await XeonBotInc.sendPresenceUpdate('available', chatId); return }
                if (ps.autotyping) { await XeonBotInc.sendPresenceUpdate('composing', chatId); return }
                if (ps.autorecording) { await XeonBotInc.sendPresenceUpdate('recording', chatId); return }
                await XeonBotInc.sendPresenceUpdate('available', chatId)
            } catch (err) { console.error('Presence error:', err) }
        }, 10_000)

        return XeonBotInc
    } catch (error) {
        console.error('Error in startXeonBotInc:', error)
        await delay(5000)
        startXeonBotInc()
    }
}

// Start the bot
startXeonBotInc().catch(error => { console.error('Fatal error:', error); process.exit(1) })

process.on('uncaughtException', err => console.error('Uncaught Exception:', err))
process.on('unhandledRejection', err => console.error('Unhandled Rejection:', err))

let file = require.resolve(__filename)
fs.watchFile(file, () => { fs.unwatchFile(file); console.log(chalk.redBright(`Update ${__filename}`)); delete require.cache[file]; require(file) })
