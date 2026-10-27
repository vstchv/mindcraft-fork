class MicrophoneCapture extends AudioWorkletProcessor {
    constructor() {
        super();
        this.recording = false;
        this.frames = 0;
        this.port.onmessage = ({ data }) => {
            this.recording = data === 'start';
            if (data === 'stop') this.port.postMessage({ done: true });
        };
    }
    process(inputs) {
        const channel = inputs[0]?.[0];
        if (++this.frames % 20 === 0) {
            const rms = channel
                ? Math.sqrt(channel.reduce((sum, value) => sum + value * value, 0) / channel.length)
                : 0;
            this.port.postMessage({ level: rms });
        }
        if (this.recording && channel) this.port.postMessage({ samples: channel.slice() });
        return true;
    }
}
registerProcessor('microphone-capture', MicrophoneCapture);
