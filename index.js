/**
 * BUGFIXED-SULEXH-TECH — Final Index.js
 * Auto-pair, auto-reconnect, non-expiring session, safe handlers
 */

const fs = require("fs");
const chalk = require("chalk");
const pino = require("pino");
const { Boom } = require("@hapi/boom");
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
    jidDecode,
    jidNormalizedUser,
    makeCacheableSignalKeyStore,
    delay
} = require("@whiskeysockets/baileys");

const NodeCache = require("node-cache");

/* ---------------- INIT SESSION FOLDER ---------------- */
if (!fs.existsSync("./session")) fs.mkdirSync("./session");

/* ---------------- STORE AUTO SAVE ---------------- */
store.readFromFile();
setInterval(() => store.writeToFile(), settings.storeWriteInterval || 10000);

/* ---------------- RAM PROTECTION ---------------- */
setInterval(() => {
    const used = process.memoryUsage().rss / 1024 / 1024;
    if (used > 450) {
        console.log("⚠️ Memory too high, restarting...");
        process.exit(1);
    }
}, 30000);

/* ---------------- ACTIVITY WATCHDOG ---------------- */
let lastActivity = Date.now();
function touch() { lastActivity = Date.now(); }

/* ---------------- SINGLE START PROTECTOR ---------------- */
let starting = false;
async function safeStart() {
    if (starting) return;
    starting = true;
    try { await startBot(); }
    catch (e) { console.log("Start error:", e); }
    starting = false;
}

/* ---------------------- MAIN BOT ---------------------- */
async function startBot() {
    try {
        let { version } = await fetchLatestBaileysVersion();
        const { state, saveCreds } = await useMultiFileAuthState("./session");
        const cache = new NodeCache();

        const sock = makeWASocket({
            version,
            logger: pino({ level: "silent" }),
            printQRInTerminal: true, // IMPORTANT: this is your Katabump QR
            browser: ["BUGFIXED-SULEXH-TECH", "Chrome", "1.0"],
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }))
            },
            markOnlineOnConnect: true,
            generateHighQualityLinkPreview: true,
            syncFullHistory: false,
            getMessage: async (key) => {
                try {
                    let jid = jidNormalizedUser(key.remoteJid);
                    let msg = await store.loadMessage(jid, key.id);
                    return msg?.message || "";
                } catch {
                    return "";
                }
            },
            msgRetryCounterCache: cache,
            keepAliveIntervalMs: 10000
        });

        sock.ev.on("creds.update", saveCreds);
        store.bind(sock.ev);

        /* -------------- ACTIVITY TRACK -------------- */
        sock.ev.on("messages.upsert", () => touch());
        sock.ev.on("connection.update", () => touch());

        /* -------------- MESSAGE HANDLER -------------- */
        sock.ev.on("messages.upsert", async (update) => {
            let msg;
            try {
                msg = update.messages[0];
                if (!msg?.message) return;
                if (msg.key.remoteJid === "status@broadcast") return;

                // remove ephemeral wrapper
                if (msg.message.ephemeralMessage) {
                    msg.message = msg.message.ephemeralMessage.message;
                }

                await handleMessages(sock, update, true);
            } catch (err) {
                console.error("Message handler error:", err);
            }
        });

        /* -------------- GROUP PARTICIPANTS -------------- */
        sock.ev.on("group-participants.update", async (ev) => {
            await handleGroupParticipantUpdate(sock, ev).catch(() => {});
        });

        /* -------------- STATUS & REACT -------------- */
        sock.ev.on("status.update", async (s) => handleStatus(sock, s).catch(() => {}));
        sock.ev.on("messages.reaction", async (s) => handleStatus(sock, s).catch(() => {}));

        /* -------------- CONNECTION HANDLER -------------- */
        let attempts = 0;

        sock.ev.on("connection.update", async (u) => {
            const { connection, lastDisconnect, qr } = u;

            if (qr) console.log(chalk.yellow("📌 Scan QR in Katabump terminal"));

            if (connection === "open") {
                attempts = 0;
                console.log(chalk.green("✔ BOT CONNECTED SUCCESSFULLY ✔"));
            }

            if (connection === "close") {
                const code = new Boom(lastDisconnect?.error)?.output?.statusCode;

                if (code === DisconnectReason.loggedOut) {
                    console.log("❌ Logged out: session invalid.");
                    console.log("Scan QR again in Katabump.");
                    return safeStart();
                }

                // retry backoff
                attempts++;
                const wait = Math.min(60, 2 ** attempts) * 1000;
                console.log(`⚠ Connection lost (${code}). Reconnecting in ${wait / 1000}s...`);

                await delay(wait);
                safeStart();
            }
        });

        /* -------------- HEARTBEAT PRESENCE -------------- */
        setInterval(() => {
            if (sock.user) sock.sendPresenceUpdate("available").catch(() => {});
        }, 20_000);

        /* -------------- WATCHDOG: restart if frozen -------------- */
        setInterval(() => {
            if (Date.now() - lastActivity > 300000) {
                console.log("⚠ Watchdog: inactivity detected, restarting...");
                safeStart();
            }
        }, 60000);

        /* -------------- RETURN SOCKET -------------- */
        return sock;
    } catch (err) {
        console.error("Fatal startBot error:", err);
        await delay(3000);
        safeStart();
    }
}

/* ---------------- START BOT ---------------- */
safeStart();

/* ---------------- CRASH HANDLERS ---------------- */
process.on("uncaughtException", () => safeStart());
process.on("unhandledRejection", () => safeStart());

/* ---------------- HOT RELOAD ---------------- */
let file = require.resolve(__filename);
fs.watchFile(file, () => {
    fs.unwatchFile(file);
    console.log("♻ Reloading index.js...");
    delete require.cache[file];
    require(file);
});
