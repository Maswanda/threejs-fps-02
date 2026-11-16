// Synthesised sound effects: no audio files, everything is built from oscillators and
// filtered noise at runtime, so the game loads nothing over the network.
export function createAudio() {
  let context = null;
  let master = null;
  let muted = false;

  function ensure() {
    if (context) {
      if (context.state === 'suspended') context.resume();
      return true;
    }
    try {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return false;
      context = new Ctor();
      master = context.createGain();
      master.gain.value = 0.32;
      master.connect(context.destination);
      return true;
    } catch {
      return false;
    }
  }

  function noiseBuffer(seconds) {
    const length = Math.max(1, Math.floor(context.sampleRate * seconds));
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function burst({ duration, frequency, type = 'sine', gain = 0.5, slideTo = null, noise = false, filterFreq = null }) {
    if (!ensure() || muted) return;
    const t = context.currentTime;
    const out = context.createGain();
    out.gain.setValueAtTime(gain, t);
    out.gain.exponentialRampToValueAtTime(0.001, t + duration);
    out.connect(master);
    if (noise) {
      const source = context.createBufferSource();
      source.buffer = noiseBuffer(duration);
      if (filterFreq) {
        const filter = context.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = filterFreq;
        source.connect(filter);
        filter.connect(out);
      } else {
        source.connect(out);
      }
      source.start(t);
      source.stop(t + duration);
    } else {
      const osc = context.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(frequency, t);
      if (slideTo !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + duration);
      osc.connect(out);
      osc.start(t);
      osc.stop(t + duration);
    }
  }

  return {
    unlock() {
      ensure();
    },
    toggleMute() {
      muted = !muted;
      return muted;
    },
    get muted() {
      return muted;
    },
    shot(kind) {
      if (kind === 'rifle') {
        burst({ duration: 0.11, gain: 0.5, noise: true, filterFreq: 2400 });
        burst({ duration: 0.09, frequency: 150, slideTo: 55, gain: 0.45 });
      } else if (kind === 'smg') {
        burst({ duration: 0.08, gain: 0.38, noise: true, filterFreq: 3200 });
        burst({ duration: 0.06, frequency: 190, slideTo: 80, gain: 0.3 });
      } else if (kind === 'pistol') {
        burst({ duration: 0.09, gain: 0.42, noise: true, filterFreq: 2800 });
        burst({ duration: 0.07, frequency: 170, slideTo: 70, gain: 0.35 });
      } else {
        burst({ duration: 0.1, gain: 0.3, noise: true, filterFreq: 1800 });
      }
    },
    distantShot() {
      burst({ duration: 0.09, gain: 0.12, noise: true, filterFreq: 900 });
    },
    reload() {
      burst({ duration: 0.05, frequency: 900, type: 'square', gain: 0.12 });
      setTimeout(() => burst({ duration: 0.05, frequency: 620, type: 'square', gain: 0.12 }), 260);
    },
    dryFire() {
      burst({ duration: 0.04, frequency: 1400, type: 'square', gain: 0.1 });
    },
    hit() {
      burst({ duration: 0.06, frequency: 1150, type: 'triangle', gain: 0.28 });
    },
    kill() {
      burst({ duration: 0.09, frequency: 880, type: 'triangle', gain: 0.3 });
      setTimeout(() => burst({ duration: 0.12, frequency: 1320, type: 'triangle', gain: 0.28 }), 70);
    },
    hurt() {
      burst({ duration: 0.14, frequency: 220, slideTo: 110, gain: 0.35 });
    },
    beep(final) {
      burst({ duration: final ? 0.3 : 0.09, frequency: final ? 1560 : 1040, type: 'sine', gain: 0.22 });
    },
    plant() {
      burst({ duration: 0.12, frequency: 700, type: 'square', gain: 0.2 });
      setTimeout(() => burst({ duration: 0.12, frequency: 700, type: 'square', gain: 0.2 }), 160);
    },
    explosion() {
      burst({ duration: 0.9, gain: 0.85, noise: true, filterFreq: 420 });
      burst({ duration: 0.7, frequency: 90, slideTo: 28, gain: 0.8 });
    },
    grenadePin() {
      burst({ duration: 0.04, frequency: 1800, type: 'square', gain: 0.14 });
    },
    bounce() {
      burst({ duration: 0.05, frequency: 320, type: 'sine', gain: 0.16 });
    },
    buy() {
      burst({ duration: 0.07, frequency: 660, type: 'triangle', gain: 0.22 });
      setTimeout(() => burst({ duration: 0.09, frequency: 990, type: 'triangle', gain: 0.2 }), 60);
    },
    roundStart() {
      burst({ duration: 0.16, frequency: 520, type: 'triangle', gain: 0.25 });
      setTimeout(() => burst({ duration: 0.2, frequency: 780, type: 'triangle', gain: 0.25 }), 140);
    },
    roundWin() {
      [523, 659, 784].forEach((f, i) => setTimeout(() => burst({ duration: 0.18, frequency: f, type: 'triangle', gain: 0.24 }), i * 110));
    },
    roundLose() {
      [392, 330, 262].forEach((f, i) => setTimeout(() => burst({ duration: 0.2, frequency: f, type: 'triangle', gain: 0.22 }), i * 120));
    },
    step() {
      burst({ duration: 0.05, gain: 0.05, noise: true, filterFreq: 500 });
    },
  };
}
