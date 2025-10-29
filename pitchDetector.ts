export class TuneDetector {
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private dataArray: Float32Array | null = null;
  private running = false;
  private animationFrameId: number | null = null;
  private lastDetectionTime = 0;
  private detectionInterval = 100; // ms between detections

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
    this.lastDetectionTime = performance.now();

    const detectLoop = () => {
      if (!this.running) return;
      
      const now = performance.now();
      if (now - this.lastDetectionTime >= this.detectionInterval) {
        this.detectPitch();
        this.lastDetectionTime = now;
      }
      
      this.animationFrameId = requestAnimationFrame(detectLoop);
    };
    
    this.animationFrameId = requestAnimationFrame(detectLoop);
  }

  stop() {
    this.running = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.audioContext?.close();
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
    // Optimized auto-correlation pitch detection
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

    // Optimized correlation: only compute for reasonable pitch range
    // Typical human voice: 80-1100 Hz, so lag from ~40 to ~550 samples at 44100 Hz
    const minLag = Math.floor(sampleRate / 1100);
    const maxLag = Math.min(Math.floor(sampleRate / 80), SIZE - 1);
    
    const c = new Float32Array(maxLag + 1);
    
    // Compute initial correlation for lag 0
    for (let j = 0; j < SIZE; j++) {
      c[0] += buffer[j] * buffer[j];
    }
    
    // Compute correlations for other lags (optimized loop)
    for (let i = 1; i <= maxLag; i++) {
      let sum = 0;
      for (let j = 0; j < SIZE - i; j++) {
        sum += buffer[j] * buffer[j + i];
      }
      c[i] = sum;
    }

    let d = minLag;
    while (d < maxLag && c[d] > c[d + 1]) d++;
    
    let maxval = -1, maxpos = -1;
    for (let i = d; i <= maxLag; i++) {
      if (c[i] > maxval) {
        maxval = c[i];
        maxpos = i;
      }
    }

    if (maxpos === -1 || maxpos < minLag) return -1;
    
    // Parabolic interpolation for better accuracy
    if (maxpos > 0 && maxpos < maxLag) {
      const y0 = c[maxpos - 1];
      const y1 = c[maxpos];
      const y2 = c[maxpos + 1];
      const a = (y0 + y2 - 2 * y1) / 2;
      if (a !== 0) {
        const offset = (y0 - y2) / (4 * a);
        return sampleRate / (maxpos + offset);
      }
    }
    
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
