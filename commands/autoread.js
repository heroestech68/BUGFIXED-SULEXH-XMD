/**
 * BUGFIXED-SULEXH-XMD - Autoread Command
 */

const fs = require('fs');
const path = require('path');
const isOwnerOrSudo = require('../lib/isOwner');

// Path to store configuration
const configPath = path.join(__dirname, '..', 'data', 'autoread.json');

// Initialize config file
function initConfig() {
    if (!fs.existsSync(configPath)) {
        fs.writeFileSync(configPath, JSON.stringify({ enabled: false }, null, 2));
    }
    return JSON.parse(fs.readFileSync(configPath));
}

// Toggle autoread
async function autoreadCommand(sock, chatId, message) {
    try {
        const senderId = message.key.participant || message.key.remoteJid;
        const isOwner = await isOwnerOrSudo(senderId, sock, chatId);

        if (!message.key.fromMe && !isOwner) {
            await sock.sendMessage(chatId, {
                text: '❌ This command is only available for the owner!',
                contextInfo: {
                    newsletterJid: '0029VbAD3222f3EIZyXe6w16@broadcast',
                    newsletterName: 'BUGFIXED-SULEXH-XMD',
                    serverMessageId: -1
                }
            });
            return;
        }

        // Get command args
        const args =
            message.message?.conversation?.trim().split(' ').slice(1) ||
            message.message?.extendedTextMessage?.text?.trim().split(' ').slice(1) ||
            [];

        // Load config
        const config = initConfig();

        if (args.length > 0) {
            const action = args[0].toLowerCase();
            if (action === 'on' || action === 'enable') config.enabled = true;
            else if (action === 'off' || action === 'disable') config.enabled = false;
            else {
                await sock.sendMessage(chatId, {
                    text: '❌ Invalid option! Use: .autoread on/off',
                    contextInfo: {
                        newsletterJid: '0029VbAD3222f3EIZyXe6w16@broadcast',
                        newsletterName: 'BUGFIXED-SULEXH-XMD',
                        serverMessageId: -1
                    }
                });
                return;
            }
        } else {
            config.enabled = !config.enabled;
        }

        // Save config
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

        // Confirmation message
        await sock.sendMessage(chatId, {
            text: `✅ Auto-read has been ${config.enabled ? 'enabled' : 'disabled'}!`,
            contextInfo: {
                newsletterJid: '0029VbAD3222f3EIZyXe6w16@broadcast',
                newsletterName: 'BUGFIXED-SULEXH-XMD',
                serverMessageId: -1
            }
        });

    } catch (error) {
        console.error('Error in autoread command:', error);
        await sock.sendMessage(chatId, {
            text: '❌ Error processing command!',
            contextInfo: {
                newsletterJid: '0029VbAD3222f3EIZyXe6w16@broadcast',
                newsletterName: 'BUGFIXED-SULEXH-XMD',
                serverMessageId: -1
            }
        });
    }
}

// Check if autoread enabled
function isAutoreadEnabled() {
    try {
        const config = initConfig();
        return config.enabled;
    } catch (error) {
        return false;
    }
}

// Check bot mentions
function isBotMentionedInMessage(message, botNumber) {
    if (!message.message) return false;

    const messageTypes = [
        'extendedTextMessage', 'imageMessage', 'videoMessage', 'stickerMessage',
        'documentMessage', 'audioMessage', 'contactMessage', 'locationMessage'
    ];

    for (const type of messageTypes) {
        if (message.message[type]?.contextInfo?.mentionedJid) {
            if (message.message[type].contextInfo.mentionedJid.includes(botNumber)) {
                return true;
            }
        }
    }

    const text =
        message.message.conversation ||
        message.message.extendedTextMessage?.text ||
        message.message.imageMessage?.caption ||
        message.message.videoMessage?.caption ||
        '';

    if (text) {
        const botId = botNumber.split('@')[0];
        if (text.includes(`@${botId}`)) return true;

        const botNames = [global.botname?.toLowerCase(), 'bot'];
        if (botNames.some(name => text.toLowerCase().includes(name))) return true;
    }

    return false;
}

// Handle autoread
async function handleAutoread(sock, message) {
    if (!isAutoreadEnabled()) return false;

    const botNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';
    const botMentioned = isBotMentionedInMessage(message, botNumber);

    if (botMentioned) return false;

    const key = {
        remoteJid: message.key.remoteJid,
        id: message.key.id,
        participant: message.key.participant
    };

    await sock.readMessages([key]);
    return true;
}

module.exports = {
    autoreadCommand,
    isAutoreadEnabled,
    isBotMentionedInMessage,
    handleAutoread
};
