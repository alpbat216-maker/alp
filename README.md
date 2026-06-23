# SpeedUp Uploader (basic)

What it does:
- Upload an MP3.
- Speed up the audio while keeping pitch (uses ffmpeg rubberband filter if available, else atempo fallback).
- Combine sped audio with uploaded thumbnail into a simple mp4.
- Optionally auto-upload to your YouTube channel (requires OAuth consent).

Setup:
1. Install Node.js (>=16).
2. Install ffmpeg on the machine and ensure it's on PATH.
   - For best quality, install ffmpeg built with librubberband so `rubberband` audio filter is available. (On Debian/Ubuntu you may need to build ffmpeg or use a package that includes librubberband.)
3. Clone or copy the project, then:
   npm install
4. Copy `.env.example` to `.env` and fill GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET.
   - Create a Google Cloud project, enable YouTube Data API v3, create OAuth Client ID (type Web application), add redirect URI: `http://localhost:3000/oauth2callback`
5. Start server:
   npm start
6. In browser:
   - Visit http://localhost:3000/auth and complete OAuth. This saves tokens/tokens.json.
   - Open the root page, upload an mp3, choose thumbnail and speed, optionally check "Auto-upload".
7. For production: store tokens securely; use HTTPS; validate and sanitize inputs; handle quotas and resumable uploads for large files.

Notes & limitations:
- This demo stores OAuth tokens in tokens.json. In production use a DB/secret store and refresh token rotation handling.
- YouTube upload quotas apply. The app uses single-request uploads; for larger files use resumable uploads with youtube.videos.insert and uploadType=resumable.
- ffmpeg rubberband filter gives best quality time-stretch. If not available, fallback atempo chaining may produce more artifacts.
- This sample sets uploaded videos to public by default. Adjust privacyStatus if you want private/unlisted.
- You must own/authorize the YouTube channel to upload.

If istersen, ben bu repo içine commit yapıp (veya sana doğrudan zip ile verebilirim) hazır bir proje bırakırım; ayrıca ffmpeg + rubberband kurulumu için ayrıntılı komutlar ve Google OAuth token alma adımlarını da detaylandırırım.
