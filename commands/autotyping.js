/**
 * BUGFIXED-SULEXH-XMD - A WhatsApp Bot
 * Autotyping Command - Shows fake typing status
 */

const fs = require('fs');
const path = require('path');
const isOwnerOrSudo = require('../lib/isOwner');

// Path to store the configuration
const configPath = path.join(__dirname, '..', 'data', 'autotyping.json');

// Initialize configuration file if it doesn't exist
function initConfig() {
    if (!fs.existsSync(configPath)) {
        fs.writeFileSync(configPath, JSON.stringify({ enabled: false }, null, 2));
    }
    return JSON.parse(fs.readFileSync(configPath));
}

// Universal channel info
const channelInfo = {
    contextInfo: {
        newsletterJid: '0029VbAD3222f3EIZyXe6w16@broadcast',
        newsletterName: 'BUGFIXED-SULEXH-XMD',
        serverMessageId: -1
    }
};

// Toggle autotyping feature
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

        // Get command arguments
        const args =
            message.message?.conversation?.trim().split(' ').slice(1) ||
            message.message?.extendedTextMessage?.text?.trim().split(' ').slice(1) ||
            [];

        // Initialize or read config
        const config = initConfig();

        // Toggle logic
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
            // Toggle current state
            config.enabled = !config.enabled;
        }

        // Save updated configuration
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

        // Success message
        await sock.sendMessage(
            chatId,
            {
                text: `✅ Auto-typing has been ${config.enabled ? 'enabled' : 'disabled'}!`,
                ...channelInfo
            },
            { quoted: message }
        );
    } catch (error) {
        console.error('Error in autotyping command:', error);

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

// Check if enabled
function isAutotypingEnabled() {
    try {
        const config = initConfig();
        return config.enabled;
    } catch (error) {
        console.error('Error checking autotyping status:', error);
        return false;
    }
}

// Handle autotyping for normal messages
async function handleAutotypingForMessage(sock, chatId, userMessage) {
    if (isAutotypingEnabled()) {
        try {
            await sock.presenceSubscribe(chatId);

            await sock.sendPresenceUpdate('available', chatId);
            await new Promise(resolve => setTimeout(resolve, 500));

            await sock.sendPresenceUpdate('composing', chatId);

            const typingDelay = Math.max(3000, Math.min(8000, userMessage.length * 150));
            await new Promise(resolve => setTimeout(resolve, typingDelay));

            await sock.sendPresenceUpdate('composing', chatId);
            await new Promise(resolve => setTimeout(resolve, 1500));

            await sock.sendPresenceUpdate('paused', chatId);

            return true;
        } catch (error) {
            console.error('❌ Error sending typing indicator:', error);
            return false;
        }
    }
    return false;
}

// Handle autotyping before command (optional)
async function handleAutotypingForCommand(sock, chatId) {
    if (isAutotypingEnabled()) {
        try {
            await sock.presenceSubscribe(chatId);
            await sock.sendPresenceUpdate('available', chatId);
            await new Promise(resolve => setTimeout(resolve, 500));

            await sock.sendPresenceUpdate('composing', chatId);
            await new Promise(resolve => setTimeout(resolve, 3000));

            await sock.sendPresenceUpdate('composing', chatId);
            await new Promise(resolve => setTimeout(resolve, 1500));

            await sock.sendPresenceUpdate('paused', chatId);

            return true;
        } catch (error) {
            console.error('❌ Error sending command typing indicator:', error);
            return false;
        }
    }
    return false;
}

// Typing AFTER command
async function showTypingAfterCommand(sock, chatId) {
    if (isAutotypingEnabled()) {
        try {
            await sock.presenceSubscribe(chatId);

            await sock.sendPresenceUpdate('composing', chatId);
            await new Promise(resolve => setTimeout(resolve, 1000));

            await sock.sendPresenceUpdate('paused', chatId);

            return true;
        } catch (error) {
            console.error('❌ Error sending post-command typing indicator:', error);
            return false;
        }
    }
    return false;
}

module.exports = {
    autotypingCommand,
    isAutotypingEnabled,
    handleAutotypingForMessage,
    handleAutotypingForCommand,
    showTypingAfterCommand
};
