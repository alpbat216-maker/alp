// server.js
// Basit Express sunucusu: / serve form, /auth ve /oauth2callback Google OAuth, /upload ffmpeg ile hızlandırma
// Önce ffmpeg-setup'i require et (ffmpeg binary'lerini fluent-ffmpeg'e bildirir)
console.log('SERVER_JS_START: server.js loading');
console.log('SERVER_JS_START: server.js loading'); require('./ffmpeg-setup');
require('./ffmpeg-setup');

const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 3000;
const SERVER_ROOT_URL = process.env.SERVER_ROOT_URL || 'http://localhost:3000';
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.warn('WARNING: GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set in env');
}

// semplice upload dizini
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

// multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const base = Date.now() + '-' + file.originalname.replace(/\s+/g, '_');
    cb(null, base);
  }
});
const upload = multer({ storage });

// basit HTML form
app.get('/', (req, res) => {
  res.send(`
    <h1>SpeedUp Uploader (minimal)</h1>
    <p>1) Eğer YouTube yetkilendirmesi yoksa <a href="/auth">/auth</a> üzerinden yetkilendir.</p>
    <form method="POST" action="/upload" enctype="multipart/form-data">
      Audio (mp3): <input type="file" name="audio" accept="audio/*" required><br>
      Speed (ör. 1.25): <input type="text" name="speed" value="1.25"><br>
      <button type="submit">Upload & Process</button>
    </form>
  `);
});

// OAuth2 client helper
function createOAuthClient(redirectPath = '/oauth2callback') {
  return new google.auth.OAuth2(
    CLIENT_ID,
    CLIENT_SECRET,
    `${SERVER_ROOT_URL}${redirectPath}`
  );
}

// /auth: authorization URL göster / redirect
app.get('/auth', (req, res) => {
  const oauth2Client = createOAuthClient();
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/youtube.upload',
      'profile',
      'email'
    ],
    prompt: 'consent'
  });
  // doğrudan redirect et veya link göster
  res.send(`<p><a href="${url}">Open Google consent screen</a></p>`);
});

// /oauth2callback: Google döndürdü, code'u alıp token al ve kaydet
app.get('/oauth2callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send('Missing code');
  try {
    const oauth2Client = createOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    // tokens.json olarak kaydet
    fs.writeFileSync(path.join(__dirname, 'tokens.json'), JSON.stringify(tokens, null, 2));
    console.log('Auth successful — tokens saved.');
    res.send('Auth successful — tokens saved. You can close this tab.');
  } catch (err) {
    console.error('Error exchanging code for token:', err);
    res.status(500).send('Token exchange failed: ' + (err.message || err));
  }
});

// helper: atempo filtre zinciri oluştur (ffmpeg atempo 0.5-2.0 aralığında)
function atempoFiltersForSpeed(speed) {
  const filters = [];
  let s = Number(speed) || 1;
  if (s <= 0) s = 1;
  // reduce or increase by factors between 0.5 and 2 using chaining
  // while s > 2, apply atempo=2 then divide, etc.
  while (s > 2.0) {
    filters.push('atempo=2.0');
    s = s / 2.0;
  }
  while (s < 0.5) {
    filters.push('atempo=0.5');
    s = s / 0.5;
  }
  // final remainder (between 0.5 and 2.0)
  filters.push(`atempo=${s.toFixed(6)}`);
  return filters;
}

// /upload: audio al, hız değiştir, processed dosyayı indirilebilir yap
app.post('/upload', upload.single('audio'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const speed = parseFloat(req.body.speed || '1.0') || 1.0;
  const inputPath = req.file.path;
  const outName = path.basename(req.file.filename, path.extname(req.file.filename)) + `-speed-${speed}.mp3`;
  const outputPath = path.join(UPLOAD_DIR, outName);

  const filters = atempoFiltersForSpeed(speed); // array of 'atempo=...'

  console.log('Processing audio:', inputPath, 'speed:', speed, 'filters:', filters);

  // ffmpeg işlem
  ffmpeg(inputPath)
    .noVideo()
    .audioFilters(filters)
    .audioCodec('libmp3lame')
    .format('mp3')
    .on('start', cmd => console.log('ffmpeg start:', cmd))
    .on('error', (err, stdout, stderr) => {
      console.error('ffmpeg error:', err && err.message);
      console.error('ffmpeg stderr:', stderr);
      res.status(500).json({ error: err && err.message, details: stderr });
    })
    .on('end', () => {
      console.log('Processing finished:', outputPath);
      // İndirilebilir link veya dosyayı direkt gönder
      res.download(outputPath, outName, err => {
        if (err) console.error('Send file error:', err);
        // cleanup: istersen input ve output'u kaldırabilirsin
        // fs.unlinkSync(inputPath);
        // fs.unlinkSync(outputPath);
      });
    })
    .save(outputPath);
});

// Basit health
app.get('/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Visit /auth to authorize YouTube uploads`);
});
