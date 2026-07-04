// Shared offline JS mirror of native_modules/tube_oscillator -- the next
// weapon against aliasing after the DSF starter kit, and a completely
// different technique. DSF is alias-free by construction (a closed form
// that only ever contains harmonics under Nyquist). This oscillator is
// alias-*tamed* instead: a plain sine/parabolic phase run through a tanh
// saturation stage (the same soft-clip curve a vacuum tube or an analog
// waveshaper produces), with the saturation amount throttled down as
// pitch rises so the harmonics it injects stay controlled near Nyquist
// without ever computing a harmonic count.
//
// Faithful transcription of DistortionOscillator.hpp
// (soemdsp/include/soemdsp/oscillator/DistortionOscillator.hpp) and all
// ten of its Waveshape variants. JS has native Math.tanh/Math.acos/
// Math.log10/Math.log2, so no approximations are needed here (the native
// build uses its own, verified separately).

function createNodeGraphTubeOscillatorState() {
  return { phase: 0 };
}

function nodeGraphTubeParabolSine(x) {
  let xin = x;
  if (x > 0.5) xin = x - 0.5;
  xin = xin * 4 - 1;
  const a = xin * xin;
  if (x > 0.5) return -(1 - a) * (1 - a * 0.202);
  return (1 - a) * (1 - a * 0.202);
}

function nodeGraphTubeFreqToPitch(freq) {
  return 12 * Math.log2(freq / 440) + 69;
}

function nodeGraphTubeWrap01(x) {
  return x - Math.floor(x);
}

// options: { frequencyHz, sampleRate, waveform (0-9, see file header),
//            morph (0-1), level }
function nodeGraphTubeOscillatorSample(state, options = {}) {
  const sampleRate = Number(options.sampleRate) > 1 ? Number(options.sampleRate) : 48000;
  const safeFrequency = Number(options.frequencyHz) > 1 ? Number(options.frequencyHz) : 1;
  const dt = clampNodeSliderValue((Number(options.frequencyHz) || 0) / sampleRate, -0.5, 0.5);
  state.phase = nodeGraphTubeWrap01(state.phase + dt);
  const t = state.phase;

  const waveform = Math.round(Number(options.waveform) || 0);
  const level = Number(options.level) || 0;

  const quarterFreq = sampleRate * 0.25;
  const sineAmp = quarterFreq / (Math.log10(safeFrequency) * safeFrequency) * (Math.PI / 2) * 0.8;
  const m = clampNodeSliderValue(Number(options.morph) || 0, 0, 1);
  const morphFactor = Math.pow(m, 4) * 0.999 + 0.001;

  let sample;
  switch (waveform) {
    case 0: {  // AnalogSawSine
      const toSine = (t * 2 - 1) * Math.PI;
      sample = Math.tanh(Math.sin(toSine) * sineAmp * morphFactor) * Math.cos(toSine);
      break;
    }
    case 1: {  // AnalogSawParabol
      const shifted = nodeGraphTubeWrap01(t + 0.25);
      sample = Math.tanh(nodeGraphTubeParabolSine(t) * sineAmp * morphFactor) * nodeGraphTubeParabolSine(shifted);
      break;
    }
    case 2: {  // PerfectSaw
      const shifted = nodeGraphTubeWrap01(t + 0.25);
      const v = clampNodeSliderValue(
        Math.tanh(Math.sin(t * Math.PI * 2) * sineAmp * morphFactor) * Math.sin(shifted * Math.PI * 2),
        -1, 1);
      sample = Math.acos(v) / (Math.PI / 2) - 1;
      break;
    }
    case 3: {  // AnalogSquare
      const ps = nodeGraphTubeParabolSine(t);
      const shifted = nodeGraphTubeWrap01(t + 0.25);
      sample = Math.tanh(ps * sineAmp * morphFactor) *
               (Math.tanh(ps * sineAmp * 0.5 * morphFactor) * nodeGraphTubeParabolSine(shifted) * 0.5 + 0.5);
      break;
    }
    case 4: {  // Square
      sample = Math.tanh(nodeGraphTubeParabolSine(t) * sineAmp * morphFactor);
      break;
    }
    case 5: {  // Tri
      const adjustedMorphFactor = morphFactor * (1 - 0.15) + 0.15;
      const scaling = Math.tanh((1 - nodeGraphTubeFreqToPitch(safeFrequency) / 127) * 9);
      const v = clampNodeSliderValue(Math.sin(t * Math.PI * 2) * adjustedMorphFactor * scaling, -1, 1);
      sample = Math.acos(v) / Math.PI * 2 - 1;
      break;
    }
    case 6: {  // BowTri
      const bow = nodeGraphTubeParabolSine(t);
      sample = (Math.tanh(bow * sineAmp * morphFactor) * bow) * 2 - 1;
      break;
    }
    case 7: {  // DistortedBowTri
      const bow = nodeGraphTubeParabolSine(t);
      const sq = Math.tanh(bow * sineAmp * morphFactor);
      sample = Math.tanh(sq * bow * 2) * 2 - 1;
      break;
    }
    case 8: {  // WalterWave
      const bow = nodeGraphTubeParabolSine(t);
      const sq = Math.tanh(bow * sineAmp * morphFactor);
      sample = sq * 0.5 + 0.5 - Math.tanh(sq * bow * 2);
      break;
    }
    default:  // ParabolSine
      sample = nodeGraphTubeParabolSine(t);
      break;
  }

  if (!Number.isFinite(sample)) sample = 0;
  const out = clampNodeSliderValue(sample, -1.5, 1.5) * level;
  return { Out: out };
}
