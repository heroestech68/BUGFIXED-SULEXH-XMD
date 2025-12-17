/**
 * BUGFIXED SULEXH - A WhatsApp Bot
 * Copyright (c) 2024 Professor
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 */

require('./settings')
const { Boom } = require('@hapi/boom')
const fs = require('fs')
const chalk = require('chalk')
const FileType = require('file-type')
const path = require('path')
const axios = require('axios')

// 🔴 IMPORT initPresence
const { handleMessages, handleGroupParticipantUpdate, handleStatus, initPresence } = require('./main');

const PhoneNumber = require('awesome-phonenumber')
const { imageToWebp, videoToWebp, writeExifImg, writeExifVid } = require('./lib/exif')
const { smsg, isUrl, generateMessageTag, getBuffer, getSizeMedia, fetch, await, sleep, reSize } = require('./lib/myfunc')

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

const NodeCache = require("node-cache")
const pino = require("pino")
const readline = require("readline")
const { rmSync } = require('fs')

const store = require('./lib/lightweight_store')
store.readFromFile()

const settings = require('./settings')
setInterval(() => store.writeToFile(), settings.storeWriteInterval || 10000)

setInterval(() => {
    if (global.gc) {
        global.gc()
        console.log('🧹 Garbage collection completed')
    }
}, 60_000)

setInterval(() => {
    const used = process.memoryUsage().rss / 1024 / 1024
    if (used > 400) {
        console.log('⚠️ RAM too high (>400MB), restarting bot...')
        process.exit(1)
    }
}, 30_000)

let phoneNumber = "911234567890"
let owner = JSON.parse(fs.readFileSync('./data/owner.json'))

global.botname = "BUGFIXED SULEXH XMD"
global.themeemoji = "•"

async function startXeonBotInc() {
    try {
        let { version } = await fetchLatestBaileysVersion()
        const { state, saveCreds } = await useMultiFileAuthState(`./session`)
        const msgRetryCounterCache = new NodeCache()

        const XeonBotInc = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: true,
            browser: ["Ubuntu", "Chrome", "20.0.04"],
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
            },
            markOnlineOnConnect: true,
            msgRetryCounterCache
        })

        XeonBotInc.ev.on('creds.update', saveCreds)
        store.bind(XeonBotInc.ev)

        XeonBotInc.ev.on('messages.upsert', async chatUpdate => {
            await handleMessages(XeonBotInc, chatUpdate)
        })

        XeonBotInc.ev.on('group-participants.update', async (update) => {
            await handleGroupParticipantUpdate(XeonBotInc, update)
        })

        XeonBotInc.ev.on('connection.update', async (s) => {
            const { connection, lastDisconnect } = s

            if (connection === 'open') {
                console.log(chalk.green('✅ Bot Connected Successfully'))

                // 🔴 START PRESENCE LOOP (CRITICAL)
                initPresence(XeonBotInc)

                const botNumber = XeonBotInc.user.id.split(':')[0] + '@s.whatsapp.net'
                await XeonBotInc.sendMessage(botNumber, {
                    text: `🤖 Bot Connected & Presence Restored\n\n✅ Typing / Recording / Online states active`
                })
            }

            if (connection === 'close') {
                const shouldReconnect =
                    lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut

                if (shouldReconnect) {
                    console.log(chalk.yellow('🔁 Reconnecting...'))
                    await delay(5000)
                    startXeonBotInc()
                }
            }
        })

        XeonBotInc.ev.on('status.update', async (status) => {
            await handleStatus(XeonBotInc, status)
        })

        return XeonBotInc
    } catch (error) {
        console.error('Fatal error:', error)
        process.exit(1)
    }
}

startXeonBotInc()

process.on('uncaughtException', err => console.error(err))
process.on('unhandledRejection', err => console.error(err))
