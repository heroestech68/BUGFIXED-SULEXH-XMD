// pair.js
// Simple uploader / pairing helper for BUGFIXED-SULEXH-TECH
// Accepts creds.json upload and writes into ./session (creates folder if missing).

const express = require('express')
const multer = require('multer')
const fs = require('fs')
const path = require('path')
const chalk = require('chalk')

// CONFIG
const PORT = process.env.PAIR_PORT || 3001
const SESSION_DIR = path.resolve(process.cwd(), 'session')
const ALLOWED_FILENAME = 'creds.json' // final name on disk

// Branding/help text (shown in web UI)
const BRANDING_MESSAGE = `
🟢 BUGFIXED-SULEXH-TECH
Your WhatsApp bot session file (creds.json) has been received and saved.
⚠️ Do NOT share this file with anyone. Keep it safe and upload it only to your bot container.
©2025 BUGFIXED-SULEXH-TECH
`

// Ensure session folder exists
if (!fs.existsSync(SESSION_DIR)) {
  fs.mkdirSync(SESSION_DIR, { recursive: true })
  console.log(chalk.green(`Created session folder: ${SESSION_DIR}`))
}

const app = express()

app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html')
  res.end(`
    <html>
      <head><meta charset="utf-8"/><title>BUGFIXED-SULEXH-TECH — Upload creds.json</title></head>
      <body style="font-family: Arial; padding: 20px;">
        <h3>BUGFIXED-SULEXH-TECH — Upload creds.json</h3>
        <pre>${BRANDING_MESSAGE}</pre>
        <p>Upload <code>creds.json</code> (from the pairing site) — it will be saved to <code>./session/creds.json</code>.</p>
        <form action="/upload" enctype="multipart/form-data" method="post">
          <input type="file" name="file" accept=".json" required />
          <button type="submit">Upload creds.json</button>
        </form>
        <hr/>
        <p>Panels can POST here: <code>POST /upload</code> (field name: <code>file</code>)</p>
      </body>
    </html>
  `)
})

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } })

app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).send('No file uploaded (field name must be "file").')

    const originalName = (req.file.originalname || '').toLowerCase()
    if (!originalName.endsWith('.json')) {
      return res.status(400).send('Only JSON files are accepted.')
    }

    // parse/validate JSON
    let parsed
    try { parsed = JSON.parse(req.file.buffer.toString('utf8')) }
    catch (err) { return res.status(400).send('Uploaded file is not valid JSON.') }

    const targetPath = path.join(SESSION_DIR, ALLOWED_FILENAME)
    const tmpPath = targetPath + '.tmp'

    await fs.promises.writeFile(tmpPath, JSON.stringify(parsed, null, 2), { encoding: 'utf8', mode: 0o600 })
    await fs.promises.rename(tmpPath, targetPath)

    console.log(chalk.green(`[pair.js] Saved creds to ${targetPath}`))
    console.log(chalk.green(BRANDING_MESSAGE))

    res.type('text').send('OK: creds.json saved. Bot will attempt to (re)connect automatically.')
  } catch (err) {
    console.error('Upload error:', err)
    res.status(500).send('Server error: ' + String(err.message || err))
  }
})

app.get('/status', (req, res) => {
  const exists = fs.existsSync(path.join(SESSION_DIR, ALLOWED_FILENAME))
  res.json({ ready: exists, sessionFile: exists ? ALLOWED_FILENAME : null, branding: 'BUGFIXED-SULEXH-TECH' })
})

app.get('/download', (req, res) => {
  const p = path.join(SESSION_DIR, ALLOWED_FILENAME)
  if (!fs.existsSync(p)) return res.status(404).send('No session file.')
  res.download(p)
})

app.listen(PORT, () => {
  console.log(chalk.blue(`[pair.js] Pairing uploader running on port ${PORT}`))
  console.log(chalk.blue(`[pair.js] Upload endpoint: POST http://<host>:${PORT}/upload (field name: file)`))
  console.log(chalk.green(BRANDING_MESSAGE))
})
