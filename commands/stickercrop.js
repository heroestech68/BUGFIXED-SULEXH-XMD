const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const settings = require('../settings');
const webp = require('node-webpmux');
const crypto = require('crypto');

async function stickercropCommand(sock, chatId, message) {
    const messageToQuote = message;
    let targetMessage = message;

    if (message.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
        const quotedInfo = message.message.extendedTextMessage.contextInfo;
        targetMessage = {
            key: {
                remoteJid: chatId,
                id: quotedInfo.stanzaId,
                participant: quotedInfo.participant
            },
            message: quotedInfo.quotedMessage
        };
    }

    const mediaMessage = targetMessage.message?.imageMessage ||
        targetMessage.message?.videoMessage ||
        targetMessage.message?.documentMessage ||
        targetMessage.message?.stickerMessage;

    if (!mediaMessage) {
        await sock.sendMessage(
            chatId,
            {
                text: 'Please reply to an image/video/sticker with .crop, or send an image/video/sticker with .crop as the caption.',
                contextInfo: {
                    newsletterJid: '120363161513685998@newsletter',
                    newsletterName: 'BUGFIXED-SULEXH-XMD',
                    serverMessageId: -1
                }
            },
            { quoted: messageToQuote }
        );
        return;
    }

    try {
        const mediaBuffer = await downloadMediaMessage(
            targetMessage,
            'buffer',
            {},
            { logger: undefined, reuploadRequest: sock.updateMediaMessage }
        );

        if (!mediaBuffer) {
            await sock.sendMessage(chatId, {
                text: 'Failed to download media. Please try again.',
                contextInfo: {
                    newsletterJid: '120363161513685998@newsletter',
                    newsletterName: 'BUGFIXED-SULEXH-XMD',
                    serverMessageId: -1
                }
            });
            return;
        }

        const tmpDir = path.join(process.cwd(), 'tmp');
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

        const tempInput = path.join(tmpDir, `temp_${Date.now()}`);
        const tempOutput = path.join(tmpDir, `crop_${Date.now()}.webp`);

        fs.writeFileSync(tempInput, mediaBuffer);

        const isAnimated =
            mediaMessage.mimetype?.includes('gif') ||
            mediaMessage.mimetype?.includes('video') ||
            mediaMessage.seconds > 0;

        const fileSizeKB = mediaBuffer.length / 1024;
        const isLargeFile = fileSizeKB > 5000;

        let ffmpegCommand;
        if (isAnimated) {
            ffmpegCommand = isLargeFile
                ? `ffmpeg -i "${tempInput}" -t 2 -vf "crop=min(iw\\,ih):min(iw\\,ih),scale=512:512,fps=8" -c:v libwebp -preset default -loop 0 -quality 30 -compression_level 6 -b:v 100k "${tempOutput}"`
                : `ffmpeg -i "${tempInput}" -t 3 -vf "crop=min(iw\\,ih):min(iw\\,ih),scale=512:512,fps=12" -c:v libwebp -preset default -loop 0 -quality 50 -compression_level 6 -b:v 150k "${tempOutput}"`;
        } else {
            ffmpegCommand = `ffmpeg -i "${tempInput}" -vf "crop=min(iw\\,ih):min(iw\\,ih),scale=512:512,format=rgba" -c:v libwebp -preset default -quality 75 -compression_level 6 "${tempOutput}"`;
        }

        await new Promise((resolve, reject) => {
            exec(ffmpegCommand, (error) => {
                if (error) reject(error);
                else resolve();
            });
        });

        if (!fs.existsSync(tempOutput)) throw new Error('FFmpeg failed');
        const webpBuffer = fs.readFileSync(tempOutput);

        const img = new webp.Image();
        await img.load(webpBuffer);

        const json = {
            'sticker-pack-id': crypto.randomBytes(32).toString('hex'),
            'sticker-pack-name': settings.packname || 'BUGFIXED-SULEXH-XMD',
            'emojis': ['✂️']
        };

        const exifAttr = Buffer.from([
            0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00,
            0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x16, 0x00, 0x00, 0x00
        ]);

        const jsonBuffer = Buffer.from(JSON.stringify(json), 'utf8');
        const exif = Buffer.concat([exifAttr, jsonBuffer]);
        exif.writeUIntLE(jsonBuffer.length, 14, 4);

        img.exif = exif;
        const finalBuffer = await img.save(null);

        await sock.sendMessage(chatId, { sticker: finalBuffer }, { quoted: messageToQuote });

        fs.unlinkSync(tempInput);
        fs.unlinkSync(tempOutput);

    } catch (error) {
        console.error('Error in stickercrop command:', error);
        await sock.sendMessage(chatId, {
            text: 'Failed to crop sticker! Try with an image.',
            contextInfo: {
                newsletterJid: '120363161513685998@newsletter',
                newsletterName: 'BUGFIXED-SULEXH-XMD',
                serverMessageId: -1
            }
        });
    }
}

module.exports = stickercropCommand;

/* Buffer Crop Helper */
async function stickercropFromBuffer(inputBuffer, isAnimated) {
    const tmpDir = path.join(process.cwd(), 'tmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);

    const tempInput = path.join(tmpDir, `cropbuf_${Date.now()}`);
    const tempOutput = path.join(tmpDir, `cropbuf_out_${Date.now()}.webp`);
    fs.writeFileSync(tempInput, inputBuffer);

    const fileSizeKB = inputBuffer.length / 1024;
    const isLargeFile = fileSizeKB > 5000;

    let ffmpegCommand;
    if (isAnimated) {
        ffmpegCommand = isLargeFile
            ? `ffmpeg -y -i "${tempInput}" -t 2 -vf "crop=min(iw\\,ih):min(iw\\,ih),scale=512:512,fps=8" -c:v libwebp -quality 30 -compression_level 6 -b:v 100k "${tempOutput}"`
            : `ffmpeg -y -i "${tempInput}" -t 3 -vf "crop=min(iw\\,ih):min(iw\\,ih),scale=512:512,fps=12" -c:v libwebp -quality 50 -compression_level 6 -b:v 150k "${tempOutput}"`;
    } else {
        ffmpegCommand = `ffmpeg -y -i "${tempInput}" -vf "crop=min(iw\\,ih):min(iw\\,ih),scale=512:512,format=rgba" -c:v libwebp -quality 75 -compression_level 6 "${tempOutput}"`;
    }

    await new Promise((resolve, reject) => {
        exec(ffmpegCommand, (error) => error ? reject(error) : resolve());
    });

    const webpBuffer = fs.readFileSync(tempOutput);
    const img = new webp.Image();
    await img.load(webpBuffer);

    const json = {
        'sticker-pack-id': crypto.randomBytes(32).toString('hex'),
        'sticker-pack-name': settings.packname || 'BUGFIXED-SULEXH-XMD',
        'emojis': ['✂️']
    };

    const exifAttr = Buffer.from([
        0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00,
        0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x16, 0x00, 0x00, 0x00
    ]);

    const jsonBuffer = Buffer.from(JSON.stringify(json), 'utf8');
    const exif = Buffer.concat([exifAttr, jsonBuffer]);
    exif.writeUIntLE(jsonBuffer.length, 14, 4);
    img.exif = exif;

    const finalBuffer = await img.save(null);

    fs.unlinkSync(tempInput);
    fs.unlinkSync(tempOutput);

    return finalBuffer;
}

module.exports.stickercropFromBuffer = stickercropFromBuffer;
