/**
 * BUGFIXED-SULEXH-XMD - A WhatsApp Bot
 * Autotyping Command - INFINITE realistic typing
 */

const fs = require('fs');
const path = require('path');
const isOwnerOrSudo = require('../lib/isOwner');

// ================= CONFIG =================

const configPath = path.join(__dirname, '..', 'data', 'autotyping.json');

function initConfig() {
    if (!fs.existsSync(configPath)) {
        fs.writeFileSync(configPath, JSON.stringify({ enabled: false }, null, 2));
    }
    return JSON.parse(fs.readFileSync(configPath));
}

// ================= CHANNEL INFO =================

const channelInfo = {
    contextInfo: {
        newsletterJid: '0029VbAD3222f3EIZyXe6w16@broadcast',
        newsletterName: 'BUGFIXED-SULEXH-XMD',
        serverMessageId: -1
    }
};

// ================= INTERNAL STATE =================

// Track active typing sessions per chat
const typingSessions = new Map();

// Delay helper
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// ================= COMMAND =================

async function autotypingCommand(sock, chatId, message) {
    try {
        const senderId = message.key.participant || message.key.remoteJid;
        const isOwner = await isOwnerOrSudo(senderId, sock, chatId);

        if (!message.key.fromMe && !isOwner) {
            await sock.sendMessage(
                chatId,
                {
                    text: '❌ This command is only available for the owner!',
                    ...channelInfo
                },
                { quoted: message }
            );
            return;
        }

        const text =
            message.message?.conversation ||
            message.message?.extendedTextMessage?.text ||
            '';

        const args = text.trim().split(/\s+/).slice(1);
        const config = initConfig();

        if (args.length > 0) {
            const action = args[0].toLowerCase();
            if (action === 'on' || action === 'enable') {
                config.enabled = true;
            } else if (action === 'off' || action === 'disable') {
                config.enabled = false;
            } else {
                await sock.sendMessage(
                    chatId,
                    {
                        text: '❌ Invalid option! Use: .autotyping on/off',
                        ...channelInfo
                    },
                    { quoted: message }
                );
                return;
            }
        } else {
            config.enabled = !config.enabled;
        }

        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

        await sock.sendMessage(
            chatId,
            {
                text: `✅ Auto-typing has been ${config.enabled ? 'enabled' : 'disabled'}!`,
                ...channelInfo
            },
            { quoted: message }
        );
    } catch (error) {
        console.error('❌ Error in autotyping command:', error);
        await sock.sendMessage(
            chatId,
            {
                text: '❌ Error processing command!',
                ...channelInfo
            },
            { quoted: message }
        );
    }
}

// ================= STATUS =================

function isAutotypingEnabled() {
    try {
        return initConfig().enabled === true;
    } catch {
        return false;
    }
}

// ================= INFINITE AUTOTYPING =================

async function handleAutotypingForMessage(sock, chatId, userMessage) {
    if (!isAutotypingEnabled()) return false;
    if (!userMessage) return false;

    // Prevent multiple typing loops in same chat
    if (typingSessions.has(chatId)) return true;

    let active = true;
    typingSessions.set(chatId, () => { active = false; });

    try {
        await sock.presenceSubscribe(chatId);

        // Infinite typing loop
        while (active) {
            await sock.sendPresenceUpdate('composing', chatId);
            await delay(4500); // refresh before WhatsApp timeout
        }

        await sock.sendPresenceUpdate('paused', chatId);
        return true;

    } catch (error) {
        console.error('❌ Error sending infinite typing indicator:', error);
        return false;
    } finally {
        typingSessions.delete(chatId);
    }
}

// ================= STOP TYPING =================

function stopAutotyping(chatId) {
    if (typingSessions.has(chatId)) {
        typingSessions.get(chatId)();
        typingSessions.delete(chatId);
    }
}

// ================= OPTIONAL COMMAND TYPING =================

async function handleAutotypingForCommand(sock, chatId) {
    if (!isAutotypingEnabled()) return false;
    try {
        await sock.presenceSubscribe(chatId);
        await sock.sendPresenceUpdate('composing', chatId);
        await delay(3000);
        await sock.sendPresenceUpdate('paused', chatId);
        return true;
    } catch {
        return false;
    }
}

async function showTypingAfterCommand(sock, chatId) {
    if (!isAutotypingEnabled()) return false;
    try {
        await sock.sendPresenceUpdate('composing', chatId);
        await delay(1000);
        await sock.sendPresenceUpdate('paused', chatId);
        return true;
    } catch {
        return false;
    }
}

// ================= EXPORTS =================

module.exports = {
    autotypingCommand,
    isAutotypingEnabled,
    handleAutotypingForMessage,
    handleAutotypingForCommand,
    showTypingAfterCommand,
    stopAutotyping
};
