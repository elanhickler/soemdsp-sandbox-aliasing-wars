// Shared offline JS mirror of native_modules/dsf_oscillator -- the DSF
// starter kit. See dsf_oscillator.cpp for the full derivation and design
// notes. SEVENTH REWRITE: adds Square (PWM), Trimorph, and a Saw/Square
// SquSaw on top of the verified base Saw + Harmonics.
//
// Square (PWM): square(t) = saw(t) - saw(t - pulseWidth). Subtracting a
// phase-shifted copy of an already-verified, alias-free Saw is itself
// alias-free -- no new closed form, no new singularity to chase.
// Trimorph: a second leaky integration on top of the (already bounded)
// Square output, with an adaptive peak-follower on top since -- unlike
// Square -- this second stage doesn't stay bounded on its own across the
// full frequency range (verified numerically before shipping).
// SquSaw: a plain crossfade between Saw and a fixed 50%-duty Square, kept
// deliberately decoupled from the PWM slider -- reported live as sounding
// "triangle-like" when it inherited PWM's variable duty cycle; simplified
// back to always crossfading two cleanly-shaped waveforms instead.
//
// EIGHTH REWRITE: every accumulator's retention now scales with the
// oscillation period (~20 periods of memory) instead of a fixed per-
// sample constant -- a fixed retention was far shorter than the period
// at low frequencies, so accumulators forgot mid-ramp and produced
// distorted, asymmetric shapes (Trimorph sounding like a square wave;
// DC asymmetry in Saw/Square/SquSaw). See dsf_oscillator.cpp for the full
// story.

function createNodeGraphDsfOscillatorState() {
  return { t: 0, sawAcc: 0, sqAcc: 0, blendSqAcc: 0, triAcc: 0, triPeak: 1, waltersAcc: 0 };
}

// ~20 periods of memory, decayed to ~1%.
function nodeGraphDsfAdaptiveRetention(dt) {
  return Math.exp(-0.23026 * dt);
}

// pureSawEng(t, n), transcribed and simplified directly from "Extended DSF
// Oscillators.cxx": sin(PI*t*(2N+1)) / sin(PI*t) - 1. Guarded at the
// removable singularity t=0 via its L'Hopital limit (2N+1).
function nodeGraphDsfPureSawEng(t, n) {
  const denom = Math.sin(Math.PI * t);
  if (denom > -1e-9 && denom < 1e-9) return (2 * n + 1) - 1;
  return Math.sin(Math.PI * t * (2 * n + 1)) / denom - 1;
}

// Harmonics (0-1): crossfades the harmonic count from 1 (a single
// harmonic, an exact sine) up to nMax (Nyquist/frequency).
function nodeGraphDsfPureSawEngMorphed(t, nMax, morph) {
  const m = clampNodeSliderValue(Number(morph) || 0, 0, 1);
  const target = 1 + m * (nMax - 1);
  const lowN = Math.max(1, Math.floor(target));
  const highN = Math.min(lowN + 1, nMax);
  const frac = target - lowN;
  return nodeGraphDsfPureSawEng(t, lowN) * (1 - frac) + nodeGraphDsfPureSawEng(t, highN) * frac;
}

function nodeGraphDsfWrap01(x) {
  return x - Math.floor(x);
}

// QuasiBandlimited saw/square, transcribed directly from
// "QuasiBandlimited.cxx" (Walter H. Hackett, "Direct Quasi-Bandlimited
// Oscillators (No-Integration)"): a genuinely different construction from
// pureSawEng above -- evaluated directly per-sample, no leaky integrator.
// Shapes a normalized Dirichlet kernel through a square root and restores
// odd symmetry via sign(sin(x)). m is forced to the nearest odd integer
// >= N+1 (matching the reference). Guarded at sin(x)==0 via the same
// L'Hopital limit used elsewhere in this module.
function nodeGraphDsfQuasiBandlimited(t, n, square) {
  const x = t * Math.PI * 2;
  let m = n + 1;
  if (m % 2 === 0) m += 1;
  const sinX = Math.sin(x);
  let inner;
  if (sinX > -1e-7 && sinX < 1e-7) {
    inner = 0;
  } else {
    inner = 1 - Math.sin(x * m) / (sinX * m);
  }
  const val = Math.sqrt(clampNodeSliderValue(inner, 0, 4));
  const sign = sinX < 0 ? -1 : 1;
  if (square) return sign * val;
  return sign * val * Math.cos(x);
}

// Walter's Saw, transcribed directly from Walter H. Hackett's own
// "optimized" pureWaltersSaw, sent with the explicit instruction "please
// combine with leaky integrator" -- the same accumulator pattern
// everything else in this module already uses. Guarded at the removable
// singularity sin(x)==0.
function nodeGraphDsfPureWaltersSaw(t, m) {
  const x = t * Math.PI * 2;
  const sinx = Math.sin(x);
  if (sinx > -1e-7 && sinx < 1e-7) return 0;
  const n = Math.floor((m - 1) * 0.5);
  const cosx = Math.cos(x);
  const cxn1 = Math.cos(x * (n + 1));
  const sxn1 = Math.sin(x * (n + 1));
  return -2 * (-cxn1 * (cosx * cxn1 + sxn1 * sinx - sxn1) / sinx + cosx / sinx);
}

function nodeGraphDsfPureWaltersSawMorphed(t, nMax, morph) {
  const m = clampNodeSliderValue(Number(morph) || 0, 0, 1);
  const target = 1 + m * (nMax - 1);
  const lowN = Math.max(1, Math.floor(target));
  const highN = Math.min(lowN + 1, nMax);
  const frac = target - lowN;
  return nodeGraphDsfPureWaltersSaw(t, lowN) * (1 - frac) + nodeGraphDsfPureWaltersSaw(t, highN) * frac;
}

// options: { frequencyHz, sampleRate, waveform (0=Sine,1=Saw,2=Square PWM,
//            3=Trimorph,4=SquSaw,5=Quasi Saw,6=Quasi Square,7=Walter's Saw),
//            morph (Harmonics, 0-1), pulseWidth (0-1), blend (0-1), level }
function nodeGraphDsfOscillatorSample(state, options = {}) {
  const sampleRate = Number(options.sampleRate) > 1 ? Number(options.sampleRate) : 48000;
  const safeFrequency = Number(options.frequencyHz) > 1 ? Number(options.frequencyHz) : 1;
  const dt = clampNodeSliderValue((Number(options.frequencyHz) || 0) / sampleRate, -0.5, 0.5);
  const waveform = Math.round(Number(options.waveform) || 0);
  const level = Number(options.level) || 0;

  let sample;
  if (waveform === 0) {
    state.t = nodeGraphDsfWrap01(state.t + dt);
    sample = Math.sin(state.t * Math.PI * 2);
  } else if (waveform === 7) {
    const nyquist = sampleRate * 0.5;
    const nMax = Math.max(1, Math.floor(nyquist / safeFrequency));
    state.t = nodeGraphDsfWrap01(state.t + dt * 0.9999);
    const retention = nodeGraphDsfAdaptiveRetention(dt);
    const raw = nodeGraphDsfPureWaltersSawMorphed(state.t, nMax, options.morph);
    state.waltersAcc = state.waltersAcc * retention + raw * dt;
    sample = state.waltersAcc;
  } else if (waveform === 5 || waveform === 6) {
    const nyquist = sampleRate * 0.5;
    const nMax = Math.max(1, Math.floor(nyquist / safeFrequency));
    state.t = nodeGraphDsfWrap01(state.t + dt * 0.9999);
    const m = clampNodeSliderValue(Number(options.morph) || 0, 0, 1);
    const target = 1 + m * (nMax - 1);
    const lowN = Math.max(1, Math.floor(target));
    const highN = Math.min(lowN + 1, nMax);
    const frac = target - lowN;
    const square = waveform === 6;
    const lowVal = nodeGraphDsfQuasiBandlimited(state.t, lowN, square);
    const highVal = nodeGraphDsfQuasiBandlimited(state.t, highN, square);
    sample = lowVal * (1 - frac) + highVal * frac;
  } else {
    const nyquist = sampleRate * 0.5;
    const nMax = Math.max(1, Math.floor(nyquist / safeFrequency));
    state.t = nodeGraphDsfWrap01(state.t + dt * 0.9999);

    const retention = nodeGraphDsfAdaptiveRetention(dt);
    const rawSaw = nodeGraphDsfPureSawEngMorphed(state.t, nMax, options.morph);
    state.sawAcc = state.sawAcc * retention + rawSaw * dt;

    if (waveform === 1) {
      sample = state.sawAcc;
    } else if (waveform === 4) {
      const rawBlendSquare = rawSaw - nodeGraphDsfPureSawEngMorphed(nodeGraphDsfWrap01(state.t - 0.5), nMax, options.morph);
      state.blendSqAcc = state.blendSqAcc * retention + rawBlendSquare * dt;
      const blend = clampNodeSliderValue(Number(options.blend) ?? 0.5, 0, 1);
      sample = state.sawAcc * (1 - blend) + state.blendSqAcc * blend;
    } else {
      const pw = clampNodeSliderValue(Number(options.pulseWidth) ?? 0.5, 0.01, 0.99);
      const rawShiftedSaw = nodeGraphDsfPureSawEngMorphed(nodeGraphDsfWrap01(state.t - pw), nMax, options.morph);
      const rawSquare = rawSaw - rawShiftedSaw;
      state.sqAcc = state.sqAcc * retention + rawSquare * dt;

      if (waveform === 2) {
        sample = state.sqAcc;
      } else {
        state.triAcc = state.triAcc * retention + state.sqAcc * dt * 4;
        // Compensate for the fundamental's own amplitude shrinking toward
        // 0 as pulseWidth approaches 0 or 1 (Trimorph mostly tracks
        // Square's fundamental, whose amplitude ~ sin(pi*pulseWidth)) --
        // reported live as Trimorph going quiet toward silence at extreme
        // PWM. Square itself doesn't need this (its higher harmonics keep
        // its peak swing roughly constant as duty cycle narrows).
        const compensation = 1 / clampNodeSliderValue(Math.abs(Math.sin(Math.PI * pw)), 0.05, 1);
        const compensatedTri = state.triAcc * compensation;
        state.triPeak = Math.max(1, state.triPeak * 0.999 + Math.abs(compensatedTri) * 0.001);
        sample = compensatedTri / state.triPeak;
      }
    }
  }

  if (!Number.isFinite(sample)) sample = 0;
  const out = clampNodeSliderValue(sample, -1.5, 1.5) * level;
  return { Out: out };
}
