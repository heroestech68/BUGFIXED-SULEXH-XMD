const fetch = require('node-fetch');

const MAX_AYAHS_PER_MESSAGE = 10; // max ayahs per WhatsApp message

// Full surah list for menu
const surahs = [
    "1. Al-Fatihah", "2. Al-Baqarah", "3. Al-Imran", "4. An-Nisa", "5. Al-Ma'idah",
    "6. Al-An'am", "7. Al-A'raf", "8. Al-Anfal", "9. At-Tawbah", "10. Yunus",
    "11. Hud", "12. Yusuf", "13. Ar-Ra'd", "14. Ibrahim", "15. Al-Hijr",
    "16. An-Nahl", "17. Al-Isra", "18. Al-Kahf", "19. Maryam", "20. Ta-Ha",
    "21. Al-Anbiya", "22. Al-Hajj", "23. Al-Mu'minun", "24. An-Nur", "25. Al-Furqan",
    "26. Ash-Shu'ara", "27. An-Naml", "28. Al-Qasas", "29. Al-Ankabut", "30. Ar-Rum",
    "31. Luqman", "32. As-Sajda", "33. Al-Ahzab", "34. Saba", "35. Fatir",
    "36. Ya-Sin", "37. As-Saffat", "38. Sad", "39. Az-Zumar", "40. Ghafir",
    "41. Fussilat", "42. Ash-Shura", "43. Az-Zukhruf", "44. Ad-Dukhan", "45. Al-Jathiya",
    "46. Al-Ahqaf", "47. Muhammad", "48. Al-Fath", "49. Al-Hujurat", "50. Qaf",
    "51. Adh-Dhariyat", "52. At-Tur", "53. An-Najm", "54. Al-Qamar", "55. Ar-Rahman",
    "56. Al-Waqia", "57. Al-Hadid", "58. Al-Mujadila", "59. Al-Hashr", "60. Al-Mumtahina",
    "61. As-Saff", "62. Al-Jumuah", "63. Al-Munafiqun", "64. At-Taghabun", "65. At-Talaq",
    "66. At-Tahrim", "67. Al-Mulk", "68. Al-Qalam", "69. Al-Haaqqa", "70. Al-Ma'arij",
    "71. Nuh", "72. Al-Jinn", "73. Al-Muzzammil", "74. Al-Muddaththir", "75. Al-Qiyama",
    "76. Al-Insan", "77. Al-Mursalat", "78. An-Naba", "79. An-Nazi'at", "80. Abasa",
    "81. At-Takwir", "82. Al-Infitar", "83. Al-Mutaffifin", "84. Al-Inshiqaq", "85. Al-Buruj",
    "86. At-Tariq", "87. Al-Ala", "88. Al-Ghashiya", "89. Al-Fajr", "90. Al-Balad",
    "91. Ash-Shams", "92. Al-Lail", "93. Ad-Duhaa", "94. Ash-Sharh", "95. At-Tin",
    "96. Al-Alaq", "97. Al-Qadr", "98. Al-Bayyina", "99. Az-Zalzalah", "100. Al-Adiyat",
    "101. Al-Qaria", "102. At-Takathur", "103. Al-Asr", "104. Al-Humaza", "105. Al-Fil",
    "106. Quraish", "107. Al-Maun", "108. Al-Kawthar", "109. Al-Kafirun", "110. An-Nasr",
    "111. Al-Masad", "112. Al-Ikhlas", "113. Al-Falaq", "114. An-Nas"
];

async function quranCommand(sock, chatId, message) {
    try {
        const text = message.message?.conversation || message.message?.extendedTextMessage?.text || '';
        const args = text.trim().split(/\s+/);

        // ✅ .quran → show surah list
        if (args.length === 1) {
            await sock.sendMessage(
                chatId,
                { text: `📖 Quran Surah List:\n\n${surahs.join('\n')}` },
                { quoted: message }
            );
            return;
        }

        // Handle menu
        if (args[1].toLowerCase() === 'menu') {
            await sock.sendMessage(
                chatId,
                { text: `📖 Quran Surah List:\n\n${surahs.join('\n')}` },
                { quoted: message }
            );
            return;
        }

        // Parse surah number
        const surah = parseInt(args[1], 10);
        if (isNaN(surah) || surah < 1 || surah > 114) {
            await sock.sendMessage(chatId, { text: '❌ Surah must be between 1 and 114.' }, { quoted: message });
            return;
        }

        // Parse ayah range (NO LIMITS)
        let startAyah = 1;
        let endAyah = 1;
        if (args[2]) {
            const ayahRange = args[2].split('-');
            startAyah = parseInt(ayahRange[0], 10);
            endAyah = ayahRange[1] ? parseInt(ayahRange[1], 10) : startAyah;

            if (isNaN(startAyah) || isNaN(endAyah)) {
                await sock.sendMessage(chatId, { text: '❌ Invalid ayah range.' }, { quoted: message });
                return;
            }

            // ✅ auto-fix reversed ranges instead of blocking
            if (startAyah > endAyah) {
                [startAyah, endAyah] = [endAyah, startAyah];
            }
        }

        // Paginate ayahs in chunks
        for (let i = startAyah; i <= endAyah; i += MAX_AYAHS_PER_MESSAGE) {
            const chunkStart = i;
            const chunkEnd = Math.min(i + MAX_AYAHS_PER_MESSAGE - 1, endAyah);
            let fullText = `📖 Surah ${surah} Ayahs ${chunkStart}-${chunkEnd}:\n\n`;

            for (let ayah = chunkStart; ayah <= chunkEnd; ayah++) {
                const arRes = await fetch(`https://api.alquran.cloud/v1/ayah/${surah}:${ayah}/ar.alafasy`);
                const enRes = await fetch(`https://api.alquran.cloud/v1/ayah/${surah}:${ayah}/en.asad`);
                const arData = await arRes.json();
                const enData = await enRes.json();

                if (!arData.data || !enData.data) {
                    fullText += `❌ Ayah ${ayah} not found.\n`;
                    continue;
                }

                fullText += `🕋 Ayah ${ayah}:\n🇸🇦 ${arData.data.text}\n🇬🇧 ${enData.data.text}\n\n`;
            }

            // Add branded footer
            fullText += '\n――――――――――――\n📖 BY SHEIKH SULEIMAN ALMAARUF\n🐾 BUGFIXED SULEXH';

            await sock.sendMessage(chatId, { text: fullText.trim() }, { quoted: message });
            await new Promise(r => setTimeout(r, 500));
        }

    } catch (err) {
        console.error('❌ Error in Quran command:', err);
        await sock.sendMessage(chatId, { text: 'An error occurred while fetching the ayah(s).' }, { quoted: message });
    }
}

module.exports = quranCommand;
