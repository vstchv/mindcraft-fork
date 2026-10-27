import express from 'express';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { io as connect } from 'socket.io-client';
import open from 'open';
import settings from '../../settings.js';
import { prepareTranscriber, transcribeAudio } from './transcriber.js';

const app = express();
const server = http.createServer(app);
const port = settings.voice_chat?.port || 8082;
const io = new Server(server, {
    maxHttpBufferSize: 8 * 1024 * 1024,
    allowRequest: (req, callback) => {
        const origin = req.headers.origin;
        callback(
            null,
            !origin ||
                origin === `http://localhost:${port}` ||
                origin === `http://127.0.0.1:${port}`,
        );
    },
});
const bridge = connect(`http://localhost:${settings.mindserver_port}`);
const player = process.env.MINECRAFT_PLAYER || settings.voice_chat?.player || 'Player';
const agent = settings.voice_chat?.agent || 'andy';
let inGame = false;
let busy = false;
let activeClient;
let hotkeys;
bridge.on('agents-status', (agents) => {
    const list = Array.isArray(agents) ? agents : Object.values(agents);
    inGame = list.some((item) => item.name === agent && item.in_game);
});
bridge.on('connect', () => console.log('[Voice] Connected to Mindcraft.'));
bridge.on('disconnect', () => {
    inGame = false;
});
app.get('/capture-worklet.js', (_req, res) =>
    res.sendFile(fileURLToPath(new URL('./capture-worklet.js', import.meta.url))),
);
app.get('/', (_req, res) => res.sendFile(fileURLToPath(new URL('./voice.html', import.meta.url))));
io.on('connection', (socket) => {
    socket.emit('identity', { player, agent });
    socket.on('enable', () => {
        if (activeClient && activeClient !== socket) activeClient.emit('replaced');
        activeClient = socket;
    });
    socket.on('disable', () => {
        if (activeClient === socket) activeClient = undefined;
    });
    socket.on('disconnect', () => {
        if (activeClient === socket) activeClient = undefined;
    });
    socket.on('audio', async (data, done) => {
        const reply = typeof done === 'function' ? done : () => {};
        if (socket !== activeClient) return reply({ error: 'Enable this microphone panel first.' });
        if (busy) return reply({ error: 'Still transcribing the previous recording.' });
        if (!bridge.connected || !inGame)
            return reply({ error: 'Andy is not connected to the Minecraft world yet.' });
        if (!Buffer.isBuffer(data) || data.length > 8 * 1024 * 1024)
            return reply({ error: 'Invalid audio recording.' });
        busy = true;
        try {
            const started = Date.now();
            const text = await transcribeAudio(data);
            if (!text)
                return reply({
                    error: 'No clear speech detected. Try speaking closer to the microphone.',
                });
            // Speech is conversation, never a direct command injected by a mistranscription.
            if (/!\w/.test(text))
                return reply({
                    error: 'Please use ordinary spoken words, without command syntax.',
                });
            if (activeClient !== socket || !bridge.connected || !inGame)
                return reply({
                    error: 'Microphone disabled or Andy disconnected; message was not sent.',
                });
            bridge.emit('send-message', agent, { from: player, message: text, voice: true });
            console.log(
                `[Voice] ${player}: ${text} (${((Date.now() - started) / 1000).toFixed(1)}s)`,
            );
            reply({ text });
        } catch (error) {
            console.error('[Voice]', error);
            reply({ error: error.message });
        } finally {
            busy = false;
        }
    });
});

function startHotkeys() {
    if (process.platform !== 'win32') return;
    const script = `Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public class AndyVoiceKey { [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key); }'; $previous = $false; while ($true) { $down = ([AndyVoiceKey]::GetAsyncKeyState(119) -band 32768) -ne 0; if ($down -ne $previous) { if ($down) { [Console]::WriteLine('down') } else { [Console]::WriteLine('up') }; $previous = $down }; Start-Sleep -Milliseconds 30 }`;
    hotkeys = spawn(
        'powershell.exe',
        [
            '-NoProfile',
            '-NonInteractive',
            '-EncodedCommand',
            Buffer.from(script, 'utf16le').toString('base64'),
        ],
        {
            windowsHide: true,
        },
    );
    let pending = '';
    hotkeys.stdout.on('data', (data) => {
        pending += data.toString();
        const lines = pending.split(/\r?\n/);
        pending = lines.pop();
        for (const line of lines)
            if (line === 'down' || line === 'up') activeClient?.emit('ptt', line);
    });
    hotkeys.on('error', (error) =>
        console.error('[Voice] Global F8 unavailable; use the browser button.', error.message),
    );
}

async function start() {
    await prepareTranscriber();
    server.on('error', (error) => {
        console.error('[Voice]', error.message);
        shutdown();
    });
    server.listen(port, '127.0.0.1', () => {
        console.log(
            `[Voice] Ready: http://localhost:${port} — enable microphone, then hold F8 to talk.`,
        );
        startHotkeys();
        if (!process.argv.includes('--no-open'))
            open(`http://localhost:${port}`).catch((error) =>
                console.error('[Voice] Open the URL manually:', error.message),
            );
    });
}
function shutdown() {
    hotkeys?.kill();
    bridge.close();
    io.close();
    server.close();
    process.exit();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
start().catch((error) => {
    console.error('[Voice] Startup failed:', error);
    shutdown();
});
