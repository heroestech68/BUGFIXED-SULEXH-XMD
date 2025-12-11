/**
 * CLEAN – STABLE – NON-BRANDED
 * WhatsApp Bot (Baileys 6.x)
 * By Sulexh – Final Safe Version
 */

const fs = require("fs");
const chalk = require("chalk");
const pino = require("pino");
const NodeCache = require("node-cache");
const { Boom } = require("@hapi/boom");

const store = require("./lib/lightweight_store");
const settings = require("./settings");

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    jidNormalizedUser,
    makeCacheableSignalKeyStore,
    delay
} = require("@whiskeysockets/baileys");

store.readFromFile();
setInterval(() => store.writeToFile(), 10_000);

/* ======================= START BOT ======================= */

async function startBot() {
    try {
        const { version } = await fetchLatestBaileysVersion();
        const { state, saveCreds } = await useMultiFileAuthState("./session");

        const sock = makeWASocket({
            version,
            logger: pino({ level: "silent" }),
            browser: ["Sulexh-Bot", "Chrome", "1.0"],

            /* ---------------- SWITCH HERE ----------------
               true  = show QR in terminal
               false = ONLY pair code
            ------------------------------------------------*/
            printQRInTerminal: settings.useQR || false,

            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(
                    state.keys,
                    pino({ level: "fatal" })
                )
            }
        });

        sock.ev.on("creds.update", saveCreds);
        store.bind(sock.ev);

        /* ================= PAIRING CODE ================= */
        if (!sock.authState.creds.registered && !settings.useQR) {
            const number = settings.ownerNumber.replace(/[^0-9]/g, "");
            const code = await sock.requestPairingCode(number);
            console.log("\nPAIR CODE:", chalk.green(code), "\n");
        }

        /* ================= MESSAGE HANDLER ================= */
        sock.ev.on("messages.upsert", async (update) => {
            try {
                const msg = update.messages[0];
                if (!msg?.message) return;
                if (msg.key.remoteJid === "status@broadcast") return;
                if (msg.message?.ephemeralMessage)
                    msg.message = msg.message.ephemeralMessage.message;

                const { handleMessages } = require("./main");
                await handleMessages(sock, update, true);

            } catch (e) {
                console.log("Message error:", e);
            }
        });

        /* ================= CONNECTION CONTROL ================= */
        sock.ev.on("connection.update", async (u) => {
            const { connection, lastDisconnect } = u;

            if (connection === "open") {
                console.log(chalk.green("\n✔ Bot Connected ✔\n"));
            }

            if (connection === "close") {
                const code = new Boom(lastDisconnect.error).output.statusCode;

                if (code === DisconnectReason.loggedOut) {
                    console.log("Session Expired → Need new link");
                    return startBot();
                }

                console.log("Reconnecting...");
                await delay(2500);
                startBot();
            }
        });

        return sock;

    } catch (err) {
        console.log("Fatal Error:", err);
        await delay(3000);
        startBot();
    }
}

startBot();
