const isOwnerOrSudo = require('../lib/isOwner');

module.exports = async (sock, chatId, message, args) => {
    const senderId = message.key.participant || message.key.remoteJid;
    const isOwner = await isOwnerOrSudo(senderId, sock, chatId);

    if (!message.key.fromMe && !isOwner) {
        return sock.sendMessage(chatId, { text: 'Owner only command.' }, { quoted: message });
    }

    const mode = (args[0] || '').toLowerCase();

    if (!['online', 'typing', 'recording', 'off'].includes(mode)) {
        return sock.sendMessage(chatId, {
            text: 'Usage:\n.presence online | typing | recording | off'
        }, { quoted: message });
    }

    if (mode === 'off') {
        await sock.sendPresenceUpdate('unavailable', chatId);
        return sock.sendMessage(chatId, { text: 'Presence disabled.' }, { quoted: message });
    }

    const map = {
        online: 'available',
        typing: 'composing',
        recording: 'recording'
    };

    await sock.sendPresenceUpdate(map[mode], chatId);
    await sock.sendMessage(chatId, { text: `Presence set to ${mode}` }, { quoted: message });
};
