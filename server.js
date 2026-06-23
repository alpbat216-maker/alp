/**
 * Basic Node.js + Express server
 * - / -> static upload form (public/index.html)
 * - /upload -> receive mp3 + thumbnail + metadata, process speedup, build video
 * - /auth -> start Google OAuth flow
 * - /oauth2callback -> receive tokens and store refresh token
 * - /upload-to-youtube -> upload generated mp4 using stored refresh token
 *
 * NOTES:
 * - Requires ffmpeg installed and on PATH.
 * - For best audio quality use ffmpeg built with librubberband so ffmpeg supports the "rubberband" filter.
 * - Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SERVER_ROOT_URL in .env
 */

require('dotenv').config();
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const {google} = require('googleapis');
const open = require('open');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.static('public'));

const upload = multer({ dest: 'uploads/' });

const SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube'];

// OAuth2 client
const oAuth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  (process.env.SERVER_ROOT_URL || 'http://localhost:3000') + '/oauth2callback'
);

// simple token storage (demo). Replace with DB/secret store in production
const TOKEN_PATH = path.join(__dirname, 'tokens.json');
function saveTokens(tokens) {
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
}
function loadTokens() {
  if (fs.existsSync(TOKEN_PATH)) return JSON.parse(fs.readFileSync(TOKEN_PATH));
  return null;
}

// helper: check if ffmpeg has rubberband filter
function ffmpegHasRubberband(cb) {
  ffmpeg().getAvailableFilters((err, filters) => {
    if (err) return cb(false);
    cb(filters && filters.some(f => f === 'rubberband'));
  });
}

// Format title: ensure " // Speed Up" appended (avoid duplicates)
function formatTitle(inputTitle, artist, song) {
  let base;
  if (inputTitle && inputTitle.trim().length) base = inputTitle.trim();
  else if (artist || song) base = `${artist ? artist.trim() : ''}${artist && song ? ' - ' : ''}${song ? song.trim() : ''}`;
  else base = 'Speed Up Track';
  if (!/speed\s*up/i.test(base)) base += ' // Speed Up';
  return base;
}

// Generate description and hashtags from title
function buildDescriptionAndTags(title) {
  // Simple: use title words as hashtags (limit a few)
  const words = title.replace(/[^a-zA-Z0-9ığüşöçİĞÜŞÖÇ\s-]/g, '').split(/\s+/).filter(Boolean);
  const tags = [];
  for (let w of words) {
    w = w.replace(/^-+|-+$/g, '');
    if (w.length > 1 && tags.length < 8) tags.push('#' + w);
  }
  const description = `${title}\n\nMade with SpeedUp tool.\n\n${tags.join(' ')}`;
  return { description, tags };
}

app.get('/auth', (req, res) => {
  const url = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent'
  });
  // open in browser to help user
  open(url).catch(() => {});
  res.send(`Open this URL in a browser to authorize the app: <a href="${url}">${url}</a>`);
});

app.get('/oauth2callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send('Missing code');
  try {
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);
    saveTokens(tokens);
    res.send('Auth successful — tokens saved. You can close this tab.');
  } catch (err) {
    console.error(err);
    res.status(500).send('Auth failed: ' + err.message);
  }
});

// Upload endpoint: receives mp3 file, thumbnail image, metadata (title/artist/song/speed)
// Process: speed up audio -> create mp4 from image + audio -> return path to mp4 (or auto-upload)
app.post('/upload', upload.fields([{ name: 'audio', maxCount: 1 }, { name: 'thumbnail', maxCount: 1 }]), async (req, res) => {
  try {
    const audioFile = req.files['audio']?.[0];
    if (!audioFile) return res.status(400).send('audio file required (mp3)');
    const thumbFile = req.files['thumbnail']?.[0]; // optional
    const { title, artist, song, speed = '1.25', autoUpload } = req.body;

    const speedFactor = parseFloat(speed) || 1.25;
    const id = Date.now();
    const origPath = audioFile.path;
    const spedPath = path.join('outputs', `sped-${id}.mp3`);
    const videoPath = path.join('outputs', `video-${id}.mp4`);
    if (!fs.existsSync('outputs')) fs.mkdirSync('outputs');

    // decide processing filter: try rubberband then fallback to atempo
    const useRubberband = await new Promise(resolve => ffmpegHasRubberband(resolve));
    await new Promise((resolve, reject) => {
      if (Math.abs(speedFactor - 1) < 0.0001) {
        // just copy
        fs.copyFileSync(origPath, spedPath);
        return resolve();
      }
      if (useRubberband) {
        // rubberband filter (preserves pitch with high quality)
        ffmpeg(origPath)
          .audioFilters(`rubberband=tempo=${speedFactor}`)
          .on('error', err => reject(err))
          .on('end', () => resolve())
          .save(spedPath);
      } else {
        // fallback: chain atempo filters (atempo supports 0.5-2.0 per filter)
        // decompose speedFactor as product of factors between 0.5 and 2.0
        let remaining = speedFactor;
        const factors = [];
        while (remaining > 2.0) { factors.push(2.0); remaining /= 2.0; }
        while (remaining < 0.5) { factors.push(0.5); remaining /= 0.5; }
        factors.push(remaining);
        const filters = factors.map(f => `atempo=${f.toFixed(6)}`).join(',');
        ffmpeg(origPath)
          .audioFilters(filters)
          .on('error', err => reject(err))
          .on('end', () => resolve())
          .save(spedPath);
      }
    });

    // create video from thumbnail (or generic color) + sped audio
    const thumbPath = thumbFile ? thumbFile.path : null;
    if (thumbPath) {
      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(thumbPath)
          .loop(1)
          .input(spedPath)
          .outputOptions([
            '-c:v libx264',
            '-preset veryfast',
            '-tune stillimage',
            '-c:a aac',
            '-b:a 192k',
            '-pix_fmt yuv420p',
            '-shortest'
          ])
          .on('error', err => reject(err))
          .on('end', () => resolve())
          .save(videoPath);
      });
    } else {
      // no thumbnail: create a simple colored image with text could be added, but for simplicity make blank black image using ffmpeg
      await new Promise((resolve, reject) => {
        ffmpeg()
          .input('color=black:s=1280x720')
          .inputFormat('lavfi')
          .loop(1)
          .input(spedPath)
          .outputOptions([
            '-c:v libx264',
            '-preset veryfast',
            '-tune stillimage',
            '-c:a aac',
            '-b:a 192k',
            '-pix_fmt yuv420p',
            '-shortest'
          ])
          .on('error', err => reject(err))
          .on('end', () => resolve())
          .save(videoPath);
      });
    }

    const finalTitle = formatTitle(title, artist, song);
    const { description, tags } = buildDescriptionAndTags(finalTitle);

    // if autoUpload is 'true', perform the upload now
    if (autoUpload === 'true' || autoUpload === true) {
      // ensure tokens exist
      const tokens = loadTokens();
      if (!tokens) return res.status(400).send('App not authorized: please visit /auth and authorize first.');
      oAuth2Client.setCredentials(tokens);
      const youtube = google.youtube({ version: 'v3', auth: oAuth2Client });
      const stat = fs.statSync(videoPath);
      const fileSize = stat.size;

      const resUpload = await youtube.videos.insert({
        part: ['snippet', 'status'],
        requestBody: {
          snippet: {
            title: finalTitle,
            description,
            tags
          },
          status: {
            privacyStatus: 'public'
          }
        },
        media: {
          body: fs.createReadStream(videoPath)
        }
      }, { maxBodyLength: Infinity, maxContentLength: Infinity });

      // optionally set thumbnail if provided
      if (thumbPath) {
        try {
          await youtube.thumbnails.set({
            videoId: resUpload.data.id,
            media: { body: fs.createReadStream(thumbPath) }
          });
        } catch (err) {
          console.warn('Thumbnail set failed', err.message);
        }
      }

      return res.json({ message: 'Uploaded to YouTube', videoId: resUpload.data.id, title: finalTitle });
    }

    // otherwise return paths and metadata for manual upload later
    res.json({
      message: 'Processed',
      videoPath,
      title: finalTitle,
      description,
      tags
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error: ' + err.message);
  }
});

// Endpoint to upload an already-processed video file to YouTube given its path (demo)
app.post('/upload-to-youtube', express.json(), async (req, res) => {
  const { videoPath, title, description, tags } = req.body;
  if (!videoPath || !fs.existsSync(videoPath)) return res.status(400).send('videoPath missing or not found');
  const tokens = loadTokens();
  if (!tokens) return res.status(400).send('App not authorized: please visit /auth and authorize first.');
  oAuth2Client.setCredentials(tokens);
  const youtube = google.youtube({ version: 'v3', auth: oAuth2Client });
  try {
    const resUpload = await youtube.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: { title: title, description, tags },
        status: { privacyStatus: 'public' }
      },
      media: { body: fs.createReadStream(videoPath) }
    }, { maxBodyLength: Infinity, maxContentLength: Infinity });
    res.json({ message: 'Uploaded', videoId: resUpload.data.id });
  } catch (err) {
    console.error(err);
    res.status(500).send('Upload failed: ' + err.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Visit /auth to authorize YouTube uploads`);
});
