import { exec, spawn } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { TTSConfig as gptTTSConfig } from '../models/gpt.js';
import { TTSConfig as geminiTTSConfig } from '../models/gemini.js';

let speakingQueue = []; // each item: {text, model, audioData, ready}
let isSpeaking = false;
let speechVersion = 0;

export function speak(text, speak_model) {
    const model = speak_model || 'system';
    const isKokoro =
        typeof model === 'string' ? model.startsWith('kokoro/') : model.api === 'kokoro';
    const version = ++speechVersion;
    if (isKokoro) speakingQueue = []; // Do not read stale replies after the conversation moves on.
    // Start playback after a short phrase instead of synthesizing the entire reply first.
    const parts = isKokoro ? splitSpeech(text) : [text];
    for (const part of parts) {
        enqueueSpeech(part, model, version);
    }
}

export function splitSpeech(text) {
    const parts = [];
    for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
        const words = sentence.trim().split(/\s+/).filter(Boolean);
        for (let i = 0; i < words.length;) {
            const limit = parts.length === 0 ? 8 : 24;
            parts.push(words.slice(i, i + limit).join(' '));
            i += limit;
        }
    }
    return parts;
}

export function prepareVoice(model) {
    const isKokoro =
        typeof model === 'string' ? model.startsWith('kokoro/') : model?.api === 'kokoro';
    if (!isKokoro) return;
    const voice = typeof model === 'string' ? model.split('/')[2] : model.voice;
    import('./kokoro.js')
        .then(({ generateKokoroAudio }) => generateKokoroAudio('Ready.', voice))
        .then(() => console.log('[Kokoro] Voice warmed up.'))
        .catch((error) => console.error('[Kokoro] Voice warmup failed:', error));
}

function enqueueSpeech(text, model, version) {
    // Generate only when needed: queued older replies can then be dropped cheaply.
    const item = { text, model, version, audioData: null, queuedAt: Date.now() };

    speakingQueue.push(item);
    if (!isSpeaking) processQueue();
}

async function fetchRemoteAudio(txt, model) {
    function getModelUrl(prov) {
        if (prov === 'openai') return gptTTSConfig.baseUrl;
        if (prov === 'google') return geminiTTSConfig.baseUrl;
        return 'https://api.openai.com/v1';
    }

    let prov, mdl, voice, url;
    if (typeof model === 'string') {
        [prov, mdl, voice] = model.split('/');
        url = getModelUrl(prov);
    } else {
        prov = model.api;
        mdl = model.model;
        voice = model.voice;
        url = model.url || getModelUrl(prov);
    }

    if (prov === 'openai') {
        return gptTTSConfig.sendAudioRequest(txt, mdl, voice, url);
    } else if (prov === 'kokoro') {
        const { generateKokoroAudio } = await import('./kokoro.js');
        return generateKokoroAudio(txt, voice || 'bm_george');
    } else if (prov === 'google') {
        return geminiTTSConfig.sendAudioRequest(txt, mdl, voice, url);
    } else {
        throw new Error(`TTS Provider ${prov} is not supported.`);
    }
}

async function processQueue() {
    isSpeaking = true;
    if (speakingQueue.length === 0) {
        isSpeaking = false;
        return;
    }
    const item = speakingQueue.shift();
    const { text: txt, model, audioData } = item;
    if (txt.trim() === '') {
        isSpeaking = false;
        processQueue();
        return;
    }

    const isWin = process.platform === 'win32';
    const isMac = process.platform === 'darwin';

    // wait for preprocessing if needed
    try {
        if (model !== 'system') {
            const start = Date.now();
            item.audioData = await fetchRemoteAudio(txt, model);
            console.log(
                `[TTS] Audio ready: ${(Date.now() - start) / 1000}s synthesis, ${(Date.now() - item.queuedAt) / 1000}s since queued`,
            );
            const isKokoro =
                typeof model === 'string' ? model.startsWith('kokoro/') : model.api === 'kokoro';
            if (isKokoro && item.version !== speechVersion) {
                isSpeaking = false;
                processQueue();
                return;
            }
        }
    } catch (err) {
        console.error('[TTS] preprocess error', err);
        isSpeaking = false;
        processQueue();
        return;
    }

    if (model === 'system') {
        if (isWin) {
            // Pass speech as encoded data, without cmd.exe interpreting the text.
            const textBase64 = Buffer.from(txt, 'utf8').toString('base64');
            const script = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; try { $s.Rate = 2; $s.Speak([System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${textBase64}'))) } finally { $s.Dispose() }`;
            const player = spawn(
                'powershell.exe',
                [
                    '-NoProfile',
                    '-NonInteractive',
                    '-EncodedCommand',
                    Buffer.from(script, 'utf16le').toString('base64'),
                ],
                {
                    windowsHide: true,
                    stdio: ['ignore', 'ignore', 'pipe'],
                },
            );
            let errorOutput = '';
            player.stderr.on('data', (chunk) => {
                errorOutput += chunk.toString();
            });
            player.on('error', (err) => console.error('TTS error', err));
            player.on('close', (code) => {
                if (code !== 0)
                    console.error(
                        'TTS error:',
                        errorOutput || `PowerShell exited with code ${code}`,
                    );
                isSpeaking = false;
                processQueue();
            });
            return;
        }
        // system TTS
        const cmd = isMac
            ? `say "${txt.replace(/"/g, '\\"')}"`
            : `espeak "${txt.replace(/"/g, '\\"')}"`;

        exec(cmd, (err) => {
            if (err) console.error('TTS error', err);
            isSpeaking = false;
            processQueue();
        });
    } else {
        // audioData was already fetched in speak()
        const audioData = item.audioData;

        if (!audioData) {
            console.error('[TTS] No audio data ready');
            isSpeaking = false;
            processQueue();
            return;
        }

        try {
            if (isWin) {
                const extension = (
                    typeof model === 'string' ? model.startsWith('kokoro/') : model.api === 'kokoro'
                )
                    ? 'wav'
                    : 'mp3';
                const tmpPath = path.join(os.tmpdir(), `tts_${Date.now()}.${extension}`);
                await fs.writeFile(tmpPath, Buffer.from(audioData, 'base64'));

                const player = spawn(
                    'ffplay',
                    ['-nodisp', '-autoexit', '-loglevel', 'quiet', tmpPath],
                    {
                        stdio: 'ignore',
                        windowsHide: true,
                    },
                );
                player.on('error', async (err) => {
                    console.error('[TTS] ffplay error', err);
                    try {
                        await fs.unlink(tmpPath);
                    } catch {}
                    isSpeaking = false;
                    processQueue();
                });
                player.on('exit', async () => {
                    try {
                        await fs.unlink(tmpPath);
                    } catch {}
                    isSpeaking = false;
                    processQueue();
                });
            } else {
                const player = spawn('ffplay', ['-nodisp', '-autoexit', 'pipe:0'], {
                    stdio: ['pipe', 'ignore', 'ignore'],
                });
                player.stdin.write(Buffer.from(audioData, 'base64'));
                player.stdin.end();
                player.on('exit', () => {
                    isSpeaking = false;
                    processQueue();
                });
            }
        } catch (e) {
            console.error('[TTS] Audio error', e);
            isSpeaking = false;
            processQueue();
        }
    }
}
