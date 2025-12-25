/**
 * BUGFIXED-SULEXH-XMD - A WhatsApp Bot
 * AutoRecording Command - INFINITE realistic recording indicator
 */

const fs = require('fs');
const path = require('path');
const isOwnerOrSudo = require('../lib/isOwner');

// ================= CONFIG =================

const configPath = path.join(__dirname, '..', 'data', 'autorecording.json');

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

// Track active recording sessions per chat
const recordingSessions = new Map();

// Delay helper
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// ================= COMMAND =================

async function autorecordingCommand(sock, chatId, message) {
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
                        text: '❌ Invalid option! Use: .autorecording on/off',
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
                text: `✅ Auto-recording has been ${config.enabled ? 'enabled' : 'disabled'}!`,
                ...channelInfo
            },
            { quoted: message }
        );
    } catch (error) {
        console.error('❌ Error in autorecording command:', error);
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

function isAutorecordingEnabled() {
    try {
        return initConfig().enabled === true;
    } catch {
        return false;
    }
}

// ================= INFINITE RECORDING =================

async function handleAutorecordingForMessage(sock, chatId) {
    if (!isAutorecordingEnabled()) return false;

    // Prevent duplicate recording loops per chat
    if (recordingSessions.has(chatId)) return true;

    let active = true;
    recordingSessions.set(chatId, () => { active = false; });

    try {
        await sock.presenceSubscribe(chatId);

        // Infinite recording loop
        while (active) {
            await sock.sendPresenceUpdate('recording', chatId);
            await delay(4500); // must refresh or WhatsApp stops it
        }

        await sock.sendPresenceUpdate('paused', chatId);
        return true;

    } catch (error) {
        console.error('❌ Error sending recording indicator:', error);
        return false;
    } finally {
        recordingSessions.delete(chatId);
    }
}

// ================= STOP RECORDING =================

function stopAutorecording(chatId) {
    if (recordingSessions.has(chatId)) {
        recordingSessions.get(chatId)();
        recordingSessions.delete(chatId);
    }
}

// ================= OPTIONAL COMMAND RECORDING =================

async function handleAutorecordingForCommand(sock, chatId) {
    if (!isAutorecordingEnabled()) return false;
    try {
        await sock.presenceSubscribe(chatId);
        await sock.sendPresenceUpdate('recording', chatId);
        await delay(3000);
        await sock.sendPresenceUpdate('paused', chatId);
        return true;
    } catch {
        return false;
    }
}

// ================= EXPORTS =================

module.exports = {
    autorecordingCommand,
    isAutorecordingEnabled,
    handleAutorecordingForMessage,
    handleAutorecordingForCommand,
    stopAutorecording
};
