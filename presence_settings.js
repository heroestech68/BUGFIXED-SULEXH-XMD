// =======================
// PROLONGED FAKE PRESENCE ENGINE
// =======================

let lastPresenceChat = null;
let lastPulse = 0;

function pickActiveChat() {
    const chats = Object.keys(store.chats || {});
    return chats.find(j =>
        j.endsWith('@s.whatsapp.net') || j.endsWith('@g.us')
    ) || null;
}

setInterval(async () => {
    try {
        const ps = presenceSettings.getPresenceSettings();
        const chatId = pickActiveChat();
        if (!chatId) return;

        const now = Date.now();

        // Avoid hammering same presence too fast
        if (now - lastPulse < 9000) return;
        lastPulse = now;
        lastPresenceChat = chatId;

        // 🔵 ALWAYS ONLINE
        if (ps.alwaysonline) {
            await XeonBotInc.sendPresenceUpdate('available', chatId);
            return;
        }

        // ✍️ PROLONGED TYPING
        if (ps.autotyping) {
            await XeonBotInc.sendPresenceUpdate('composing', chatId);
            return;
        }

        // 🎙️ PROLONGED RECORDING
        if (ps.autorecording) {
            await XeonBotInc.sendPresenceUpdate('recording', chatId);
            return;
        }

        // If all OFF → reset
        await XeonBotInc.sendPresenceUpdate('available', chatId);

    } catch {}
}, 10_000); // 👈 perfect keep-alive window
