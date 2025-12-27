const axios = require('axios');

// 🔊 CHANGE THIS TO YOUR REAL HOST
// Example:
// https://cdn.jsdelivr.net/gh/USERNAME/REPO/quran/bukhatir
const AUDIO_BASE = 'https://your-server.com/quran/bukhatir';

const BRAND = 'BY SHEIKH SULEIMAN ALMAARUF\nBUGFIXED SULEXH';

module.exports = async function quranCommand(sock, chatId, message, args) {
  try {

    /* ===============================
       HANDLE REPLY TO QURAN MENU
    ================================ */
    if (
      message.message?.extendedTextMessage?.contextInfo?.quotedMessage?.conversation &&
      message.message.extendedTextMessage.contextInfo.quotedMessage.conversation.includes('📖 QURAN MENU')
    ) {
      const replyText = message.message.extendedTextMessage.text.trim();
      args = replyText.split(/\s+/);
    }

    /* ===============================
       QURAN MENU
    ================================ */
    if (!args[0] || args[0].toLowerCase() === 'menu') {
      const res = await axios.get('https://api.alquran.cloud/v1/surah');

      let menu = '📖 QURAN MENU (Reply with number or range)\n\n';

      res.data.data.forEach(s => {
        menu += `${s.number}. ${s.englishName} (${s.name})\n`;
      });

      menu += `
Reply examples:
• 2
• 2 20-40
• audio 18

${BRAND}
`;

      await sock.sendMessage(chatId, { text: menu }, { quoted: message });
      return;
    }

    /* ===============================
       AUDIO (SALAH BUKHATIR)
    ================================ */
    if (args[0].toLowerCase() === 'audio' && args[1]) {
      const surahNum = parseInt(args[1]);

      if (isNaN(surahNum) || surahNum < 1 || surahNum > 114) {
        await sock.sendMessage(chatId, { text: '❌ Invalid surah number.' }, { quoted: message });
        return;
      }

      const surah = String(surahNum).padStart(3, '0');
      const audioUrl = `${AUDIO_BASE}/${surah}.mp3`;

      await sock.sendMessage(
        chatId,
        {
          audio: { url: audioUrl },
          mimetype: 'audio/mpeg',
          fileName: `Surah_${surah}_Salah_Bukhatir.mp3`,
          ptt: false
        },
        { quoted: message }
      );
      return;
    }

    /* ===============================
       SURAH / AYAH RANGE
    ================================ */
    const surah = parseInt(args[0]);

    if (isNaN(surah) || surah < 1 || surah > 114) {
      await sock.sendMessage(chatId, { text: '❌ Invalid surah number.' }, { quoted: message });
      return;
    }

    let start = 1;
    let end = 9999;

    if (args[1]) {
      const range = args[1].split('-');
      start = parseInt(range[0]) || 1;
      end = range[1] ? parseInt(range[1]) : start;
    }

    const res = await axios.get(
      `https://api.alquran.cloud/v1/surah/${surah}/editions/quran-uthmani,en.asad`
    );

    const arabicAyahs = res.data.data[0].ayahs;
    const englishAyahs = res.data.data[1].ayahs;

    let text = `📖 ${res.data.data[0].englishName}\n\n`;

    for (let i = start - 1; i < Math.min(end, arabicAyahs.length); i++) {
      text += `(${i + 1}) ${arabicAyahs[i].text}\n`;
      text += `${englishAyahs[i].text}\n\n`;
    }

    text += BRAND;

    await sock.sendMessage(chatId, { text }, { quoted: message });

  } catch (error) {
    console.error('QURAN COMMAND ERROR:', error);
    await sock.sendMessage(chatId, { text: '❌ Quran service error.' }, { quoted: message });
  }
};
