class AudioEngine {
    constructor() {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.tracks = new Map(); // id => { buffer, gainNode, source, startOffset, duration, isMuted }
        this.masterGain = this.ctx.createGain();
        this.masterGain.connect(this.ctx.destination);
        this.nextTrackId = 1;
        this.isPlaying = false;
        this.startTime = 0;
        this.pauseTime = 0;
        this.animationFrame = null;
    }

    async decodeAudioData(arrayBuffer) {
        return await this.ctx.decodeAudioData(arrayBuffer);
    }

    sliceBuffer(buffer, start, end) {
        const sampleRate = buffer.sampleRate;
        const startOffset = Math.max(0, Math.floor(start * sampleRate));
        const endOffset = Math.min(buffer.length, Math.floor(end * sampleRate));
        const frameCount = endOffset - startOffset;

        if (frameCount <= 0) return null;

        const newBuffer = this.ctx.createBuffer(
            buffer.numberOfChannels,
            frameCount,
            sampleRate
        );

        for (let i = 0; i < buffer.numberOfChannels; i++) {
            const channelData = buffer.getChannelData(i);
            const newChannelData = newBuffer.getChannelData(i);
            newChannelData.set(channelData.subarray(startOffset, endOffset));
        }

        return newBuffer;
    }

    addTrack(buffer, name) {
        const id = `track-${this.nextTrackId++}`;
        const gainNode = this.ctx.createGain();
        gainNode.connect(this.masterGain);
        
        this.tracks.set(id, {
            id,
            name,
            originalBuffer: buffer,
            buffer: buffer,
            reversedBuffer: null, // Lazy load
            gainNode,
            source: null,
            startOffset: 0, 
            duration: buffer.duration,
            isMuted: false,
            volume: 1,
            pitch: 0,
            playbackRate: 1,
            fadeInDuration: 0,
            fadeOutDuration: 0
        });
        return id;
    }

    setPlaybackRate(id, rate) {
        const track = this.tracks.get(id);
        if (track) {
            track.playbackRate = rate;
            if (rate < 0 && !track.reversedBuffer) {
                track.reversedBuffer = this.reverseBuffer(track.originalBuffer);
            }
            track.buffer = rate < 0 ? track.reversedBuffer : track.originalBuffer;
            
            // If playing, we need to update the source
            if (this.isPlaying && track.source) {
                this.stopTrack(id);
                this.playTrackLogic(track, (this.ctx.currentTime - this.startTime) - track.startOffset);
            }
        }
    }

    setPitch(id, pitch) {
        const track = this.tracks.get(id);
        if (track) {
            track.pitch = pitch;
            if (this.isPlaying && track.source) {
                track.source.detune.value = track.pitch * 100;
            }
        }
    }

    setFade(id, type, duration) {
        const track = this.tracks.get(id);
        if (track) {
            if (type === 'in') track.fadeInDuration = duration;
            if (type === 'out') track.fadeOutDuration = duration;
        }
    }

    reverseBuffer(buffer) {
        const reversed = this.ctx.createBuffer(
            buffer.numberOfChannels,
            buffer.length,
            buffer.sampleRate
        );
        for (let i = 0; i < buffer.numberOfChannels; i++) {
            const data = buffer.getChannelData(i);
            const revData = reversed.getChannelData(i);
            for (let j = 0; j < buffer.length; j++) {
                revData[j] = data[buffer.length - 1 - j];
            }
        }
        return reversed;
    }

    removeTrack(id) {
        this.stopTrack(id);
        const track = this.tracks.get(id);
        if (track) {
            track.gainNode.disconnect();
            this.tracks.delete(id);
        }
    }

    setTrackVolume(id, vol) {
        const track = this.tracks.get(id);
        if (track) {
            track.volume = vol;
            track.gainNode.gain.value = track.isMuted ? 0 : vol;
        }
    }

    playMaster() {
        if (this.isPlaying) return;
        if (this.ctx.state === 'suspended') this.ctx.resume();
        
        this.isPlaying = true;
        this.startTime = this.ctx.currentTime - this.pauseTime;

        this.tracks.forEach((track, id) => {
            if (track.startOffset + track.duration > this.pauseTime) {
                // Track hasn't finished yet
                this.playTrackLogic(track, Math.max(0, this.pauseTime - track.startOffset));
            }
        });
    }

    playTrackLogic(track, offsetInTrack) {
        // Disconnect old source
        if (track.source) {
            track.source.disconnect();
        }
        
        track.source = this.ctx.createBufferSource();
        track.source.buffer = track.buffer;
        track.source.playbackRate.value = Math.abs(track.playbackRate || 1);
        track.source.detune.value = (track.pitch || 0) * 100;
        track.source.connect(track.gainNode);
        
        // Fades
        const now = this.ctx.currentTime;
        const startCtxTime = track.startOffset > this.pauseTime 
            ? this.startTime + track.startOffset 
            : now;

        const g = track.gainNode.gain;
        const targetVol = track.isMuted ? 0 : track.volume;
        
        g.cancelScheduledValues(now);
        
        // Initial setup for fades
        if (offsetInTrack === 0) {
            g.setValueAtTime(0, startCtxTime);
            if (track.fadeInDuration > 0) {
                g.linearRampToValueAtTime(targetVol, startCtxTime + track.fadeInDuration / Math.abs(track.playbackRate));
            } else {
                g.setValueAtTime(targetVol, startCtxTime);
            }
        } else {
            g.setValueAtTime(targetVol, now);
        }

        // Handle Fade Out
        if (track.fadeOutDuration > 0) {
            const trackEndCtxTime = startCtxTime + (track.duration - offsetInTrack);
            const fadeOutStartCtxTime = trackEndCtxTime - (track.fadeOutDuration / Math.abs(track.playbackRate));
            
            if (fadeOutStartCtxTime > now) {
                g.setValueAtTime(targetVol, fadeOutStartCtxTime);
                g.linearRampToValueAtTime(0, trackEndCtxTime);
            } else {
                // We are already in the fade out zone
                const remaining = trackEndCtxTime - now;
                if (remaining > 0) {
                    g.linearRampToValueAtTime(0, trackEndCtxTime);
                }
            }
        }

        const bufferOffset = offsetInTrack * Math.abs(track.playbackRate);
        track.source.start(startCtxTime, bufferOffset);
    }

    stopMaster() {
        this.isPlaying = false;
        this.pauseTime = 0;
        this.tracks.forEach(track => {
            if (track.source) {
                try { track.source.stop(); } catch(e){}
                track.source.disconnect();
                track.source = null;
            }
        });
    }

    stopTrack(id) {
        const track = this.tracks.get(id);
        if (track && track.source) {
            try { track.source.stop(); } catch(e){}
            track.source.disconnect();
            track.source = null;
        }
    }

    updateTrackStartOffset(id, offset) {
        const track = this.tracks.get(id);
        if (track) {
            track.startOffset = offset;
        }
    }

    // Synthesizer Methods for Default Sounds
    createKick() {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.connect(gain);
        gain.connect(this.masterGain);

        osc.frequency.setValueAtTime(150, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.5);
        gain.gain.setValueAtTime(1, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.5);

        osc.start(this.ctx.currentTime);
        osc.stop(this.ctx.currentTime + 0.5);
        return this.recordSynth(osc, gain, 0.5);
    }

    createSnare() {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        // Noise buffer
        const bufferSize = this.ctx.sampleRate * 0.5; // 0.5 seconds
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;
        const noiseFilter = this.ctx.createBiquadFilter();
        noiseFilter.type = 'highpass';
        noiseFilter.frequency.value = 1000;
        noise.connect(noiseFilter);
        
        const noiseEnvelope = this.ctx.createGain();
        noiseFilter.connect(noiseEnvelope);
        noiseEnvelope.connect(this.masterGain);
        noiseEnvelope.gain.setValueAtTime(1, this.ctx.currentTime);
        noiseEnvelope.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.2);
        noise.start(this.ctx.currentTime);

        const osc = this.ctx.createOscillator();
        const oscEnvelope = this.ctx.createGain();
        osc.type = 'triangle';
        osc.connect(oscEnvelope);
        oscEnvelope.connect(this.masterGain);
        osc.frequency.setValueAtTime(100, this.ctx.currentTime);
        oscEnvelope.gain.setValueAtTime(0.7, this.ctx.currentTime);
        oscEnvelope.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.1);
        osc.start(this.ctx.currentTime);
        osc.stop(this.ctx.currentTime + 0.2);

        return this.recordSynthOffline(noise, noiseFilter, noiseEnvelope, osc, oscEnvelope, 0.5);
    }
    
    // Using OfflineAudioContext to render synth to a buffer to use as a track
    async recordSynthOffline(s1, f1, g1, s2, g2, duration) {
        const offlineCtx = new OfflineAudioContext(2, 44100 * duration, 44100);
        
        if (s1 && s1.buffer) {
            const noise = offlineCtx.createBufferSource();
            noise.buffer = s1.buffer;
            const filter = offlineCtx.createBiquadFilter();
            filter.type = 'highpass'; filter.frequency.value = 1000;
            const gain = offlineCtx.createGain();
            noise.connect(filter); filter.connect(gain); gain.connect(offlineCtx.destination);
            gain.gain.setValueAtTime(1, 0); gain.gain.exponentialRampToValueAtTime(0.01, 0.2);
            noise.start(0);
        }

        if (s2) {
            const osc = offlineCtx.createOscillator();
            const gain = offlineCtx.createGain();
            osc.type = 'triangle';
            osc.connect(gain); gain.connect(offlineCtx.destination);
            osc.frequency.setValueAtTime(100, 0);
            gain.gain.setValueAtTime(0.7, 0); gain.gain.exponentialRampToValueAtTime(0.01, 0.1);
            osc.start(0); osc.stop(duration);
        }

        return await offlineCtx.startRendering();
    }

    async getSynthBuffer(type) {
        if (type === 'kick') {
            const offlineCtx = new OfflineAudioContext(1, 44100 * 0.5, 44100);
            const osc = offlineCtx.createOscillator();
            const gain = offlineCtx.createGain();
            osc.connect(gain); gain.connect(offlineCtx.destination);
            osc.frequency.setValueAtTime(150, 0); osc.frequency.exponentialRampToValueAtTime(0.01, 0.5);
            gain.gain.setValueAtTime(1, 0); gain.gain.exponentialRampToValueAtTime(0.01, 0.5);
            osc.start(0); osc.stop(0.5);
            return await offlineCtx.startRendering();
        } else if (type === 'snare') {
            // Noise
            const offlineCtx = new OfflineAudioContext(1, 44100 * 0.5, 44100);
            const bufferSize = offlineCtx.sampleRate * 0.5;
            const buffer = offlineCtx.createBuffer(1, bufferSize, offlineCtx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
            const noise = offlineCtx.createBufferSource(); noise.buffer = buffer;
            const filter = offlineCtx.createBiquadFilter(); filter.type = 'highpass'; filter.frequency.value = 1000;
            const gain = offlineCtx.createGain();
            noise.connect(filter); filter.connect(gain); gain.connect(offlineCtx.destination);
            gain.gain.setValueAtTime(1, 0); gain.gain.exponentialRampToValueAtTime(0.01, 0.2);
            noise.start(0);
            
            // Tone
            const osc = offlineCtx.createOscillator(); const oscGain = offlineCtx.createGain();
            osc.type = 'triangle'; osc.connect(oscGain); oscGain.connect(offlineCtx.destination);
            osc.frequency.setValueAtTime(100, 0); oscGain.gain.setValueAtTime(0.7, 0); oscGain.gain.exponentialRampToValueAtTime(0.01, 0.1);
            osc.start(0); osc.stop(0.2);
            return await offlineCtx.startRendering();
        } else if (type === 'hihat') {
            const offlineCtx = new OfflineAudioContext(1, 44100 * 0.1, 44100);
            const bufferSize = offlineCtx.sampleRate * 0.1;
            const buffer = offlineCtx.createBuffer(1, bufferSize, offlineCtx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
            const noise = offlineCtx.createBufferSource(); noise.buffer = buffer;
            const filter = offlineCtx.createBiquadFilter(); filter.type = 'highpass'; filter.frequency.value = 7000;
            const gain = offlineCtx.createGain();
            noise.connect(filter); filter.connect(gain); gain.connect(offlineCtx.destination);
            gain.gain.setValueAtTime(1, 0); gain.gain.exponentialRampToValueAtTime(0.01, 0.1);
            noise.start(0);
            return await offlineCtx.startRendering();
        } else if (type === 'beep') {
            const offlineCtx = new OfflineAudioContext(1, 44100 * 0.3, 44100);
            const osc = offlineCtx.createOscillator();
            const gain = offlineCtx.createGain();
            osc.type = 'square';
            osc.connect(gain); gain.connect(offlineCtx.destination);
            osc.frequency.setValueAtTime(800, 0);
            gain.gain.setValueAtTime(0.3, 0); gain.gain.exponentialRampToValueAtTime(0.01, 0.2);
            osc.start(0); osc.stop(0.3);
            return await offlineCtx.startRendering();
        }
    }

    // Export Mix
    async exportMix() {
        if (this.tracks.size === 0) return null;
        
        let maxDuration = 0;
        this.tracks.forEach(track => {
            const end = track.startOffset + track.duration;
            if (end > maxDuration) maxDuration = end;
        });

        if (maxDuration === 0) return null;

        const sampleRate = 44100;
        const offlineCtx = new OfflineAudioContext(2, sampleRate * maxDuration, sampleRate);

        this.tracks.forEach(track => {
            const source = offlineCtx.createBufferSource();
            const gainNode = offlineCtx.createGain();
            source.buffer = track.buffer;
            source.playbackRate.value = Math.abs(track.playbackRate);
            source.detune.value = (track.pitch || 0) * 100;
            
            gainNode.gain.value = track.isMuted ? 0 : track.volume;
            
            source.connect(gainNode);
            gainNode.connect(offlineCtx.destination);
            
            source.start(track.startOffset);
        });

        const renderedBuffer = await offlineCtx.startRendering();
        return this.bufferToWave(renderedBuffer, maxDuration);
    }

    // Convert AudioBuffer to WAV format
    bufferToWave(abuffer, len) {
        let numOfChan = abuffer.numberOfChannels,
            length = len * abuffer.sampleRate * numOfChan * 2 + 44,
            buffer = new ArrayBuffer(length),
            view = new DataView(buffer),
            channels = [], i, sample,
            offset = 0,
            pos = 0;

        // write WAVE header
        setUint32(0x46464952);                         // "RIFF"
        setUint32(length - 8);                         // file length - 8
        setUint32(0x45564157);                         // "WAVE"

        setUint32(0x20746d66);                         // "fmt " chunk
        setUint32(16);                                 // length = 16
        setUint16(1);                                  // PCM (uncompressed)
        setUint16(numOfChan);
        setUint32(abuffer.sampleRate);
        setUint32(abuffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
        setUint16(numOfChan * 2);                      // block-align
        setUint16(16);                                 // 16-bit (hardcoded in this demo)

        setUint32(0x61746164);                         // "data" - chunk
        setUint32(length - pos - 4);                   // chunk length

        // write interleaved data
        for(i = 0; i < abuffer.numberOfChannels; i++)
            channels.push(abuffer.getChannelData(i));

        while(pos < length) {
            for(i = 0; i < numOfChan; i++) {
                sample = Math.max(-1, Math.min(1, channels[i][offset])); // clamp
                sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767)|0; // scale to 16-bit signed int
                view.setInt16(pos, sample, true);          // update data chunk
                pos += 2;
            }
            offset++
        }

        return new Blob([buffer], {type: "audio/wav"});

        function setUint16(data) {
            view.setUint16(pos, data, true);
            pos += 2;
        }

        function setUint32(data) {
            view.setUint32(pos, data, true);
            pos += 4;
        }
    }
}
