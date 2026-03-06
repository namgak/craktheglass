const express = require('express');
const cors = require('cors');
const ytDlp = require('yt-dlp-exec');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3000;

app.get('/api/extract-audio', async (req, res) => {
    try {
        const url = req.query.url;
        const start = parseFloat(req.query.start) || 0;
        const end = parseFloat(req.query.end) || start + 10;

        if (!url) {
            return res.status(400).json({ error: 'Missing YouTube URL' });
        }

        const duration = end - start;
        if (duration <= 0 || duration > 600) {
            return res.status(400).json({ error: 'Invalid duration or too long' });
        }

        console.log(`Extracting: ${url}, from ${start} to ${end}`);

        // Get the actual audio stream URL using yt-dlp
        const output = await ytDlp(url, {
            dumpSingleJson: true,
            format: 'ba/b', // Best audio or just best if audio only isn't explicit
            noWarnings: true,
            noCheckCertificates: true,
            preferFreeFormats: true,
            addHeader: [
                'User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            ]
        });

        if (!output || !output.url) {
            throw new Error('Could not find audio URL');
        }

        const audioUrl = output.url;

        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Disposition', 'attachment; filename="extracted.mp3"');

        // Pass the direct URL to FFmpeg
        ffmpeg(audioUrl)
            .setStartTime(start)
            .setDuration(duration)
            .format('mp3')
            .audioBitrate(128)
            .on('start', (cmd) => console.log('FFmpeg started:', cmd))
            .on('error', (err) => {
                console.error('FFmpeg error:', err);
                if (!res.headersSent) res.status(500).json({ error: 'Audio processing failed' });
            })
            .pipe(res, { end: true });

    } catch (error) {
        console.error('Server error:', error);
        if (!res.headersSent) res.status(500).json({ error: 'Internal server error: ' + error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Backend Server running on http://localhost:${PORT}`);
});
