/**
 * BUGFIXED-SULEXH-TECH — PAIR CODE VERSION
 * No QR | Auto Reconnect | Safe Session
 */

const fs = require("fs");
const chalk = require("chalk");
const pino = require("pino");
const { Boom } = require("@hapi/boom");
const NodeCache = require("node-cache");

const settings = require("./settings");
const store = require("./lib/lightweight_store");

const {
    handleMessages,
    handleGroupParticipantUpdate,
    handleStatus
} = require("./main");

const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    DisconnectReason,
    jidNormalizedUser,
    makeCacheableSignalKeyStore,
    delay
} = require("@whiskeysockets/baileys");

/* ---------------- INIT SESSION FOLDER ---------------- */
if (!fs.existsSync("./session")) fs.mkdirSync("./session");

store.readFromFile();
setInterval(() => store.writeToFile(), 10_000);

/* ---------------- START BOT ---------------- */
async function startBot() {
    try {
        const { version } = await fetchLatestBaileysVersion();
        const { state, saveCreds } = await useMultiFileAuthState("./session");

        const sock = makeWASocket({
            version,
            logger: pino({ level: "silent" }),
            printQRInTerminal: false, // ❌ NO QR!
            browser: ["BUGFIXED-SULEXH-TECH", "Chrome", "1.0"],
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

        /* ------------ PAIRING CODE HANDLER ------------ */
        if (!sock.authState.creds.registered) {
            const code = await sock.requestPairingCode(settings.ownerNumber);
            console.log("\n\n📌 *YOUR PAIRING CODE* (insert into WhatsApp Web):\n");
            console.log(chalk.greenBright(`👉 ${code}\n\n`));
        }

        /* ------------ MESSAGE HANDLER ------------ */
        sock.ev.on("messages.upsert", async (update) => {
            try {
                const msg = update.messages[0];
                if (!msg?.message) return;
                if (msg.key.remoteJid === "status@broadcast") return;

                if (msg.message?.ephemeralMessage)
                    msg.message = msg.message.ephemeralMessage.message;

                await handleMessages(sock, update, true);
            } catch (err) {
                console.log("message error:", err);
            }
        });

        /* ------------ GROUP UPDATES ------------ */
        sock.ev.on("group-participants.update", async (ev) => {
            handleGroupParticipantUpdate(sock, ev).catch(() => {});
        });

        /* ------------ STATUS ------------ */
        sock.ev.on("status.update", async (s) =>
            handleStatus(sock, s).catch(() => {})
        );

        /* ------------ CONNECTION MANAGEMENT ------------ */
        sock.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === "open") {
                console.log(chalk.green("✔ BOT CONNECTED SUCCESSFULLY ✔"));
            }

            if (connection === "close") {
                const code = new Boom(lastDisconnect.error).output.statusCode;
                if (code === DisconnectReason.loggedOut) {
                    console.log("❌ Session expired — need new pairing code");
                    return startBot();
                }

                console.log("⚠ Reconnecting...");
                await delay(3000);
                startBot();
            }
        });

        return sock;

    } catch (err) {
        console.log("Fatal error, restarting...", err);
        await delay(3000);
        startBot();
    }
}

/* ---------------- START ---------------- */
startBot();
