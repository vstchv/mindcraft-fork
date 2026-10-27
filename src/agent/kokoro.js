import { fileURLToPath } from 'node:url';

const cacheDir = fileURLToPath(new URL('../../.cache/kokoro/', import.meta.url));
let enginePromise;
let generationQueue = Promise.resolve();

async function getEngine() {
    if (!enginePromise) {
        enginePromise = (async () => {
            const { KokoroTTS } = await import('kokoro-js');
            const { env, StyleTextToSpeech2Model, AutoTokenizer } =
                await import('@huggingface/transformers');
            env.cacheDir = cacheDir;
            console.log('[Kokoro] Loading local voice model (first use downloads model files)...');
            const modelId = 'onnx-community/Kokoro-82M-v1.0-ONNX';
            // Benchmarked on this desktop: fp32 is substantially faster than q8.
            const [model, tokenizer] = await Promise.all([
                StyleTextToSpeech2Model.from_pretrained(modelId, {
                    dtype: 'fp32',
                    device: 'cpu',
                    session_options: { intra_op_num_threads: 4, inter_op_num_threads: 1 },
                }),
                AutoTokenizer.from_pretrained(modelId),
            ]);
            return new KokoroTTS(model, tokenizer);
        })().catch((error) => {
            enginePromise = undefined;
            throw error;
        });
    }
    return enginePromise;
}

export function generateKokoroAudio(text, voice = 'bm_george') {
    const result = generationQueue.then(async () => {
        const engine = await getEngine();
        // Split long replies at sentence boundaries instead of silently truncating them.
        const chunks = [];
        const sentences = text.split(/(?<=[.!?])\s+|\n+/).filter((part) => part.trim());
        for (const sentence of sentences) {
            // Short word groups also bound sentences without punctuation.
            const words = sentence.trim().split(/\s+/);
            for (let i = 0; i < words.length; i += 60) {
                chunks.push(await engine.generate(words.slice(i, i + 60).join(' '), { voice }));
            }
        }
        if (!chunks.length) throw new Error('Kokoro produced no audio.');
        const samples = new Float32Array(
            chunks.reduce((sum, chunk) => sum + chunk.audio.length, 0),
        );
        let offset = 0;
        for (const chunk of chunks) {
            samples.set(chunk.audio, offset);
            offset += chunk.audio.length;
        }
        const { RawAudio } = await import('@huggingface/transformers');
        const wav = new RawAudio(samples, chunks[0].sampling_rate).toWav();
        return Buffer.from(wav).toString('base64');
    });
    generationQueue = result.catch(() => {});
    return result;
}
