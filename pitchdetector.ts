export class TuneDetector {
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private dataArray: Float32Array | null = null;
  private running = false;
  private intervalId: number | null = null;

  constructor(private onNoteDetected: (note: string, freq: number) => void) {}

  async start() {
    if (this.running) return;

    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.source = this.audioContext.createMediaStreamSource(stream);

    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 2048;
    this.dataArray = new Float32Array(this.analyser.fftSize);
    this.source.connect(this.analyser);

    this.running = true;

    this.intervalId = window.setInterval(() => this.detectPitch(), 1000);
  }

  stop() {
    this.running = false;
    if (this.intervalId) clearInterval(this.intervalId);
    this.audioContext?.close();
    this.intervalId = null;
  }

  private detectPitch() {
    if (!this.analyser || !this.dataArray) return;

    this.analyser.getFloatTimeDomainData(this.dataArray);
    const freq = this.autoCorrelate(this.dataArray, this.audioContext!.sampleRate);

    if (freq > 0) {
      const note = this.freqToNote(freq);
      this.onNoteDetected(note, freq);
    }
  }

  private autoCorrelate(buffer: Float32Array, sampleRate: number): number {
    // Standard auto-correlation pitch detection
    let SIZE = buffer.length;
    let rms = 0;
    for (let i = 0; i < SIZE; i++) rms += buffer[i] * buffer[i];
    rms = Math.sqrt(rms / SIZE);
    if (rms < 0.01) return -1; // too quiet

    let r1 = 0, r2 = SIZE - 1, thres = 0.2;
    for (let i = 0; i < SIZE / 2; i++) if (Math.abs(buffer[i]) < thres) { r1 = i; break; }
    for (let i = 1; i < SIZE / 2; i++) if (Math.abs(buffer[SIZE - i]) < thres) { r2 = SIZE - i; break; }

    buffer = buffer.slice(r1, r2);
    SIZE = buffer.length;

    const c = new Array(SIZE).fill(0);
    for (let i = 0; i < SIZE; i++)
      for (let j = 0; j < SIZE - i; j++)
        c[i] = c[i] + buffer[j] * buffer[j + i];

    let d = 0;
    while (c[d] > c[d + 1]) d++;
    let maxval = -1, maxpos = -1;
    for (let i = d; i < SIZE; i++) {
      if (c[i] > maxval) {
        maxval = c[i];
        maxpos = i;
      }
    }

    if (maxpos === -1) return -1;
    return sampleRate / maxpos;
  }

  private freqToNote(freq: number): string {
    const A4 = 440;
    const notes = [
      "C", "C#", "D", "D#", "E", "F",
      "F#", "G", "G#", "A", "A#", "B"
    ];

    const n = Math.round(12 * Math.log2(freq / A4)) + 57; // 57 is MIDI for A4
    const octave = Math.floor(n / 12) - 1;
    const noteName = notes[(n % 12 + 12) % 12];
    return `${noteName}${octave}`;
  }
}
