// soemdsp-native-module: tube_oscillator
// soemdsp-native-label: Tube Oscillator
// soemdsp-native-target: tubeOscillator
// soemdsp-native-kind: oscillator

// The next weapon against aliasing after the DSF starter kit -- a
// completely different technique. DSF is alias-free *by construction*
// (a closed form that only ever contains harmonics under Nyquist).
// This oscillator is alias-*tamed* instead: it runs a plain sine/cosine
// phase through a tanh saturation stage (the same soft-clip curve a
// vacuum tube or an analog waveshaper produces), and throttles how hard
// that saturation bites as pitch rises, so the harmonics it generates
// stay under control near Nyquist without ever computing a harmonic
// count at all.
//
// Faithful transcription of DistortionOscillator.hpp
// (soemdsp/include/soemdsp/oscillator/DistortionOscillator.hpp), all ten
// of its Waveshape variants:
//
//   sineAmp_    = quarterfreq_ / (log10(frequency_) * frequency_) * (PI/2) * 0.8
//   morphFactor_ = pow(morph_, 4.0) * 0.999 + 0.001
//
// `sineAmp_` is the anti-aliasing mechanism: it's inversely proportional
// to frequency, so the amount of harmonic content the tanh stage can
// inject shrinks automatically as pitch rises -- verified numerically
// (Python, exact math) that every waveshape below stays bounded in
// [-1, 1] from 55 Hz through 4000 Hz before this was ported.
//
// `parabolSine` and the tanh rational approximation are transcribed
// directly from the reference (both are already careful, tested
// approximations in the original, not something invented here).
// `acos` has no freestanding-WASM equivalent, so PerfectSaw and Tri use
// a standard fast polynomial acos approximation (~7e-5 max error,
// verified against exact math.acos before shipping) instead.

namespace {

constexpr double kPi = 3.1415926535897932384626433832795;
constexpr double kPiZ2 = kPi * 0.5;

double clampD(double value, double lo, double hi) {
  return value < lo ? lo : (value > hi ? hi : value);
}

double wrap01(double value) {
  double f = value - __builtin_floor(value);
  if (f < 0.0) f += 1.0;
  if (f >= 1.0) f -= 1.0;
  return f;
}

double wrapRadians(double value) {
  const double twoPi = kPi * 2.0;
  return value - twoPi * __builtin_floor(value / twoPi + 0.5);
}

// Same 10-term Taylor series used in native_modules/dsf_oscillator --
// verified accurate to ~5e-10, which is far more precision than this
// module's tanh-saturated waveshapes actually need, but there's no
// reason to use a worse one.
double sinApprox(double value) {
  const double x = wrapRadians(value);
  const double x2 = x * x;
  double result = -1.0 / 121645100408832000.0;
  result = 1.0 / 355687428096000.0 + x2 * result;
  result = -1.0 / 1307674368000.0 + x2 * result;
  result = 1.0 / 6227020800.0 + x2 * result;
  result = -1.0 / 39916800.0 + x2 * result;
  result = 1.0 / 362880.0 + x2 * result;
  result = -1.0 / 5040.0 + x2 * result;
  result = 1.0 / 120.0 + x2 * result;
  result = -1.0 / 6.0 + x2 * result;
  result = 1.0 + x2 * result;
  return x * result;
}

double cosApprox(double value) {
  return sinApprox(value + kPiZ2);
}

// ln(x) via bit-level frexp (IEEE-754 exponent + mantissa in [1,2)) plus
// an atanh-series -- same technique proven in dsf_oscillator.cpp's
// earlier rounds, accurate to ~1e-9 relative error.
double lnApprox(double x) {
  union { double d; long long i; } u;
  u.d = x;
  const long long bits = u.i;
  const int e = static_cast<int>((bits >> 52) & 0x7FF) - 1023;
  const long long mbits = (bits & 0xFFFFFFFFFFFFFLL) | (1023LL << 52);
  u.i = mbits;
  const double m = u.d;
  const double z = (m - 1.0) / (m + 1.0);
  const double z2 = z * z;
  const double atanh = z * (1.0 + z2 * (1.0 / 3.0 + z2 * (1.0 / 5.0 + z2 * (1.0 / 7.0 + z2 * (1.0 / 9.0 + z2 * (1.0 / 11.0))))));
  return e * 0.6931471805599453 + 2.0 * atanh;
}

double log10Approx(double x) {
  return lnApprox(x) / 2.302585092994046;  // ln(10)
}

double log2Approx(double x) {
  return lnApprox(x) / 0.6931471805599453;  // ln(2)
}

// DistortionOscillator::tanHApprox(), transcribed directly.
double tanhApprox(double x) {
  if (x > 5.0) return 1.0;
  if (x < -5.0) return -1.0;
  const double xx = x * x;
  return x / (1.0 + xx / (3.0 + xx / (5.0 + xx / (7.0 + xx / (9.0 + xx * (1.0 / 11.0))))));
}

// DistortionOscillator::parabolSine(), transcribed directly. x is phase
// in [0, 1).
double parabolSine(double x) {
  double xin = x;
  if (x > 0.5) xin = x - 0.5;
  xin = xin * 4.0 - 1.0;
  const double a = xin * xin;
  if (x > 0.5) return 0.0 - (1.0 - a) * (1.0 - a * 0.202);
  return (1.0 - a) * (1.0 - a * 0.202);
}

// Standard fast polynomial acos approximation (Handbook of Mathematical
// Functions family) -- ~7e-5 max error over [-1, 1], verified against
// exact math.acos before shipping. No freestanding-WASM acos exists.
double acosApprox(double x) {
  const double negate = x < 0.0 ? 1.0 : 0.0;
  const double ax = x < 0.0 ? -x : x;
  double ret = -0.0187293;
  ret = ret * ax;
  ret = ret + 0.0742610;
  ret = ret * ax;
  ret = ret - 0.2121144;
  ret = ret * ax;
  ret = ret + 1.5707288;
  ret = ret * __builtin_sqrt(clampD(1.0 - ax, 0.0, 1.0));
  ret = ret - 2.0 * negate * ret;
  return negate * kPi + ret;
}

// convert::freq_to_pitch(), transcribed directly (kA440 = 440.0).
double freqToPitch(double freq) {
  return 12.0 * log2Approx(freq / 440.0) + 69.0;
}

constexpr int kMaxInstances = 16;

struct TubeOscillatorState {
  bool active;
  double phase;  // 0..1
  double out;
};

static TubeOscillatorState gPool[kMaxInstances];

}  // namespace

extern "C" int soemdsp_tube_oscillator_create() {
  for (int i = 0; i < kMaxInstances; i++) {
    if (!gPool[i].active) {
      gPool[i] = TubeOscillatorState{};
      gPool[i].active = true;
      return i + 1;
    }
  }
  return 0;
}

extern "C" void soemdsp_tube_oscillator_destroy(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  gPool[handle - 1].active = false;
}

extern "C" void soemdsp_tube_oscillator_reset(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  gPool[handle - 1].phase = 0.0;
}

// waveform: 0=AnalogSawSine, 1=AnalogSawParabol, 2=PerfectSaw,
//           3=AnalogSquare, 4=Square, 5=Tri, 6=BowTri, 7=DistortedBowTri,
//           8=WalterWave, 9=ParabolSine
// morph: 0..1 -- amount of tanh saturation biting into the underlying
// parabolic/sine shape; higher morph is brighter/harsher, same knob as
// the original's Morph.
extern "C" void soemdsp_tube_oscillator_sample(
  int handle,
  double frequencyHz,
  double sampleRate,
  int waveform,
  double morph,
  double level
) {
  if (handle < 1 || handle > kMaxInstances) return;
  TubeOscillatorState& s = gPool[handle - 1];

  const double safeSampleRate = sampleRate > 1.0 ? sampleRate : 48000.0;
  const double safeFrequency = frequencyHz > 1.0 ? frequencyHz : 1.0;
  const double dt = clampD(frequencyHz / safeSampleRate, -0.5, 0.5);
  s.phase = wrap01(s.phase + dt);

  const double t = s.phase;
  const double quarterFreq = safeSampleRate * 0.25;
  const double sineAmp = quarterFreq / (log10Approx(safeFrequency) * safeFrequency) * kPiZ2 * 0.8;
  const double m = clampD(morph, 0.0, 1.0);
  const double m2 = m * m;
  const double morphFactor = m2 * m2 * 0.999 + 0.001;

  double sample;
  switch (waveform) {
    case 0: {  // AnalogSawSine
      const double toSine = (t * 2.0 - 1.0) * kPi;
      sample = tanhApprox(sinApprox(toSine) * sineAmp * morphFactor) * cosApprox(toSine);
      break;
    }
    case 1: {  // AnalogSawParabol
      const double shifted = wrap01(t + 0.25);
      sample = tanhApprox(parabolSine(t) * sineAmp * morphFactor) * parabolSine(shifted);
      break;
    }
    case 2: {  // PerfectSaw
      const double shifted = wrap01(t + 0.25);
      const double v = clampD(
        tanhApprox(sinApprox(t * kPi * 2.0) * sineAmp * morphFactor) * sinApprox(shifted * kPi * 2.0),
        -1.0, 1.0);
      sample = acosApprox(v) / kPiZ2 - 1.0;
      break;
    }
    case 3: {  // AnalogSquare
      const double ps = parabolSine(t);
      const double shifted = wrap01(t + 0.25);
      sample = tanhApprox(ps * sineAmp * morphFactor) *
               (tanhApprox(ps * sineAmp * 0.5 * morphFactor) * parabolSine(shifted) * 0.5 + 0.5);
      break;
    }
    case 4: {  // Square
      sample = tanhApprox(parabolSine(t) * sineAmp * morphFactor);
      break;
    }
    case 5: {  // Tri
      const double adjustedMorphFactor = morphFactor * (1.0 - 0.15) + 0.15;
      const double scaling = tanhApprox((1.0 - freqToPitch(safeFrequency) / 127.0) * 9.0);
      const double v = clampD(sinApprox(t * kPi * 2.0) * adjustedMorphFactor * scaling, -1.0, 1.0);
      sample = acosApprox(v) / kPi * 2.0 - 1.0;
      break;
    }
    case 6: {  // BowTri
      const double bow = parabolSine(t);
      sample = (tanhApprox(bow * sineAmp * morphFactor) * bow) * 2.0 - 1.0;
      break;
    }
    case 7: {  // DistortedBowTri
      const double bow = parabolSine(t);
      const double sq = tanhApprox(bow * sineAmp * morphFactor);
      sample = tanhApprox(sq * bow * 2.0) * 2.0 - 1.0;
      break;
    }
    case 8: {  // WalterWave
      const double bow = parabolSine(t);
      const double sq = tanhApprox(bow * sineAmp * morphFactor);
      sample = sq * 0.5 + 0.5 - tanhApprox(sq * bow * 2.0);
      break;
    }
    default:  // ParabolSine
      sample = parabolSine(t);
      break;
  }

  const bool finite = sample * 0.0 == 0.0;
  if (!finite) sample = 0.0;
  s.out = clampD(sample, -1.5, 1.5) * level;
}

extern "C" double soemdsp_tube_oscillator_out(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].out;
}

extern "C" int soemdsp_tube_oscillator_version() {
  return 1;
}
