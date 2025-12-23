'use strict';

const settings = require('./settings');
require('./config');

const { loadCommands, getCommand } = require('./commands');
const isAdmin = require('./lib/isAdmin');
const isOwnerOrSudo = require('./lib/isOwner');
const { isSudo } = require('./lib/index');
const { isBanned } = require('./lib/isBanned');

// ===== GLOBALS =====
global.packname = settings.packname;
global.author = settings.author;
global.channelLink = 'https://whatsapp.com/channel/0029VbAD3222f3EIZyXe6w16';

// Load commands once (RAM friendly)
const commands = loadCommands();

// ===================================================
// ================= MESSAGE HANDLER =================
// ===================================================

async function handleMessages(sock, update) {
    try {
        if (update?.type !== 'notify') return;
        const msg = update.messages?.[0];
        if (!msg?.message) return;

        const chatId = msg.key.remoteJid;
        const senderId = msg.key.participant || chatId;
        const isGroup = chatId.endsWith('@g.us');

        const body =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            msg.message.imageMessage?.caption ||
            msg.message.videoMessage?.caption ||
            '';

        if (!body.startsWith('.')) return;
        const args = body.trim().split(/\s+/);
        const cmdName = args[0].slice(1).toLowerCase();

        const senderIsOwnerOrSudo = await isOwnerOrSudo(senderId, sock, chatId);
        const senderIsSudo = await isSudo(senderId);

        // ===== BAN =====
        if (isBanned(senderId) && cmdName !== 'unban') {
            await sock.sendMessage(chatId, { text: '❌ You are banned.' });
            return;
        }

        // ===== ADMIN STATUS =====
        let admin = { isSenderAdmin: false, isBotAdmin: false };
        if (isGroup) admin = await isAdmin(sock, chatId, senderId);

        const command = getCommand(commands, cmdName);
        if (!command) return;

        // ===== PERMISSIONS =====
        if (command.owner && !senderIsOwnerOrSudo) return;
        if (command.group && !isGroup) return;
        if (command.admin && !admin.isSenderAdmin && !senderIsOwnerOrSudo) return;
        if (command.botAdmin && !admin.isBotAdmin) return;

        await command.run({
            sock,
            msg,
            chatId,
            senderId,
            args,
            isGroup,
            admin,
            senderIsOwnerOrSudo,
            senderIsSudo
        });

    } catch (err) {
        console.error('❌ main.js error:', err);
    }
}

module.exports = { handleMessages };
