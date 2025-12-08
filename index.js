/**
 * BUGFIXED-SULEXH-TECH — Final Index.js (QR FIXED)
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
    jidNormalizedUser,
    makeCacheableSignalKeyStore,
    delay
} = require("@whiskeysockets/baileys");

const NodeCache = require("node-cache");
const qrcode = require("qrcode-terminal");

/* ---------------- INIT SESSION FOLDER ---------------- */
if (!fs.existsSync("./session")) fs.mkdirSync("./session");

/* ---------------- STORE LOAD/SAVE ---------------- */
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

/* ---------------- START PROTECTOR ---------------- */
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
            browser: ["BUGFIXED-SULEXH-TECH", "Chrome", "1.0"],
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }))
            },
            markOnlineOnConnect: true,
            generateHighQualityLinkPreview: true,
            syncFullHistory: false,
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
            try {
                let msg = update.messages[0];
                if (!msg?.message) return;
                if (msg.key.remoteJid === "status@broadcast") return;

                if (msg.message.ephemeralMessage)
                    msg.message = msg.message.ephemeralMessage.message;

                await handleMessages(sock, update, true);
            } catch (err) {
                console.error("Message handler error:", err);
            }
        });

        /* -------------- GROUP EVENTS -------------- */
        sock.ev.on("group-participants.update", async (ev) => {
            handleGroupParticipantUpdate(sock, ev).catch(() => {});
        });

        /* -------------- STATUS & REACTIONS -------------- */
        sock.ev.on("status.update", async (s) => handleStatus(sock, s).catch(() => {}));
        sock.ev.on("messages.reaction", async (s) => handleStatus(sock, s).catch(() => {}));

        /* -------------- CONNECTION HANDLER -------------- */
        let attempts = 0;

        sock.ev.on("connection.update", async (u) => {
            const { connection, lastDisconnect, qr } = u;

            // --- REAL WORKING QR PRINTING ---
            if (qr) {
                console.log(chalk.yellow("📌 Scan this QR below:"));
                qrcode.generate(qr, { small: true });
            }

            if (connection === "open") {
                attempts = 0;
                console.log(chalk.green("✔ BOT CONNECTED SUCCESSFULLY ✔"));
            }

            if (connection === "close") {
                const code = new Boom(lastDisconnect?.error)?.output?.statusCode;

                if (code === DisconnectReason.loggedOut) {
                    console.log("❌ Session expired, scan QR again.");
                    return safeStart();
                }

                attempts++;
                const wait = Math.min(60, 2 ** attempts) * 1000;
                console.log(`⚠ Reconnect in ${wait / 1000}s...`);
                await delay(wait);
                safeStart();
            }
        });

        /* -------------- ALWAYS ONLINE -------------- */
        setInterval(() => {
            if (sock.user)
                sock.sendPresenceUpdate("available").catch(() => {});
        }, 20000);

        /* -------------- WATCHDOG -------------- */
        setInterval(() => {
            if (Date.now() - lastActivity > 300000) {
                console.log("⚠ Watchdog: restarting...");
                safeStart();
            }
        }, 60000);

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
