/**
 * func2.js - BUGFIXED-SULEXH-XMD WhatsApp Bot
 * CommonJS, Panel-safe
 */

const axios = require("axios")
const cheerio = require("cheerio")
const fs = require("fs")
const { unlink } = require("fs").promises
const child_process = require("child_process")
const FormData = require("form-data")
const path = require("path")

exports.sleep = ms => new Promise(r=>setTimeout(r,ms))

exports.fetchJson = async (url, options={})=>{
    try{
        const res = await axios.get(url,{ headers:{'User-Agent':'Mozilla/5.0'}, ...options})
        return res.data
    }catch(err){ return err }
}

exports.fetchBuffer = async (url, options={})=>{
    try{
        const res = await axios.get(url,{
            headers:{'User-Agent':'Mozilla/5.0','DNT':1,'Upgrade-Insecure-Request':1},
            ...options,
            responseType:'arraybuffer'
        })
        return res.data
    }catch(err){ return err }
}

exports.fetchUrl = exports.fetchJson

exports.WAVersion = async ()=>{
    const data = await exports.fetchUrl("https://web.whatsapp.com/check-update?version=1&platform=web")
    return [data.currentVersion.replace(/[.]/g,", ")]
}

exports.getRandom = ext=>`${Math.floor(Math.random()*10000)}${ext}`
exports.isUrl = url=>url.match(/https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&//=]*)/gi)
exports.isNumber = number=>!isNaN(parseInt(number))

exports.TelegraPh = filePath => new Promise(async (resolve,reject)=>{
    if(!fs.existsSync(filePath)) return reject(new Error("File not found"))
    try{
        const form = new FormData()
        form.append("file", fs.createReadStream(filePath))
        const res = await axios.post("https://telegra.ph/upload", form, { headers: form.getHeaders() })
        resolve("https://telegra.ph"+res.data[0].src)
    }catch(err){ reject(err) }
})

exports.webp2mp4File = filePath => new Promise((resolve,reject)=>{
    const form = new FormData()
    form.append('new-image-url','')
    form.append('new-image', fs.createReadStream(filePath))
    axios.post('https://s6.ezgif.com/webp-to-mp4', form, { headers: form.getHeaders() })
        .then(({data})=>{
            const $ = cheerio.load(data)
            const file = $('input[name="file"]').attr('value')
            const form2 = new FormData()
            form2.append('file', file)
            form2.append('convert',"Convert WebP to MP4!")
            axios.post('https://ezgif.com/webp-to-mp4/'+file, form2, { headers: form2.getHeaders() })
                .then(({data})=>{
                    const $2 = cheerio.load(data)
                    const result = 'https:'+$2('div#output > p.outfile > video > source').attr('src')
                    resolve({status:true,message:"Created By Eternity",result})
                }).catch(reject)
        }).catch(reject)
})

exports.buffergif = async image=>{
    const filename = Math.random().toString(36).slice(2)
    const gifPath = `./XeonMedia/trash/${filename}.gif`
    const mp4Path = `./XeonMedia/trash/${filename}.mp4`
    fs.writeFileSync(gifPath,image)
    child_process.execSync(`ffmpeg -i ${gifPath} -movflags faststart -pix_fmt yuv420p -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" ${mp4Path}`)
    await exports.sleep(4000)
    const buffer = fs.readFileSync(mp4Path)
    await Promise.all([unlink(gifPath),unlink(mp4Path)])
    return buffer
}
