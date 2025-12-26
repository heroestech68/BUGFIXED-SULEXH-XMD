const fetch = require('node-fetch');

async function quranCommand(sock, chatId, message) {
    try {
        // Extract message text
        const text = message.message?.conversation || message.message?.extendedTextMessage?.text || '';
        const args = text.trim().split(/\s+/);

        if (args.length < 3) {
            await sock.sendMessage(chatId, { text: 'Usage: .quran <surah_number> <ayah_number or start-end>\nExample: .quran 2 255-257' }, { quoted: message });
            return;
        }

        const surah = parseInt(args[1], 10);
        if (isNaN(surah) || surah < 1 || surah > 114) {
            await sock.sendMessage(chatId, { text: '❌ Surah must be between 1 and 114.' }, { quoted: message });
            return;
        }

        let ayahRange = args[2].split('-');
        let startAyah = parseInt(ayahRange[0], 10);
        let endAyah = ayahRange[1] ? parseInt(ayahRange[1], 10) : startAyah;

        if (isNaN(startAyah) || isNaN(endAyah) || startAyah > endAyah) {
            await sock.sendMessage(chatId, { text: '❌ Invalid ayah range.' }, { quoted: message });
            return;
        }

        // Limit range to avoid huge messages
        if (endAyah - startAyah > 10) {
            await sock.sendMessage(chatId, { text: '❌ Maximum range is 10 ayahs at a time.' }, { quoted: message });
            return;
        }

        let fullText = `📖 Surah ${surah} Ayahs ${startAyah}-${endAyah}:\n\n`;

        // Fetch each ayah in range
        for (let ayah = startAyah; ayah <= endAyah; ayah++) {
            const response = await fetch(`https://api.alquran.cloud/v1/ayah/${surah}:${ayah}/en.asad`);
            const data = await response.json();
            if (data.code !== 200 || !data.data) {
                fullText += `❌ Ayah ${ayah} not found.\n`;
                continue;
            }
            fullText += `🕋 ${data.data.text}\n\n`;
        }

        // Send the compiled message
        await sock.sendMessage(chatId, { text: fullText.trim() }, { quoted: message });

    } catch (err) {
        console.error('❌ Error in Quran command:', err);
        await sock.sendMessage(chatId, { text: 'An error occurred while fetching the ayah(s).' }, { quoted: message });
    }
}

module.exports = quranCommand;
