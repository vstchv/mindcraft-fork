# Local push-to-talk

Start Mindcraft normally with `npm run start`. In a second terminal in the project folder, run `npm run voice`. Wait for the Whisper model to load. The first launch downloads the free English speech model into `.cache/whisper/`.

Open http://localhost:8082 in a desktop browser. Click **Enable microphone** and allow microphone access. To choose another device, disable the microphone, choose it, and enable again. Keep this tab open. Hold **F8** while speaking in Minecraft, then release to send. You can also hold the panel's button. The global F8 helper is Windows-only.

The browser keeps the microphone enabled while this panel is enabled, but only records/transmits utterances while push-to-talk is held, with a 20-second limit. Processing stays on the desktop. Click **Disable**, close the tab, or stop the voice process to end the session. Use headphones to prevent feedback.

The voice bridge binds only to loopback, not the LAN or internet. It connects to the existing Mindcraft server and sends transcriptions as the `MINECRAFT_PLAYER` configured in your local `.env` to `andy`. Copy `.env.example` to `.env` and set `LM_STUDIO_URL` and `MINECRAFT_PLAYER` for your machine. To customize the agent or port, add `voice_chat: { player: "YourMinecraftName", agent: "andy", port: 8082 }` to `settings.js`. Restart the voice process afterward. No paid keys are used.

If no microphone is found, check Windows Settings → System → Sound → Input, headset Bluetooth hands-free mode, and Settings → Privacy & security → Microphone. Allow your browser to access the microphone. Click Disable before changing devices.

Stop with Ctrl+C in the voice terminal. If Andy is offline, recordings are rejected instead of queued. Speech recognition can make mistakes: read the last transcript in the panel. Normal spoken text is sent through Andy's model; transcripts containing direct `!command` syntax are rejected.
