const axios = require('axios');
const fetch = require('node-fetch');

async function aiCommand(sock, chatId, message) {
    try {
        const text =
            message.message?.conversation ||
            message.message?.extendedTextMessage?.text ||
            "";

        if (!text) {
            return await sock.sendMessage(
                chatId,
                {
                    text: "Please provide a question after .gpt or .gemini\n\nExample: .gpt write a basic html code"
                },
                { quoted: message }
            );
        }

        // Split command and query
        const parts = text.trim().split(" ");
        const command = parts[0].toLowerCase();
        const query = parts.slice(1).join(" ").trim();

        if (!query) {
            return await sock.sendMessage(
                chatId,
                { text: "Please provide a question after .gpt or .gemini" },
                { quoted: message }
            );
        }

        // React while processing
        await sock.sendMessage(chatId, {
            react: { text: "🤖", key: message.key }
        });

        if (command === ".gpt") {
            // GPT API
            const response = await axios.get(
                `https://zellapi.autos/ai/chatbot?text=${encodeURIComponent(query)}`
            );

            if (response.data?.status && response.data?.result) {
                await sock.sendMessage(
                    chatId,
                    { text: response.data.result },
                    { quoted: message }
                );
            } else {
                throw new Error("Invalid GPT API response");
            }

        } else if (command === ".gemini") {
            // Gemini API fallback chain
            const apis = [
                `https://vapis.my.id/api/gemini?q=${encodeURIComponent(query)}`,
                `https://api.siputzx.my.id/api/ai/gemini-pro?content=${encodeURIComponent(query)}`,
                `https://api.ryzendesu.vip/api/ai/gemini?text=${encodeURIComponent(query)}`,
                `https://zellapi.autos/ai/chatbot?text=${encodeURIComponent(query)}`,
                `https://api.giftedtech.my.id/api/ai/geminiai?apikey=gifted&q=${encodeURIComponent(query)}`,
                `https://api.giftedtech.my.id/api/ai/geminiaipro?apikey=gifted&q=${encodeURIComponent(query)}`
            ];

            for (const api of apis) {
                try {
                    const response = await fetch(api);
                    const data = await response.json();

                    const answer =
                        data.message ||
                        data.data ||
                        data.answer ||
                        data.result;

                    if (answer) {
                        await sock.sendMessage(
                            chatId,
                            { text: answer },
                            { quoted: message }
                        );
                        return; // stop after first success
                    }
                } catch (e) {
                    continue; // try next API
                }
            }

            // All APIs failed
            throw new Error("All Gemini APIs failed");
        }

    } catch (error) {
        console.error("AI Command Error:", error);

        await sock.sendMessage(
            chatId,
            {
                text: "❌ An error occurred. Please try again later.",
                contextInfo: {
                    mentionedJid: [
                        message.key?.participant || message.key?.remoteJid
                    ],
                    quotedMessage: message.message
                }
            },
            { quoted: message }
        );
    }
}

module.exports = aiCommand;
