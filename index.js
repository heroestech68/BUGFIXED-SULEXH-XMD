/**
 * Cleaned index.js — BUGFIXED-SULEXH-TECH
 * - settings declared early (fixes ReferenceError)
 * - Removed branded forwarded message on connect
 * - Keeps QR / pair-code printing if enabled
 * - Auto-reconnect logic kept (no auto-delete of session)
 */

const fs = require('fs')
const path = require('path')
const chalk = require('chalk')
const pino = require('pino')
const readline = require('readline')
const { rmSync } = require('fs')
const NodeCache = require('node-cache')

/* ---------- config & helpers (must come before usage) ---------- */
const settings = require('./settings')                // <-- moved here (fixes "settings is not defined")
const store = require('./lib/lightweight_store')      // lightweight store (read/write)
const { handleMessages, handleGroupParticipantUpdate, handleStatus } = require('./main')

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  jidDecode,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  delay
} = require('@whiskeysockets/baileys')

/* ---------- persistent store init ---------- */
store.readFromFile()
setInterval(() => store.writeToFile(), settings.storeWriteInterval || 10000)

/* ---------- memory / watchdog safeguards (optional) ---------- */
setInterval(() => { if (global.gc) global.gc() }, 60_000)
