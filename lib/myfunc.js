/**
 * BUGFIXED-SULEXH-XMD - A WhatsApp Bot
 * Copyright (c) 2024 Professor
 * MIT License
 */

const {
    proto,
    delay,
    getContentType
} = require('@whiskeysockets/baileys')
const fs = require('fs')
const Crypto = require('crypto')
const axios = require('axios')
const moment = require('moment-timezone')
const { sizeFormatter } = require('human-readable')
const util = require('util')
const Jimp = require('jimp')
const { defaultMaxListeners } = require('stream')
const path = require('path')
const { tmpdir } = require('os')

// ---------- UTILITY FUNCTIONS ----------

const unixTimestampSeconds = (date = new Date()) => Math.floor(date.getTime() / 1000)
exports.unixTimestampSeconds = unixTimestampSeconds

exports.generateMessageTag = (epoch) => {
    let tag = unixTimestampSeconds().toString()
    if (epoch) tag += '.--' + epoch
    return tag
}

exports.processTime = (timestamp, now) => moment.duration(now - moment(timestamp * 1000)).asSeconds()

exports.getRandom = (ext) => `${Math.floor(Math.random() * 10000)}${ext}`

exports.getBuffer = async (url, options = {}) => {
    try {
        const res = await axios({
            method: "get",
            url,
            headers: { 'DNT': 1, 'Upgrade-Insecure-Request': 1 },
            ...options,
            responseType: 'arraybuffer'
        })
        return res.data
    } catch (err) {
        return err
    }
}

exports.getImg = exports.getBuffer

exports.fetchJson = async (url, options = {}) => {
    try {
        const res = await axios({
            method: 'GET',
            url,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
            },
            ...options
        })
        return res.data
    } catch (err) {
        return err
    }
}

exports.runtime = function(seconds) {
    seconds = Number(seconds)
    const d = Math.floor(seconds / (3600 * 24))
    const h = Math.floor(seconds % (3600 * 24) / 3600)
    const m = Math.floor(seconds % 3600 / 60)
    const s = Math.floor(seconds % 60)
    const dDisplay = d > 0 ? d + (d === 1 ? " day, " : " days, ") : ""
    const hDisplay = h > 0 ? h + (h === 1 ? " hour, " : " hours, ") : ""
    const mDisplay = m > 0 ? m + (m === 1 ? " minute, " : " minutes, ") : ""
    const sDisplay = s > 0 ? s + (s === 1 ? " second" : " seconds") : ""
    return dDisplay + hDisplay + mDisplay + sDisplay
}

exports.clockString = (ms) => {
    const h = isNaN(ms) ? '--' : Math.floor(ms / 3600000)
    const m = isNaN(ms) ? '--' : Math.floor(ms / 60000) % 60
    const s = isNaN(ms) ? '--' : Math.floor(ms / 1000) % 60
    return [h, m, s].map(v => v.toString().padStart(2, '0')).join(':')
}

exports.sleep = async (ms) => new Promise(resolve => setTimeout(resolve, ms))

exports.isUrl = (url) => url.match(/https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&/=]*)/gi)

exports.getTime = (format, date) => date ? moment(date).locale('id').format(format) : moment.tz('Asia/Jakarta').locale('id').format(format)

exports.formatDate = (n, locale = 'id') => {
    const d = new Date(n)
    return d.toLocaleDateString(locale, {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric'
    })
}

exports.tanggal = (numer) => {
    const myMonths = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"]
    const myDays = ['Minggu','Senin','Selasa','Rabu','Kamis',"Jum'at",'Sabtu']
    const tgl = new Date(numer)
    const day = tgl.getDate()
    const bulan = tgl.getMonth()
    const thisDay = myDays[tgl.getDay()]
    const yy = tgl.getYear()
    const year = (yy < 1000) ? yy + 1900 : yy
    return `${thisDay}, ${day} - ${myMonths[bulan]} - ${year}`
}

exports.formatp = sizeFormatter({ std: 'JEDEC', decimalPlaces: 2, keepTrailingZeroes: false, render: (l,s) => `${l} ${s}B` })

exports.json = (string) => JSON.stringify(string, null, 2)

exports.logic = (check, inp, out) => {
    if(inp.length !== out.length) throw new Error('Input and Output must have same length')
    for (let i in inp) if(util.isDeepStrictEqual(check, inp[i])) return out[i]
    return null
}

exports.generateProfilePicture = async (buffer) => {
    const jimp = await Jimp.read(buffer)
    const min = jimp.getWidth()
    const max = jimp.getHeight()
    const cropped = jimp.crop(0,0,min,max)
    return {
        img: await cropped.scaleToFit(720,720).getBufferAsync(Jimp.MIME_JPEG),
        preview: await cropped.scaleToFit(720,720).getBufferAsync(Jimp.MIME_JPEG)
    }
}

exports.bytesToSize = (bytes, decimals = 2) => {
    if(bytes===0) return '0 Bytes'
    const k = 1024
    const dm = decimals<0?0:decimals
    const sizes=['Bytes','KB','MB','GB','TB','PB','EB','ZB','YB']
    const i = Math.floor(Math.log(bytes)/Math.log(k))
    return parseFloat((bytes/Math.pow(k,i)).toFixed(dm)) + ' ' + sizes[i]
}

exports.getSizeMedia = (path) => new Promise((resolve,reject)=>{
    if(/http/.test(path)){
        axios.get(path).then(res=>{
            const length = parseInt(res.headers['content-length'])
            const size = exports.bytesToSize(length,3)
            if(!isNaN(length)) resolve(size)
        })
    } else if(Buffer.isBuffer(path)){
        const length = Buffer.byteLength(path)
        const size = exports.bytesToSize(length,3)
        if(!isNaN(length)) resolve(size)
    } else reject('error unknown')
})

exports.parseMention = (text='') => [...text.matchAll(/@([0-9]{5,16}|0)/g)].map(v=>v[1]+'@s.whatsapp.net')

exports.getGroupAdmins = (participants) => {
    let admins=[]
    for(let i of participants){
        if(i.admin==='superadmin'||i.admin==='admin') admins.push(i.id)
    }
    return admins
}

// ---------- SERIALIZE MESSAGE ----------
exports.smsg = (XeonBotInc,m,store)=>{
    if(!m) return m
    const M = proto.WebMessageInfo
    if(m.key){
        m.id = m.key.id
        m.isBaileys = m.id.startsWith('BAE5') && m.id.length===16
        m.chat = m.key.remoteJid
        m.fromMe = m.key.fromMe
        m.isGroup = m.chat.endsWith('@g.us')
        m.sender = XeonBotInc.decodeJid(m.fromMe && XeonBotInc.user?.id || m.participant || m.key.participant || m.chat || '')
        if(m.isGroup) m.participant = XeonBotInc.decodeJid(m.key.participant) || ''
    }
    if(m.message){
        m.mtype = getContentType(m.message)
        m.msg = (m.mtype==='viewOnceMessage'?m.message[m.mtype].message[getContentType(m.message[m.mtype].message)]:m.message[m.mtype])
        m.body = m.message.conversation || m.msg.caption || m.msg.text || (m.mtype=='listResponseMessage'?m.msg.singleSelectReply.selectedRowId:(m.mtype=='buttonsResponseMessage'?m.msg.selectedButtonId:(m.mtype=='viewOnceMessage'?m.msg.caption:m.text)))
        const quoted = m.quoted = m.msg.contextInfo?.quotedMessage || null
        m.mentionedJid = m.msg.contextInfo?.mentionedJid || []
    }
    m.reply = (text, chatId=m.chat, options={})=>Buffer.isBuffer(text)?XeonBotInc.sendMedia(chatId,text,'file','',m,{...options}):XeonBotInc.sendText(chatId,text,m,{...options})
    return m
}

exports.reSize = (buffer, w, h) => new Promise(async(resolve)=>{
    const img = await Jimp.read(buffer)
    const ab = await img.resize(w,h).getBufferAsync(Jimp.MIME_JPEG)
    resolve(ab)
})

// Watch file updates (panel-safe, no chalk)
const file = require.resolve(__filename)
fs.watchFile(file,()=>{
    fs.unwatchFile(file)
    console.log(`[myfunc.js] Updated ${__filename}`)
    delete require.cache[file]
    require(file)
})
