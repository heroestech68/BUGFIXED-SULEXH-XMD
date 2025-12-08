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
const ALLOWED_FILENAME = 'creds.json' // change if your panel sends a different name

// Branding message shown on the web UI and in logs
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

// Simple HTML form for manual uploads
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html')
  res.end(`
    <html>
      <head>
        <title>BUGFIXED-SULEXH-TECH — Upload creds.json</title>
        <meta charset="utf-8" />
      </head>
      <body style="font-family: Arial; padding: 24px;">
        <h2>BUGFIXED-SULEXH-TECH — Upload creds.json</h2>
        <pre>${BRANDING_MESSAGE}</pre>
        <p>Upload the <code>creds.json</code> file produced by the pairing site here to automatically save it into the bot's <code>./session</code> folder.</p>
        <form action="/upload" enctype="multipart/form-data" method="post">
          <input type="file" name="file" accept=".json" required />
          <button type="submit">Upload creds.json</button>
        </form>
        <hr/>
        <p>If your panel can POST files after pairing, configure it to POST to <strong>/upload</strong> on this host.</p>
      </body>
    </html>
  `)
})

// Multer setup (store in memory then write with safe rename)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } })

// Upload endpoint (used by panel or manual form)
app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).send('No file uploaded (field name must be "file").')

    const originalName = (req.file.originalname || '').toLowerCase()
    // Accept either creds.json or any json but we will save as creds.json
    if (!originalName.endsWith('.json')) {
      return res.status(400).send('Only JSON files are accepted.')
    }

    // Validate basic JSON
    let parsed
    try {
      parsed = JSON.parse(req.file.buffer.toString('utf8'))
    } catch (err) {
      return res.status(400).send('Uploaded file is not valid JSON.')
    }

    const targetPath = path.join(SESSION_DIR, ALLOWED_FILENAME)
    const tmpPath = targetPath + '.tmp'

    // Write to tmp file first then rename for atomic replace
    await fs.promises.writeFile(tmpPath, JSON.stringify(parsed, null, 2), { encoding: 'utf8', mode: 0o600 })
    await fs.promises.rename(tmpPath, targetPath)

    console.log(chalk.green(`[pair.js] Saved creds to ${targetPath}`))
    console.log(chalk.green(BRANDING_MESSAGE))

    res.type('text').send('OK: creds.json saved. Restart/refresh your bot if needed.')
  } catch (err) {
    console.error('Upload error:', err)
    res.status(500).send('Server error: ' + String(err.message || err))
  }
})

// Simple health/status endpoint
app.get('/status', (req, res) => {
  const exists = fs.existsSync(path.join(SESSION_DIR, ALLOWED_FILENAME))
  res.json({ ready: exists, sessionFile: exists ? ALLOWED_FILENAME : null, branding: 'BUGFIXED-SULEXH-TECH' })
})

// For convenience: allow GET /download to retrieve current creds (ONLY if you need it; remove in public deployments)
app.get('/download', (req, res) => {
  const p = path.join(SESSION_DIR, ALLOWED_FILENAME)
  if (!fs.existsSync(p)) return res.status(404).send('No session file.')
  res.download(p)
})

// Start server
app.listen(PORT, () => {
  console.log(chalk.blue(`[pair.js] Pairing uploader running on port ${PORT}`))
  console.log(chalk.blue(`[pair.js] Upload endpoint: POST http://<host>:${PORT}/upload (field name: file)`))
  console.log(chalk.green(BRANDING_MESSAGE))
})
