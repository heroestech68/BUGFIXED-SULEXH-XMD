/**
 * BUGFIXED-SULEXH-XMD - AlwaysOffline Command
 */

const fs = require('fs');
const path = require('path');
const isOwnerOrSudo = require('../lib/isOwner');

// Path to store configuration
const configPath = path.join(__dirname, '..', 'data', 'alwaysoffline.json');

// Initialize config file
function initConfig() {
    if (!fs.existsSync(configPath)) {
        fs.writeFileSync(configPath, JSON.stringify({ enabled: false }, null, 2));
    }
    return JSON.parse(fs.readFileSync(configPath));
}

// Toggle AlwaysOffline
async function alwaysofflineCommand(sock, chatId, message) {
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
                    text: '❌ Invalid option! Use: .alwaysoffline on/off',
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
            text: `✅ AlwaysOffline has been ${config.enabled ? 'enabled' : 'disabled'}!`,
            contextInfo: {
                newsletterJid: '0029VbAD3222f3EIZyXe6w16@broadcast',
                newsletterName: 'BUGFIXED-SULEXH-XMD',
                serverMessageId: -1
            }
        });

    } catch (error) {
        console.error('Error in alwaysoffline command:', error);
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

// Check if AlwaysOffline enabled
function isAlwaysOfflineEnabled() {
    try {
        const config = initConfig();
        return config.enabled;
    } catch (error) {
        return false;
    }
}

// Handle AlwaysOffline logic
async function handleAlwaysOffline(sock, message) {
    if (!isAlwaysOfflineEnabled()) return false;

    const jid = message.key.remoteJid;
    const isGroup = jid.endsWith('@g.us');

    // Suppress receipts in DMs only
    if (!isGroup) {
        return true; // skip sending read/delivery receipts
    }

    // Groups: normal receipts
    try {
        await sock.sendReadReceipt(
            jid,
            message.key.participant || jid,
            [message.key.id]
        );
    } catch (err) {
        console.error('AlwaysOffline group receipt error:', err);
    }

    return true;
}

module.exports = {
    alwaysofflineCommand,
    isAlwaysOfflineEnabled,
    handleAlwaysOffline
};
