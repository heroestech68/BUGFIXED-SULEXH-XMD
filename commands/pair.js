/**
 * myfunc.js - BUGFIXED-SULEXH-XMD WhatsApp Bot
 * CommonJS, Panel-safe, No Chalk
 */

const { proto, getContentType } = require('@whiskeysockets/baileys')
const fs = require('fs')
const Crypto = require('crypto')
const axios = require('axios')
const moment = require('moment-timezone')
const { sizeFormatter } = require('human-readable')
const util = require('util')
const Jimp = require('jimp')
const path = require('path')
const { tmpdir } = require('os')

// --- UTILITIES ---
exports.sleep = ms => new Promise(r => setTimeout(r, ms))
exports.unixTimestampSeconds = date => Math.floor((date || new Date()).getTime()/1000)

exports.generateMessageTag = (epoch) => {
    let tag = exports.unixTimestampSeconds().toString()
    if(epoch) tag += '.--' + epoch
    return tag
}

exports.processTime = (timestamp, now) => moment.duration(now - moment(timestamp*1000)).asSeconds()

exports.getRandom = ext => `${Math.floor(Math.random()*10000)}${ext}`

exports.getBuffer = async (url, options={}) => {
    try {
        const res = await axios.get(url, { responseType:'arraybuffer', ...options })
        return res.data
    } catch(err) { return err }
}

exports.fetchJson = async (url, options={}) => {
    try {
        const res = await axios.get(url, { ...options })
        return res.data
    } catch(err) { return err }
}

exports.clockString = ms => {
    const h = isNaN(ms)?'--':Math.floor(ms/3600000)
    const m = isNaN(ms)?'--':Math.floor(ms/60000)%60
    const s = isNaN(ms)?'--':Math.floor(ms/1000)%60
    return [h,m,s].map(v=>v.toString().padStart(2,'0')).join(':')
}

exports.formatp = sizeFormatter({ std:'JEDEC', decimalPlaces:2, keepTrailingZeroes:false, render:(l,s)=>`${l} ${s}B` })

exports.bytesToSize = (bytes, decimals=2)=>{
    if(bytes===0) return '0 Bytes'
    const k=1024
    const dm=decimals<0?0:decimals
    const sizes=['Bytes','KB','MB','GB','TB','PB','EB','ZB','YB']
    const i=Math.floor(Math.log(bytes)/Math.log(k))
    return parseFloat((bytes/Math.pow(k,i)).toFixed(dm))+' '+sizes[i]
}

exports.getSizeMedia = path => new Promise((resolve,reject)=>{
    if(/http/.test(path)){
        axios.get(path).then(res=>{
            const length=parseInt(res.headers['content-length'])
            const size=exports.bytesToSize(length,3)
            if(!isNaN(length)) resolve(size)
        })
    } else if(Buffer.isBuffer(path)){
        const length=Buffer.byteLength(path)
        const size=exports.bytesToSize(length,3)
        if(!isNaN(length)) resolve(size)
    } else reject('error unknown')
})

exports.generateProfilePicture = async buffer=>{
    const img = await Jimp.read(buffer)
    const min = img.getWidth()
    const max = img.getHeight()
    const cropped = img.crop(0,0,min,max)
    return {
        img: await cropped.scaleToFit(720,720).getBufferAsync(Jimp.MIME_JPEG),
        preview: await cropped.scaleToFit(720,720).getBufferAsync(Jimp.MIME_JPEG)
    }
}

exports.parseMention = text => [...(text||'').matchAll(/@([0-9]{5,16}|0)/g)].map(v=>v[1]+'@s.whatsapp.net')
exports.getGroupAdmins = participants => participants.filter(p=>p.admin==='superadmin'||p.admin==='admin').map(p=>p.id)
