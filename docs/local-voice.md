# Andy's local Kokoro voice

Kokoro runs inside Mindcraft on the desktop CPU. No speech API key or extra server is required. The first use downloads the model and selected voice from Hugging Face to `.cache/kokoro/`. Keep those files for later offline use. FFmpeg's `ffplay` must be on PATH for playback.

In `andy.json`, use:

```json
"speak_model": "kokoro/kokoro-82m/bm_george"
```

Keep `"speak": true` in `settings.js`. Restart Mindcraft after changing voices.

To change voices, update the last segment of `speak_model`, for example to `am_michael` (American male) or `af_heart` (American female). Each voice may need a first-time download.

Audio plays through the desktop's default output. If silent, check Windows Volume Mixer for ffplay. To restore Windows speech, set `"speak_model": "system"`.

Kokoro warms up when Andy starts. Replies are synthesized in short phrases so playback can begin before the whole reply is ready. Language-model generation still finishes before speech begins; this does not stream tokens from LM Studio.

The desktop uses the fp32 model with four inference threads, measured faster here than q8. The model download is approximately 326 MB. New replies discard older pending speech to prevent a growing backlog; an already playing phrase finishes first. `[TTS] Audio ready` logs show synthesis and queue timing.

This adds spoken replies only; microphone transcription is separate.
