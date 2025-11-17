// Simple Express server to serve the static site and perform Spotify token exchange
// Usage: set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET and run `node server.js`

// Load .env and report whether it parsed successfully (helps debug env issues)
const dotenvRes = require('dotenv').config();
if (dotenvRes.error) {
  console.warn('dotenv: no .env file loaded or parse error:', dotenvRes.error.message || dotenvRes.error);
} else {
  console.log('dotenv: parsed .env with keys:', Object.keys(dotenvRes.parsed || {}).join(', '));
  // Extra diagnostic: read raw .env bytes and report encoding hints
  try {
    const fs = require('fs');
    const envPath = require('path').join(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      const buf = fs.readFileSync(envPath);
      const head = buf.slice(0, 8);
      const hex = Array.from(head).map(b => b.toString(16).padStart(2, '0')).join(' ');
      console.log('.env raw bytes (first 8):', hex);
      // Detect common BOMs
      if (buf[0] === 0xff && buf[1] === 0xfe) {
        console.warn('.env file appears to be UTF-16 LE (starts with 0xFF 0xFE). Convert it to UTF-8 without BOM.');
      } else if (buf[0] === 0xfe && buf[1] === 0xff) {
        console.warn('.env file appears to be UTF-16 BE (starts with 0xFE 0xFF). Convert it to UTF-8 without BOM.');
      } else if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
        console.log('.env file has UTF-8 BOM (0xEF 0xBB 0xBF) — that is usually okay.');
      }
      // Show masked lines to confirm keys exist (hide values)
      const content = buf.toString('utf8');
      const lines = content.split(/\r?\n/).filter(Boolean).slice(0, 10);
      const masked = lines.map(l => l.replace(/^(\s*[A-Za-z0-9_]+)=(.*)$/, (m, k) => `${k}=***`));
      console.log('.env (first lines masked):', masked.join(' | '));
    }
  } catch (e) {
    console.warn('Failed to read .env for diagnostics:', e && e.message ? e.message : e);
  }
}
const express = require('express');
const path = require('path');
const axios = require('axios');
const app = express();

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const PORT = process.env.PORT || 3000;

// Show current working directory and whether credentials appear present
console.log('process.cwd():', process.cwd());
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.warn('Warning: SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET not set in env. Token exchange will fail until provided.');
} else {
  const masked = CLIENT_ID.slice(0, 6) + '...' + CLIENT_ID.slice(-4);
  console.log('SPOTIFY_CLIENT_ID appears set (masked):', masked);
}

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Provide a small config endpoint so the client can build an authorize URL base
app.get('/config', (req, res) => {
  // Build base authorize url (Spotify Accounts)
  // Use explicit loopback redirect by default to satisfy Spotify's requirements
  const redirect_uri = process.env.REDIRECT_URI || 'http://127.0.0.1:3000/';
  res.json({ authorize_url: 'https://accounts.spotify.com/authorize', redirect_uri });
});

// A helper endpoint that redirects the browser to Spotify's /authorize
// This server-side redirect includes the client_id so the client doesn't need it.
app.get('/login', (req, res) => {
  const redirect_uri = process.env.REDIRECT_URI || 'http://127.0.0.1:3000/';
  if (!CLIENT_ID) return res.status(500).send('Server missing SPOTIFY_CLIENT_ID');

  const scope = [
    'streaming',
    'user-read-email',
    'user-read-private',
    'user-read-playback-state',
    'user-top-read',
    'user-modify-playback-state',
    'user-read-currently-playing'
  ].join(' ');

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri,
    scope,
    show_dialog: 'true'
  });

  res.redirect('https://accounts.spotify.com/authorize?' + params.toString());
});

// Exchange authorization code for access token (server-side)
app.post('/api/exchange_token', async (req, res) => {
  const { code, redirect_uri } = req.body || {};
  if (!code) return res.status(400).json({ error: 'missing_code' });
  try {
    const params = new URLSearchParams();
    params.append('grant_type', 'authorization_code');
    params.append('code', code);
    params.append('redirect_uri', redirect_uri);
    params.append('client_id', CLIENT_ID);
    params.append('client_secret', CLIENT_SECRET);

    const tokenResp = await axios.post('https://accounts.spotify.com/api/token', params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    return res.json(tokenResp.data);
  } catch (err) {
    console.error('token exchange error', err.response?.data || err.message);
    return res.status(500).json({ error: 'token_exchange_failed', details: err.response?.data || err.message });
  }
});

app.listen(PORT, () => console.log(`Server started at http://localhost:${PORT}`));
