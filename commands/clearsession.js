const fs = require('fs');
const path = require('path');
const isOwnerOrSudo = require('../lib/isOwner');

// FIXED channelInfo — corrected structure + updated JID + name
const channelInfo = {
    contextInfo: {
        newsletterJid: '0029VbAD3222f3EIZyXe6w16@newsletter',
        newsletterName: 'BUGFIXED-SULEXH-TECH',
        serverMessageId: -1
    }
};

async function clearSessionCommand(sock, chatId, msg) {
    try {
        const senderId = msg.key.participant || msg.key.remoteJid;
        const isOwner = await isOwnerOrSudo(senderId, sock, chatId);

        if (!msg.key.fromMe && !isOwner) {
            await sock.sendMessage(chatId, {
                text: '❌ This command can only be used by the owner!',
                ...channelInfo
            });
            return;
        }

        const sessionDir = path.join(__dirname, '../session');

        if (!fs.existsSync(sessionDir)) {
            await sock.sendMessage(chatId, {
                text: '❌ Session directory not found!',
                ...channelInfo
            });
            return;
        }

        let filesCleared = 0;
        let errors = 0;
        let errorDetails = [];

        await sock.sendMessage(chatId, {
            text: `🔍 Optimizing session files for better performance...`,
            ...channelInfo
        });

        const files = fs.readdirSync(sessionDir);

        let appStateSyncCount = 0;
        let preKeyCount = 0;

        for (const file of files) {
            if (file.startsWith('app-state-sync-')) appStateSyncCount++;
            if (file.startsWith('pre-key-')) preKeyCount++;
        }

        for (const file of files) {
            if (file === 'creds.json') continue;

            try {
                const filePath = path.join(sessionDir, file);
                fs.unlinkSync(filePath);
                filesCleared++;
            } catch (err) {
                errors++;
                errorDetails.push(`❌ Failed to delete ${file}: ${err.message}`);
            }
        }

        const message =
            `✅ **Session cleanup completed!**\n\n` +
            `📊 **Statistics:**\n` +
            `• Files cleared: *${filesCleared}*\n` +
            `• App-state files: *${appStateSyncCount}*\n` +
            `• Pre-key files: *${preKeyCount}*\n\n` +
            (errors > 0 ? `⚠️ **Errors:**\n${errorDetails.join('\n')}` : '');

        await sock.sendMessage(chatId, {
            text: message,
            ...channelInfo
        });

    } catch (error) {
        console.error('Error in clearsession command:', error);

        await sock.sendMessage(chatId, {
            text: '❌ Failed to clear session files!',
            ...channelInfo
        });
    }
}

module.exports = clearSessionCommand;
