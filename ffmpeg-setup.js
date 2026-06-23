// ffmpeg-setup.js
// Bu dosya uygulama başlarken require edilmeli.
// Paketlenmiş ffmpeg/ffprobe ikelilerini fluent-ffmpeg'e bildirir.

const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const ffprobeInstaller = require('@ffprobe-installer/ffprobe');
const ffmpeg = require('fluent-ffmpeg');

// fluent-ffmpeg'e binary yollarını bildir
ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

// Deploy log'larında görebilmek için debug mesajı
console.log('Using ffmpeg at', ffmpegInstaller.path);
console.log('Using ffprobe at', ffprobeInstaller.path);

// Dosyadan export gerekmez; require() etmek yeterlidir.
