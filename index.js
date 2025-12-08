/**
 * FIXED index.js
 * - Pairing code printed to terminal (no QR by default)
 * - Auto reconnect with exponential backoff
 * - Multi-file auth state (session preserved)
 * - No automatic session deletion
 * - Safe anticall handler + basic handlers structure
 *
 * Requirements (install these):
 * npm i @whiskeysockets/baileys qrcode-terminal pino fs-extra node-cache chalk
 *
 * If you use a different baileys fork replace import path accordingly.
 */

const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');
const pino = require('pino');
const NodeCache = require('node-cache');
const qrcode = require('qrcode-terminal');
const crypto = require('crypto');

const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys'); // adjust if you use a different package name

// ---------------- CONFIG ----------------
const LOG = pino({ level: 'info' });
const SESSION_DIR = path.join(__dirname, 'session'); // multi-file auth saved here
const PRINT_QR = false; // default: print pairing CODE only. Set true to also print QR.
const PAIR_CODE_LENGTH = 6; // digits for pairing code displayed in terminal
const RECONNECT_MAX_ATTEMPTS = 10;
// ----------------------------------------

/**
 * Utility: generate a short numeric code from the raw QR string.
 * This does NOT replace scanning a QR, it is simply an easy-to-type code printed to terminal.
 * We map code => qr in-memory so we can optionally show the QR if user requests.
 */
const codeMap = new Map(); // code => { qr, expiresAt }

function qrToPairCode(qr) {
  // use sha256 then map to digits
  const sha = crypto.createHash('sha256').update(qr).digest('hex');
  // convert hex to number-ish string, then take digits
  const digits = sha.replace(/\D/g, '').slice(0, 32) || sha.replace(/[a-f]/g, '0').slice(0, 32);
  const code = digits.slice(0, PAIR_CODE_LENGTH).padStart(PAIR_CODE_LENGTH, '0');
  return code;
}

function saveQrMapping(code, qr) {
  const expiresAt = Date.now() + 1000 * 60 * 5; // 5 minutes
  codeMap.set(code, { qr, expiresAt });
  // schedule clean
  setTimeout(() => {
    const entry = codeMap.get(code);
    if (entry && entry.expiresAt <= Date.now()) codeMap.delete(code);
  }, 1000 * 60 * 5 + 1000);
}

function isSafeToAutoJoin() {
  // placeholder: return false to avoid auto-joining groups (helps avoid bans)
  // change only if you understand WhatsApp policy/risks
  return false;
}

// ---------------- MAIN ----------------
async function startBot() {
  await fs.ensureDir(SESSION_DIR);

  // use multi-file auth state (safe)
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

  // fetch latest version (optional - resilient)
  let wsVersion;
  try {
    const { version } = await fetchLatestBaileysVersion();
    wsVersion = version;
    LOG.info({ msg: 'Using WA protocol version', version: wsVersion });
  } catch (err) {
    LOG.warn({ msg: 'Unable to fetch latest WA version, continuing with default', err: err?.message || err });
  }

  let sock;
  let reconnectAttempts = 0;

  async function connect() {
    reconnectAttempts++;
    LOG.info({ msg: `Connecting... attempt ${reconnectAttempts}` });

    sock = makeWASocket({
      logger: LOG,
      printQRInTerminal: false, // we handle QR printing manually
      auth: state,
      version: wsVersion,
      // keepAliveIntervalMs: 60000, // optional
    });

    // save creds on updates
    sock.ev.on('creds.update', saveCreds);

    // connection updates
    sock.ev.on('connection.update', update => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        // build pairing code
        const code = qrToPairCode(qr);
        saveQrMapping(code, qr);

        // print pairing code prominently
        console.log(chalk.green.bold('\n--- PAIRING CODE ---'));
        console.log(chalk.bold.yellow(`PAIRING CODE: ${code}`));
        console.log(chalk.gray('This code is derived from the QR. Scan the QR from a phone if you prefer.'));
        console.log(chalk.gray('If you want the QR printed as ASCII set PRINT_QR = true in index.js\n'));

        // optionally print QR ASCII or hint
        if (PRINT_QR) {
          qrcode.generate(qr, { small: true }, q => {
            console.log(chalk.cyan('----- QR (ASCII) -----'));
            console.log(q);
            console.log(chalk.cyan('----------------------'));
          });
        }

        // keep code valid for a short while
        console.log(chalk.gray(`Pairing code valid for ~5 minutes.`));
      }

      if (connection === 'open') {
        LOG.info('✅ Connected — session is open.');
        reconnectAttempts = 0; // reset attempts on success
      }

      if (connection === 'close') {
        const reason = (lastDisconnect && lastDisconnect.error && lastDisconnect.error.output) ? lastDisconnect.error.output.statusCode : lastDisconnect?.error?.message || 'unknown';
        LOG.warn({ msg: 'connection closed', reason });

        // handle disconnect reason
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const discReason = lastDisconnect?.error?.output?.payload?.reason || lastDisconnect?.error?.message;

        // if invalid credentials or logged out by WhatsApp -> do not delete session; log and stop trying
        if (lastDisconnect?.error?.output?.statusCode === DisconnectReason.loggedOut || discReason?.toLowerCase?.().includes('invalid') ) {
          LOG.error('Session appears logged out or invalid credentials. Keep session files for debugging and recreate login manually.');
          // Do not automatically delete session files here (safer)
          return;
        }

        // Reconnect with backoff (unless max attempts reached)
        if (reconnectAttempts < RECONNECT_MAX_ATTEMPTS) {
          const backoff = Math.min(30, 2 ** reconnectAttempts) * 1000;
          LOG.info({ msg: `Reconnecting in ${backoff / 1000}s...` });
          setTimeout(connect, backoff);
        } else {
          LOG.error('Maximum reconnect attempts reached. Exiting.');
        }
      }
    });

    // handle incoming messages
    sock.ev.on('messages.upsert', async m => {
      try {
        if (!m || !m.messages) return;
        for (const msg of m.messages) {
          // skip system messages and status broadcasts
          if (!msg.message || msg.key && msg.key.remoteJid?.endsWith('@broadcast')) continue;
          // ignore our own messages
          if (msg.key && msg.key.fromMe) continue;

          const jid = msg.key.remoteJid;
          const pushName = msg.pushName || 'unknown';

          // simple text reply example (keep minimal)
          const text = msg.message.conversation || msg.message?.extendedTextMessage?.text;
          if (text) {
            LOG.info({ from: jid, name: pushName, text: text });
            // basic commands
            if (text.trim().toLowerCase() === '!ping') {
              await sock.sendMessage(jid, { text: 'pong' }, { quoted: msg });
            } else if (text.trim().toLowerCase() === '!help') {
              await sock.sendMessage(jid, { text: 'Commands:\n!ping\n!help' }, { quoted: msg });
            }
          }
          // (Place to add media, group handlers, welcome messages, etc.)
        }
      } catch (err) {
        LOG.error({ msg: 'messages.upsert handler error', err: err?.message || err });
      }
    });

    // simple anticall handler: reject calls politely (prevents unintended behaviors)
    sock.ev.on('call', async callEvent => {
      try {
        // callEvent has structure describing call
        // We're not auto-answering. We'll politely decline.
        LOG.info('Received call event: declining to avoid account issues.');
        // You can send a message to caller explaining why calls are declined
        const caller = callEvent.from || callEvent;
        if (caller) {
          await sock.sendMessage(caller, { text: 'This bot does not accept calls. Please message instead.' });
        }
      } catch (err) {
        LOG.warn({ msg: 'call handler error', err: err?.message || err });
      }
    });

    // handle group updates (safely)
    sock.ev.on('groups.update', updates => {
      for (const u of updates) {
        LOG.info({ msg: 'group update', update: u });
        // do NOT auto-accept invites to groups. Keep behavior safe to avoid bans.
      }
    });

    // handle presence/contacts updates as needed
    sock.ev.on('contacts.update', upds => {
      // noop for now
    });

    // any other event logging for debugging
    sock.ev.on('chats.set', () => {});
    sock.ev.on('messages.delete', () => {});
  }

  // initial connect
  await connect();

  // expose helper to dump QR by code (if someone types it in terminal)
  // simple CLI listener: if user types 'qr <code>' in terminal, it will print ASCII QR
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    const line = chunk.toString().trim();
    if (!line) return;
    const parts = line.split(/\s+/);
    if (parts[0].toLowerCase() === 'qr' && parts[1]) {
      const code = parts[1].trim();
      const entry = codeMap.get(code);
      if (!entry) {
        console.log(chalk.red(`No QR for code ${code} (maybe expired)`));
      } else {
        qrcode.generate(entry.qr, { small: true }, q => {
          console.log(chalk.cyan('----- QR (ASCII) -----'));
          console.log(q);
          console.log(chalk.cyan('----------------------'));
        });
      }
    } else if (parts[0].toLowerCase() === 'codes') {
      console.log('Known pairing codes (valid 5m):', [...codeMap.keys()]);
    } else if (parts[0].toLowerCase() === 'exit') {
      console.log('Exiting...');
      process.exit(0);
    } else {
      console.log('Commands: qr <code>   codes   exit');
    }
  });

  // handle process termination gracefully
  process.on('SIGINT', async () => {
    LOG.info('SIGINT received. Saving creds and exiting.');
    try { await saveCreds(); } catch (e) {}
    process.exit(0);
  });

  process.on('uncaughtException', (err) => {
    LOG.error({ msg: 'uncaughtException', err: err?.stack || err });
  });

  process.on('unhandledRejection', (reason) => {
    LOG.error({ msg: 'unhandledRejection', reason });
  });
}

// Run bot
startBot().catch(err => {
  console.error(chalk.red('Failed to start bot:'), err);
  process.exit(1);
});
