import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let modelPromise;
export function prepareTranscriber() {
    if (!modelPromise)
        modelPromise = (async () => {
            const { pipeline, env } = await import('@huggingface/transformers');
            env.cacheDir = fileURLToPath(new URL('../../.cache/whisper/', import.meta.url));
            console.log('[Voice] Loading local Whisper (downloads files on first use).');
            return pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', {
                device: 'cpu',
                dtype: 'q8',
                session_options: { intra_op_num_threads: 4, inter_op_num_threads: 1 },
            });
        })().catch((error) => {
            modelPromise = undefined;
            throw error;
        });
    return modelPromise;
}

export async function transcribeAudio(buffer) {
    const model = await prepareTranscriber();
    const pcm = await new Promise((resolve, reject) => {
        const proc = spawn(
            'ffmpeg',
            [
                '-hide_banner',
                '-loglevel',
                'error',
                '-i',
                'pipe:0',
                '-ac',
                '1',
                '-ar',
                '16000',
                '-f',
                'f32le',
                'pipe:1',
            ],
            {
                windowsHide: true,
            },
        );
        const chunks = [];
        let errors = '';
        proc.stdout.on('data', (data) => chunks.push(data));
        proc.stderr.on('data', (data) => {
            errors += data.toString();
        });
        proc.on('error', reject);
        proc.stdin.on('error', () => {});
        proc.on('close', (code) =>
            code === 0
                ? resolve(Buffer.concat(chunks))
                : reject(new Error(errors || 'Audio conversion failed')),
        );
        proc.stdin.end(buffer);
    });
    const audio = new Float32Array(pcm.length / 4);
    for (let i = 0; i < audio.length; i++) audio[i] = pcm.readFloatLE(i * 4);
    if (audio.length < 4000) return '';
    const rms = Math.sqrt(audio.reduce((sum, value) => sum + value * value, 0) / audio.length);
    if (rms < 0.002) return '';
    const result = await model(audio, { max_new_tokens: 96 });
    return result.text.trim();
}
