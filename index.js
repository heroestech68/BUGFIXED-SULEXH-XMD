/**
BUGFIXED SULEXH - A WhatsApp Bot
Copyright (c) 2024 Professor

This program is free software: you can redistribute it and/or modify
it under the terms of the MIT License.

Credits:
- Baileys Library by @adiwajshing
- Pair Code implementation inspired by TechGod143 & DGXEON
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
} = require('@whiskeysockets/baileys')

const NodeCache = require('node-cache')
const pino = require('pino')
const readline = require('readline')
const { parsePhoneNumber } = require('libphonenumber-js')
const { PHONENUMBER_MCC } = require('@whiskeysockets/baileys/lib/Utils/generics')
const { rmSync } = require('fs')

// Lightweight store
const store = require('./lib/lightweight_store')
store.readFromFile()

const settings = require('./settings')
setInterval(() => store.writeToFile(), settings.storeWriteInterval || 10000)

// Memory GC
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

let phoneNumber = '911234567890'
let owner = JSON.parse(fs.readFileSync('./data/owner.json'))

global.botname = 'BUGFIXED SULEXH XMD'
global.themeemoji = '•'

const pairingCode = !!phoneNumber || process.argv.includes('--pairing-code')
const useMobile = process.argv.includes('--mobile')

const rl = process.stdin.isTTY
  ? readline.createInterface({ input: process.stdin, output: process.stdout })
  : null

const question = (text) => {
  if (rl) {
    return new Promise(resolve => rl.question(text, resolve))
  }
  return Promise.resolve(settings.ownerNumber || phoneNumber)
}

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
          pino({ level: 'fatal' }).child({ level: 'fatal' })
        ),
      },
      markOnlineOnConnect: true,
      generateHighQualityLinkPreview: true,
      syncFullHistory: false,
      getMessage: async (key) => {
        let jid = jidNormalizedUser(key.remoteJid)
        let msg = await store.loadMessage(jid, key.id)
        return msg?.message || ''
      },
      msgRetryCounterCache,
      defaultQueryTimeoutMs: 60000,
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 10000,
    })

    XeonBotInc.ev.on('creds.update', saveCreds)
    store.bind(XeonBotInc.ev)

    XeonBotInc.ev.on('messages.upsert', async chatUpdate => {
      try {
        const mek = chatUpdate.messages[0]
        if (!mek.message) return

        mek.message = Object.keys(mek.message)[0] === 'ephemeralMessage'
          ? mek.message.ephemeralMessage.message
          : mek.message

        if (mek.key?.remoteJid === 'status@broadcast') {
          await handleStatus(XeonBotInc, chatUpdate)
          return
        }

        if (!XeonBotInc.public && !mek.key.fromMe && chatUpdate.type === 'notify') {
          if (!mek.key.remoteJid.endsWith('@g.us')) return
        }

        if (mek.key.id.startsWith('BAE5') && mek.key.id.length === 16) return

        msgRetryCounterCache.clear()
        await handleMessages(XeonBotInc, chatUpdate, true)

      } catch (err) {
        console.error('messages.upsert error:', err)
      }
    })

    XeonBotInc.public = true
    XeonBotInc.serializeM = m => smsg(XeonBotInc, m, store)

    if (pairingCode && !XeonBotInc.authState.creds.registered) {
      if (useMobile) throw new Error('Cannot use pairing code with mobile api')

      let number = global.phoneNumber || await question(
        chalk.greenBright('Enter WhatsApp number (no +): ')
      )

      number = number.replace(/\D/g, '')
      const pn = require('awesome-phonenumber')

      if (!pn('+' + number).isValid()) {
        console.log(chalk.red('Invalid phone number'))
        process.exit(1)
      }

      setTimeout(async () => {
        const code = await XeonBotInc.requestPairingCode(number)
        console.log(chalk.bgGreen.black('PAIR CODE:'), code.match(/.{1,4}/g).join('-'))
      }, 3000)
    }

    XeonBotInc.ev.on('connection.update', async (s) => {
      const { connection, lastDisconnect, qr } = s

      if (qr) console.log(chalk.yellow('📱 Scan QR Code'))
      if (connection === 'connecting') console.log('🔄 Connecting...')
      if (connection === 'open') console.log('✅ Connected')

      if (connection === 'close') {
        const shouldReconnect =
          lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut

        if (shouldReconnect) startXeonBotInc()
      }
    })

    return XeonBotInc

  } catch (err) {
    console.error('startXeonBotInc error:', err)
    await delay(5000)
    startXeonBotInc()
  }
}

startXeonBotInc()

process.on('uncaughtException', err => console.error(err))
process.on('unhandledRejection', err => console.error(err))

let file = require.resolve(__filename)
fs.watchFile(file, () => {
  fs.unwatchFile(file)
  console.log(chalk.redBright(`Update ${__filename}`))
  delete require.cache[file]
  require(file)
})
