document.addEventListener('DOMContentLoaded', () => {
    const engine = new AudioEngine();
    
    // UI Elements
    const btnPlayMaster = document.getElementById('btn-master-play');
    const btnStopMaster = document.getElementById('btn-master-stop');
    const btnExport = document.getElementById('btn-export');
    const localFileInput = document.getElementById('local-file-input');
    const btnImportYt = document.getElementById('btn-import-yt');
    const ytUrlInput = document.getElementById('yt-url');
    const ytPreviewContainer = document.getElementById('yt-preview-container');
    const tracksContainer = document.getElementById('tracks-container');
    const emptyState = document.getElementById('empty-state');
    const trackTemplate = document.getElementById('track-template');
    
    const playhead = document.getElementById('playhead');
    const selectedNameDisplay = document.getElementById('selected-name');
    const clipPitchInput = document.getElementById('clip-pitch');
    const clipSpeedInput = document.getElementById('clip-speed');
    const clipFadeInInput = document.getElementById('clip-fade-in');
    const clipFadeOutInput = document.getElementById('clip-fade-out');
    const btnApplySettings = document.getElementById('btn-apply-settings');

    // State
    const PIXELS_PER_SECOND = 50;
    let playheadTime = 0; // Current time position of the playhead in seconds
    let selectedTrackId = null;

    // Playhead Dragging
    let isPlayheadDragging = false;
    playhead.addEventListener('mousedown', (e) => {
        isPlayheadDragging = true;
        e.stopPropagation();
    });

    window.addEventListener('mousemove', (e) => {
        if (isPlayheadDragging) {
            const ruler = document.getElementById('time-ruler');
            const rect = ruler.getBoundingClientRect();
            // Important: Use clientX but account for horizontal scroll if any
            let x = e.clientX - rect.left;
            if (x < 0) x = 0;
            updatePlayheadPosition(x);
        }
    });

    // Also allow clicking ruler to jump
    document.getElementById('time-ruler').addEventListener('mousedown', (e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        updatePlayheadPosition(x);
        // If playing, we might want to seek (future feature), for now just jump
        if (engine.isPlaying) {
            engine.stopMaster(); // Easiest way to "seek" is stop and play from new time
            engine.pauseTime = playheadTime;
            engine.playMaster();
            // Ensure UI is in playing state
            document.getElementById('master-play-text').innerText = 'Pause Mix';
            btnPlayMaster.querySelector('i').setAttribute('data-lucide', 'pause');
            btnPlayMaster.classList.add('is-playing');
            lucide.createIcons();
            requestAnimationFrame(updatePlayheadUI);
        }
    });

    window.addEventListener('mouseup', () => {
        isPlayheadDragging = false;
    });

    // Apply Settings (Speed & Fades)
    btnApplySettings.addEventListener('click', () => {
        if (selectedTrackId) {
            const pitch = parseFloat(clipPitchInput.value) || 0;
            const speed = parseFloat(clipSpeedInput.value);
            const fadeIn = parseFloat(clipFadeInInput.value) || 0;
            const fadeOut = parseFloat(clipFadeOutInput.value) || 0;

            engine.setPitch(selectedTrackId, pitch);
            engine.setPlaybackRate(selectedTrackId, speed);
            engine.setFade(selectedTrackId, 'in', fadeIn);
            engine.setFade(selectedTrackId, 'out', fadeOut);

            const track = engine.tracks.get(selectedTrackId);
            const trackEl = document.querySelector(`[data-id="${selectedTrackId}"]`);
            if (trackEl && track) {
                const clip = trackEl.querySelector('.clip');
                const newWidth = (track.originalBuffer.duration / Math.abs(speed)) * PIXELS_PER_SECOND;
                clip.style.width = `${newWidth}px`;
                const canvas = trackEl.querySelector('.waveform');
                canvas.width = newWidth;
                drawWaveform(canvas, track.buffer);
            }
        }
    });

    // Master Controls — gradient wave on play
    function setPlayingStyle(active) {
        if (active) {
            // Use setAttribute to slam all props at once, bypassing transition & specificity
            btnPlayMaster.setAttribute('style',
                'background: linear-gradient(90deg, #ff0080, #9600ff, #40e0d0, #ff0080) !important;' +
                'background-size: 200% auto !important;' +
                'animation: shimmerWave 2s linear infinite !important;' +
                'transition: none !important;' +
                'box-shadow: 0 0 22px rgba(255,0,128,0.7), 0 0 44px rgba(150,0,255,0.4) !important;' +
                'border: none !important;' +
                'color: white !important;'
            );
        } else {
            btnPlayMaster.removeAttribute('style');
        }
    }

    btnPlayMaster.addEventListener('click', () => {
        if (engine.ctx.state === 'suspended') engine.ctx.resume();
        
        if (engine.isPlaying) {
            engine.stopMaster();
            document.getElementById('master-play-text').innerText = 'Play Mix';
            // Restore the <i> tag for lucide (SVG may be present instead)
            btnPlayMaster.innerHTML = '<i data-lucide="play"></i> <span id="master-play-text">Play Mix</span>';
            btnPlayMaster.classList.remove('is-playing');
            setPlayingStyle(false);
            lucide.createIcons();
        } else {
            engine.playMaster();
            btnPlayMaster.innerHTML = '<i data-lucide="pause"></i> <span id="master-play-text">Pause Mix</span>';
            btnPlayMaster.classList.add('is-playing');
            setPlayingStyle(true);
            lucide.createIcons();
            requestAnimationFrame(updatePlayheadUI);
        }
    });

    btnStopMaster.addEventListener('click', () => {
        engine.stopMaster();
        playhead.style.left = '0px';
        playheadTime = 0;
        document.getElementById('master-play-text').innerText = 'Play Mix';
        btnPlayMaster.querySelector('i').setAttribute('data-lucide', 'play');
        btnPlayMaster.classList.remove('is-playing');
        setPlayingStyle(false);
        lucide.createIcons();
        updatePlayheadUI();
    });

    // Local File Upload
    localFileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const arrayBuffer = await file.arrayBuffer();
        try {
            const audioBuffer = await engine.decodeAudioData(arrayBuffer);
            addTrackToUI(audioBuffer, file.name);
        } catch (err) {
            alert('Error decoding audio file.');
            console.error(err);
        }
        localFileInput.value = ''; // Reset
    });

    // YouTube Preview Detection
    ytUrlInput.addEventListener('input', () => {
        const url = ytUrlInput.value.trim();
        const videoIdMatch = url.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([^& \n]+)/);
        
        if (videoIdMatch && videoIdMatch[1]) {
            const videoId = videoIdMatch[1];
            ytPreviewContainer.innerHTML = `<iframe src="https://www.youtube.com/embed/${videoId}" allowfullscreen></iframe>`;
            ytPreviewContainer.classList.remove('hidden');
        } else {
            ytPreviewContainer.classList.add('hidden');
            ytPreviewContainer.innerHTML = '';
        }
    });

    // YouTube Import
    btnImportYt.addEventListener('click', async () => {
        const url = document.getElementById('yt-url').value;
        const start = document.getElementById('yt-start').value || 0;
        const end = document.getElementById('yt-end').value || 10;

        if (!url) {
            alert('Please enter a YouTube URL');
            return;
        }

        const originalText = btnImportYt.innerHTML;
        btnImportYt.innerHTML = '<i data-lucide="loader"></i> Extracting...';
        btnImportYt.disabled = true;
        lucide.createIcons();

        try {
            // Call our local Node.js backend
            const response = await fetch(`http://localhost:3000/api/extract-audio?url=${encodeURIComponent(url)}&start=${start}&end=${end}`);
            
            if (!response.ok) {
                throw new Error('Backend failed to extract audio');
            }

            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await engine.decodeAudioData(arrayBuffer);
            addTrackToUI(audioBuffer, `YouTube Extract`);
        } catch (err) {
            alert('Failed to extract audio. Is the backend server running?');
            console.error(err);
        } finally {
            btnImportYt.innerHTML = originalText;
            btnImportYt.disabled = false;
            lucide.createIcons();
        }
    });

    // Synth Pads
    document.querySelectorAll('.pad-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const type = e.target.dataset.sound;
            // Immediate Audio Preview
            if (type === 'kick') engine.createKick();
            else if (type === 'snare') engine.createSnare();

            // Add to workspace
            const buffer = await engine.getSynthBuffer(type);
            addTrackToUI(buffer, `Synth ${type}`);
        });
    });

    // Export Mix
    btnExport.addEventListener('click', async () => {
        if (engine.tracks.size === 0) {
            alert('Add some tracks first!');
            return;
        }

        const oldText = btnExport.innerHTML;
        btnExport.innerHTML = '<i data-lucide="loader"></i> Exporting...';
        lucide.createIcons();

        try {
            const blob = await engine.exportMix();
            if (blob) {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = url;
                a.download = 'my_mix.wav';
                document.body.appendChild(a);
                a.click();
                URL.revokeObjectURL(url);
            }
        } catch (e) {
            console.error(e);
            alert('Failed to export mix.');
        } finally {
            btnExport.innerHTML = oldText;
            lucide.createIcons();
        }
    });

    // Drawing Waveform
    function drawWaveform(canvas, buffer) {
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        const data = buffer.getChannelData(0);
        const step = Math.ceil(data.length / width);
        const amp = height / 2;

        ctx.fillStyle = 'rgba(99, 102, 241, 0.7)';
        ctx.clearRect(0, 0, width, height);

        for (let i = 0; i < width; i++) {
            let min = 1.0;
            let max = -1.0;
            for (let j = 0; j < step; j++) {
                const datum = data[(i * step) + j]; 
                if (datum < min) min = datum;
                if (datum > max) max = datum;
            }
            ctx.fillRect(i, (1 + min) * amp, 1, Math.max(1, (max - min) * amp));
        }
    }

    // Add Track to UI
    function addTrackToUI(buffer, name) {
        emptyState.classList.add('hidden');
        
        const trackId = engine.addTrack(buffer, name);
        const trackNode = trackTemplate.content.cloneNode(true);
        const trackEl = trackNode.querySelector('.track');
        trackEl.dataset.id = trackId;
        
        const nameLabel = trackEl.querySelector('.track-name');
        nameLabel.innerText = name;

        // Double Click to Rename
        nameLabel.addEventListener('dblclick', () => {
            const currentName = nameLabel.innerText;
            const input = document.createElement('input');
            input.type = 'text';
            input.value = currentName;
            input.className = 'track-name-input';
            
            nameLabel.replaceWith(input);
            input.focus();
            input.select();

            const saveName = () => {
                const newName = input.value.trim() || currentName;
                nameLabel.innerText = newName;
                input.replaceWith(nameLabel);
                // Update engine and selection display
                engine.tracks.get(trackId).name = newName;
                if (selectedTrackId === trackId) {
                    selectedNameDisplay.innerText = newName;
                }
            };

            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') saveName();
                if (e.key === 'Escape') input.replaceWith(nameLabel);
            });
            input.addEventListener('blur', saveName);
        });
        
        // Setup clip dimensions
        const clip = trackEl.querySelector('.clip');
        const duration = buffer.duration;
        const width = duration * PIXELS_PER_SECOND;
        clip.style.width = `${width}px`;
        clip.style.left = '0px';

        // Draw waveform
        const canvas = trackEl.querySelector('.waveform');
        canvas.width = width;
        canvas.height = 80; // Match track height roughly
        drawWaveform(canvas, buffer);

        // Selection Logic
        clip.addEventListener('click', (e) => {
            // Deselect previous
            document.querySelectorAll('.clip').forEach(c => c.classList.remove('selected'));
            clip.classList.add('selected');
            selectedTrackId = trackId;
            selectedNameDisplay.innerText = name;
            const track = engine.tracks.get(trackId);
            clipPitchInput.value = track.pitch || 0;
            clipSpeedInput.value = track.playbackRate;
            clipFadeInInput.value = track.fadeInDuration;
            clipFadeOutInput.value = track.fadeOutDuration;
            e.stopPropagation();
        });

        // Controls
        const btnRemoveClip = trackEl.querySelector('.btn-t-remove-clip');
        btnRemoveClip.addEventListener('click', () => {
            if (selectedTrackId === trackId) {
                engine.removeTrack(trackId);
                trackEl.remove();
                selectedTrackId = null;
                selectedNameDisplay.innerText = 'None';
                if (engine.tracks.size === 0) emptyState.classList.remove('hidden');
            } else {
                alert('Select the clip first to delete it.');
            }
        });

        const btnRemoveTrack = trackEl.querySelector('.btn-t-remove-track');
        btnRemoveTrack.addEventListener('click', () => {
            engine.removeTrack(trackId);
            trackEl.remove();
            if (selectedTrackId === trackId) {
                selectedTrackId = null;
                selectedNameDisplay.innerText = 'None';
            }
            if (engine.tracks.size === 0) emptyState.classList.remove('hidden');
        });

        const btnSplit = trackEl.querySelector('.btn-t-split');
        btnSplit.addEventListener('click', () => {
            const track = engine.tracks.get(trackId);
            if (!track) return;

            // Split at playhead position relative to clip
            const relativePlayheadTime = playheadTime - track.startOffset;

            if (relativePlayheadTime > 0 && relativePlayheadTime < track.duration) {
                // Adjust for current playbackRate
                const actualSplitPointInOriginal = relativePlayheadTime * Math.abs(track.playbackRate);
                
                const buffer1 = engine.sliceBuffer(track.originalBuffer, 0, actualSplitPointInOriginal);
                const buffer2 = engine.sliceBuffer(track.originalBuffer, actualSplitPointInOriginal, track.originalBuffer.duration);

                if (buffer1 && buffer2) {
                    // Update current track to part 1
                    track.originalBuffer = buffer1;
                    track.buffer = track.playbackRate < 0 ? engine.reverseBuffer(buffer1) : buffer1;
                    track.duration = buffer1.duration / Math.abs(track.playbackRate);
                    updateClipUI(trackEl, track.buffer);

                    // Add part 2 as new track
                    const newTrackId = addTrackToUI(buffer2, `${name} (Part 2)`);
                    const newTrack = engine.tracks.get(newTrackId);
                    newTrack.playbackRate = track.playbackRate;
                    newTrack.buffer = track.playbackRate < 0 ? engine.reverseBuffer(buffer2) : buffer2;
                    newTrack.duration = buffer2.duration / Math.abs(track.playbackRate);
                    
                    const newOffset = track.startOffset + (actualSplitPointInOriginal / Math.abs(track.playbackRate));
                    engine.updateTrackStartOffset(newTrackId, newOffset);
                    
                    // Position new clip UI
                    const newTrackEl = tracksContainer.querySelector(`[data-id="${newTrackId}"]`);
                    if (newTrackEl) {
                        const newClip = newTrackEl.querySelector('.clip');
                        newClip.style.left = `${newOffset * PIXELS_PER_SECOND}px`;
                        updateClipUI(newTrackEl, newTrack.buffer);
                    }
                }
            } else {
                alert('Playhead must be over the clip to split.');
            }
        });

        const volSlider = trackEl.querySelector('.vol-slider');
        volSlider.addEventListener('input', (e) => {
            engine.setTrackVolume(trackId, parseFloat(e.target.value));
        });

        // Basic Dragging functionality
        let isDragging = false;
        let startX = 0;
        let startLeft = 0;

        clip.addEventListener('mousedown', (e) => {
            if (e.target.classList.contains('trim-handle')) return; // Handled by separate logic if needed
            isDragging = true;
            startX = e.clientX;
            startLeft = parseInt(clip.style.left || 0, 10);
            clip.style.cursor = 'grabbing';
            e.stopPropagation();
        });

        window.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            let newLeft = startLeft + dx;
            if (newLeft < 0) newLeft = 0;
            clip.style.left = `${newLeft}px`;
            engine.updateTrackStartOffset(trackId, newLeft / PIXELS_PER_SECOND);
        });

        window.addEventListener('mouseup', () => {
            isDragging = false;
            clip.style.cursor = 'move';
        });

        tracksContainer.appendChild(trackEl);
        lucide.createIcons();
        return trackId;
    }

    function updateClipUI(trackEl, buffer) {
        const clip = trackEl.querySelector('.clip');
        const width = buffer.duration * PIXELS_PER_SECOND;
        clip.style.width = `${width}px`;
        const canvas = trackEl.querySelector('.waveform');
        canvas.width = width;
        drawWaveform(canvas, buffer);
    }

    function updatePlayheadUI() {
        if (engine.isPlaying) {
            const currentTime = (engine.ctx.currentTime - engine.startTime);
            const x = currentTime * PIXELS_PER_SECOND;
            playhead.style.left = `${x}px`;
            playheadTime = currentTime;
            engine.pauseTime = currentTime; // Keep engine in sync
            requestAnimationFrame(updatePlayheadUI);
        }
    }

    function updatePlayheadPosition(x) {
        playhead.style.left = `${x}px`;
        playheadTime = x / PIXELS_PER_SECOND;
        engine.pauseTime = playheadTime;
    }
    
    // Ruler drawing
    function drawRuler() {
        const ruler = document.getElementById('time-ruler');
        ruler.innerHTML = '';
        for (let i = 0; i <= 300; i += 5) { // 300 seconds
            const marker = document.createElement('div');
            marker.style.position = 'absolute';
            marker.style.left = `${i * PIXELS_PER_SECOND}px`;
            marker.style.top = '0';
            marker.style.color = '#94a3b8';
            marker.style.fontSize = '12px';
            marker.style.padding = '2px';
            marker.style.borderLeft = '1px solid #334155';
            marker.style.height = '100%';
            marker.innerText = `${i}s`;
            ruler.appendChild(marker);
        }
    }
    
    drawRuler();
});
