# ⚔️ soemdsp-sandbox 🛡️

## Live Demo: http://soundemote.io/sandbox

Browser sandbox for trying `soemdsp` patching, generated artifacts, waveform
views, Render Sample, and Live Audio.

## ⚔️💥 Aliasing wars: the Surge Oscillator 🛡️🧨

This branch (`aliasing-wars`) is a dedicated workspace for anti-aliased
oscillator work, starting with `native_modules/surge_oscillator` — a
saw/square/tri/sine oscillator with hard sync.

> 🎚️ The name is a play on the [**loudness war**](https://en.wikipedia.org/wiki/Loudness_war) —
> the decades-long race among mastering engineers to make recordings louder
> and louder, at the cost of dynamic range. This branch is the same kind of
> arms race, fought over a different quantity: not loudness, but how much
> unwanted high-frequency garbage a digital oscillator sneaks in above
> Nyquist. Same shape of fight, aliasing instead of loudness.

**💣 The problem.** Hard sync forces a slave oscillator's phase back to 0 every
time a master signal crosses zero going up. That forced reset is a
discontinuity injected mid-waveform — a little 🧨 detonating mid-cycle — and
rendering it naively (just snapping `phase = 0`, with no correction) aliases
badly: 💥 the classic harsh, digital buzz under a sync sweep.

**⚡🔧 The fix, in two parts:**

1. **PolyBLEP correction reused, not reinvented.** This sandbox's existing
   `polyblep.cpp` module already band-limits ordinary cycle wraps with a
   PolyBLEP correction. A sync-forced reset and a natural wrap are the same
   kind of event from the waveform function's point of view — phase lands
   near 0 — so `surge_oscillator.cpp` reuses the identical
   `polyBlep`/`polyBlepSquare`/triangle-integrator functions unchanged. Every
   reset, sync-forced or natural, gets band-limited for free.
2. **Sub-sample sync timing.** Sync input is read once per sample, but a real
   zero-crossing can happen anywhere within that sample. Instead of always
   resetting to exactly `phase = 0` (which quantizes sync timing to the
   sample rate and adds its own jitter/aliasing at high sync ratios), the
   module linearly interpolates the crossing time within the sample and
   starts the new cycle already `frac` of the way in — the same idea Surge
   and other analog-modeling synths use for sync-aware oscillators.

**🔬📡 Verified, not assumed.** The compiled `.wasm` is tested against a
Python + `wasmtime` harness exercising the real artifact directly (27
assertions: pool exhaustion, waveform selection, level scaling, edge-triggered
sync detection, and — the part that actually matters — proof that early vs.
late sync crossings within the same sample produce measurably different
output, confirming the sub-sample interpolation is doing real work and not a
no-op).

**Ports:** `0.1V/Oct` (pitch) and `Sync` (audio-rate signal; a rising
zero-crossing triggers the reset) in; `Out` (the selected waveform), `Saw`,
`Square`, `Tri`, `Sine` (always-on taps, like `polyblep.cpp`'s convention),
`Synced` (a one-sample-wide pulse on the sample where a sync reset fired,
for chaining/visualizing), and `Internal Sync` (the built-in master
oscillator's raw signal, for inspection) out. Native C++/WASM with a JS
fallback, wired into both the offline evaluator and the realtime audio
worklet.

**🚁🛩️ Built-in sync source.** Patching a real oscillator into `Sync` still
works, but most hard-sync sweeps don't need a second module just to get
one — the oscillator owns its own internal master oscillator (`Sync Freq`,
0–20000 Hz, same range as the audible `Frequency`). With nothing patched
into `Sync`, the internal oscillator's zero-crossings drive the exact same
sub-sample-interpolated reset path external audio would — a self-contained
hard-sync sweep with two knobs and zero patch cables. Patch something into
`Sync` and it takes over completely; the internal oscillator is a
convenience default, not an extra mandatory step.

## 🎛️⚡🔬 Alias-free oscillator study: the DSF technique 🧲

Studied `C:\Users\argit\Documents\_PROGRAMMING\soemdsp\include\soemdsp\oscillator\DSFOscillator.hpp`
(Walter Hackett's alias-free oscillator) as a second angle on the aliasing
mission, distinct from PolyBLEP.

> 🔍 **A note on attribution.** No public record turns up connecting a
> "Walter Hackett" to DSF synthesis or alias-free oscillator design — the
> technique itself is academically documented back to **James A. Moorer's**
> 1975/76 Stanford CCRMA work, *"The Synthesis of Complex Audio Spectra by
> Means of Discrete Summation Formulas,"* and the derivation below is
> Moorer's. But the connection here is personal, not academic: **Walter
> Hackett is who introduced this concept**, the person this implementation's
> lineage actually traces back to for the team working on it — that's a real
> and separate thing from who first published the math, and both are true
> at once.

**The core idea is fundamentally different from PolyBLEP.** PolyBLEP starts
from a naive discontinuous waveform (a hard saw/square edge) and *corrects*
the discontinuity after the fact with a band-limited step function. DSF
(Discrete Summation Formula) synthesis never generates the discontinuity in
the first place — it computes the waveform directly from a **closed-form
trigonometric sum** of a bounded number of harmonics (`numPartials_ =
Nyquist / frequency`, recalculated on every frequency change). Because the
partial count is derived from the Nyquist limit, the waveform is alias-free
*by construction* — there's nothing above Nyquist to alias, rather than
something being suppressed after the fact.

**What's in the file:**
- `DSFOscillatorBase` — shared machinery: a phase accumulator (`calculateState()`),
  a leaky integrator (`leak_`) that fades in the amplitude-adjusted output
  over time (looks aimed at taming attack transients), and a `Wire`-based
  parameter system (`pointTo()`/`slave()`) that lets multiple oscillator
  instances share phase and morph state — a lightweight master/slave
  patch-cable primitive, conceptually similar to this sandbox's node wires
  but scoped to parameter sharing rather than the whole graph.
- `DSFOscillatorSineSaw` — continuously morphs sine → saw via a single
  `morph_` parameter (0–1), which reshapes a `k_`/`k2_`/`k42_` coefficient
  set feeding the closed-form DSF sum.
- `DSFOscillatorSineSquare` — same idea, sine → square, with its own
  coefficient derivation and partial-count halving (`/ 2.0`).

### 🧮⚙️ How the equation was derived 🔩

<div align="center">
<img src="docs/assets/dsf-derivation.svg" alt="Four-step derivation: an infinite geometrically-decaying harmonic sum is rewritten as a complex exponential, collapsed by the geometric series identity, and reduced to one closed-form trig equation" width="90%"/>
</div>

The derivation is genuinely elegant, and the trick is one line of algebra
doing all the work:

1. 🎵 **Start with the sound you actually want** — infinitely many harmonics,
   each quieter than the last by a fixed ratio `a` (0 ≤ a < 1):
   `y(θ) = Σ aⁿ·sin((n+1)θ)` for `n = 0…∞`. This is a real, audible,
   band-unlimited signal — completely impractical to compute directly,
   since it's an infinite sum.
2. 🌀 **Rewrite it with complex exponentials.** Euler's formula
   (`e^{ix} = cos x + i·sin x`) turns each `sin` term into the imaginary
   part of a complex exponential, and — this is the useful part — turns the
   whole sum into `Σ aⁿ e^{i(n+1)θ}`, which factors into
   `e^{iθ} · Σ (a·e^{iθ})ⁿ`.
3. 💥 **The geometric series identity collapses it.** `Σ rⁿ = 1/(1−r)` for
   any `|r| < 1`, summed to infinity — one of the oldest identities in
   algebra. Substituting `r = a·e^{iθ}` turns the *infinite sum* into *a
   single fraction*, no loop, no series, nothing left to add up.
4. ✅ **Take the imaginary part and you have your closed-form oscillator.**
   What comes out is one trigonometric expression in `θ`, `a`, and the
   partial count — exactly the shape of the `DSF()` function in the code
   (`k_` is `a`, `numPartials_` is the harmonic count, `dsfState_` is `θ`).
   Every sample, the oscillator evaluates that one closed-form line instead
   of summing any harmonics at all — which is *also* why it's fast: the
   "summation" in Discrete Summation Formula happened once, on paper, in
   1976, not once per sample at runtime.

The alias-free property falls out of the same math: because the harmonic
count feeding the closed form is derived from `Nyquist / frequency`, the
formula only ever represents harmonics that fit under Nyquist. There's
nothing above the limit to alias in the first place — the geometric series
identity that makes the equation *fast* is the same one that makes it
*clean*.

**The file is honest about its own problems** — the header comment block
lists them directly: attack causes an amplitude spike, volume is
inconsistent across `morph_` and across frequency, harmonics visibly "click"
in and out as frequency rises (consistent with `numPartials_` changing in
integer-ish steps with no smoothing between values), the saw/square volumes
don't match each other, and square gets dull at low frequency. None of these
are aliasing bugs — DSF's alias-free guarantee holds regardless — they're
amplitude-normalization and transient issues layered on top of a
mathematically sound core.

**Takeaway for this mission:** PolyBLEP (what Surge Oscillator uses) and DSF
solve the same problem from opposite directions — correct the edge vs. never
create the edge — and the tradeoffs are different too: DSF needs a live
partial-count recalculation per frequency change (cheap, but is exactly
where this implementation's harmonic "clicking" comes from), while PolyBLEP
needs a correction at every phase discontinuity, natural or sync-forced,
which is what `surge_oscillator.cpp` already does. A DSF-based module here
would be a genuinely different oscillator, not a redundant one — noted as
a real option for future work, not built in this pass.

📚 **Source:** Moorer, J. A. (1976). *The Synthesis of Complex Audio Spectra
by Means of Discrete Summation Formulas.* Stanford CCRMA (STAN-M-5).

## 🧪🔋 The DSF starter kit ⚡🚀

`native_modules/dsf_oscillator` — Native C++/WASM with a JS fallback,
wired into both the offline evaluator and the realtime audio worklet,
same as Surge Oscillator. This got rewritten several times before
landing here (that history is preserved further down, past the license,
for anyone who wants the debugging trail); this section explains the
oscillator as it actually works today.

### ⚙️🔋 The core idea: one formula, one control, one accumulator

Everything in this module comes from a single closed form, transcribed
directly from `pureSawEng` in Walter H. Hackett's "Extended DSF
Oscillators.cxx":

```
pureSawEng(t, N) = sin(π·t·(2N + 1)) / sin(π·t)  −  1
```

`t` is phase in `[0, 1)`; `N` is a harmonic count. This is **not**
evaluated directly as the output waveform. It's run through a leaky
integrator — the same accumulator pattern used throughout this family of
oscillators (`DSFOscillatorBase::run()` in the original header does the
same thing):

```
value = value · retention  +  pureSawEng(t, N) · dt
```

where `dt = frequency / sampleRate` and `retention` decays the
accumulator's memory across roughly 20 periods of the current pitch (not
a fixed sample count — a fixed retention forgets mid-ramp at low
frequencies and distorts the shape; see the history below for how that
was found). Treat `pureSawEng` as a *rate of change*, and the accumulator
as the thing that turns that rate into an actual waveform, the way
integrating a square wave produces a triangle wave.

`N` is always capped at `⌊Nyquist / frequency⌋` — the most harmonics
that can fit under the sample rate for the current pitch. That's what
makes every waveform in this module alias-free *by construction*: it is
structurally impossible to ask for more harmonics than fit.

**Harmonics (0–1)** is the one knob that shapes every waveform's
character. It crossfades `N` continuously from 1 up to that Nyquist-safe
maximum, blending between the two nearest integer harmonic counts so the
sweep is smooth rather than stepped. It currently displays as a raw
`0.000`–`1.000` fraction rather than a literal harmonic-count number.

### 🛠️⚡ Every waveform is a variation on that one accumulator

- **Sine** — `sin(2π·t)` directly. No DSF math, no accumulator; the true
  floor of the instrument.
- **Saw** — `pureSawEng`, Harmonics-morphed, run through the accumulator
  above. This is the one real reference formula everything else is built
  from.
- **Square (PWM)** — `saw(t) − saw(t − pulseWidth)`. Subtracting a
  phase-shifted copy of the already-correct Saw is itself alias-free —
  no new formula, no new singularity to worry about — and `pulseWidth`
  (0–1) sets duty cycle the way PWM does on any analog square. Its
  higher harmonics keep its peak swing roughly constant as duty cycle
  narrows.
- **Trimorph** *(was called Triangle)* — a **second** leaky integration
  on top of Square's output. Integrating a square produces a triangle;
  integrating it a second time here is literally what turns Square's
  edges into Trimorph's ramps. Because this stage mostly tracks Square's
  *fundamental* harmonic, and a PWM pulse train's fundamental amplitude
  genuinely scales with `sin(π·dutyCycle)`, Trimorph is compensated by
  dividing by that same factor before its own peak-follower normalizer —
  otherwise it fades to silence as `pulseWidth` approaches 0 or 1.
- **SquSaw** *(was called TriMorph)* — a plain crossfade between Saw and
  a *fixed* 50%-duty Square (deliberately not tied to the `pulseWidth`
  knob), landing on a saw-to-triangle-like character rather than a
  saw-to-square one. One knob, `blend` (0–1): 0 is pure Saw, 1 is pure
  50%-duty Square.
- **Quasi Saw / Quasi Square** — still DSF at its foundation, just used
  differently. Its core term, `sin(N·x) / sin(x)`, is the exact same
  Dirichlet-kernel discrete-summation identity `pureSawEng` is built
  from (verified: `sin(N·x)/sin(x) = 1 + 2·Σcos(2k·x)`, a genuine finite
  equal-weighted harmonic sum, for `N` odd). The difference is what
  happens to that sum afterward — `pureSawEng` uses it linearly, as the
  waveform itself; Quasi Saw/Square reshape it through a square root and
  restore sign via `sign(sin(x))` instead, and evaluate the whole thing
  directly per-sample with no leaky integrator. That nonlinear reshaping
  is exactly why it doesn't collapse to a sine at `Harmonics = 0` the
  way the linear-sum waveforms do — same DSF substrate, different
  surface. See [Bonus waveshapes](#bonus-waveshapes-quasi-saw--quasi-square)
  below for the full formula.

### 🎯🪖 Getting the four classic waveshapes

| Shape | Waveform | Harmonics | PWM / Blend |
|---|---|---|---|
| **Sine** | `Sine` (or any other waveform with Harmonics = 0) | — | — |
| **Sawtooth** | `Saw` | `1.0` | — |
| **Square** | `Square (PWM)` | `1.0` | `pulseWidth = 0.5` |
| **Triangle** | `Trimorph` | `1.0` | `pulseWidth = 0.5` |

`SquSaw` is the bonus fifth shape this technique makes easy — a
continuous morph *between* two of the classics, not one of them.

### 🌊⚡🔬 Why reducing everything to a sine is the interesting part

Every `pureSawEng`-family waveform in this module — Saw, Square, Trimorph,
SquSaw — collapses to an **exact sine** at `Harmonics = 0`, not an
approximation, not a "close enough" sine, the literal same
single-harmonic closed form regardless of which waveform you started
from. (Quasi Saw/Square are built on the same underlying Dirichlet-kernel
DSF identity, but reshape it through a square root instead of using it
linearly, so their `Harmonics = 0` case is its own single-cycle shape,
not a sine — see the Bonus waveshapes section.) For the `pureSawEng`
family, this is a direct, audible consequence of the architecture: every
one of those waveforms shares the same underlying `pureSawEng` harmonic
machinery, just fed through a different post-processing stage (a
subtraction for Square, a second integration for Trimorph, a crossfade
for SquSaw) — so winding Harmonics down doesn't cross-fade to some
*other* fixed sine, it un-builds the exact same harmonic sum every other
waveform is made of, one harmonic at a time, down to the single
fundamental they all share.

That's what makes sweeping Harmonics on this oscillator sound organic
rather than mechanical: a classic wavetable morph crossfades between two
*independently-drawn* shapes, so the midpoint is a blend of two unrelated
timbres. Here, every point along the Harmonics knob is the *same*
waveform with fewer or more harmonics — brightness and body come from
literally adding or removing overtones from one continuous structure,
the way a real acoustic instrument's harmonic content actually changes
with dynamics or technique, not the way a synthesizer cross-fader does.
Combine that with Square's PWM, Trimorph's triangle-ness, or SquSaw's
Saw/Square blend, and Harmonics becomes a second axis of movement layered
on top — which is where this stops being "four classic waveshapes" and
starts being a genuinely novel timbral space: PWM-narrow squares thinning
down toward a sine at low Harmonics, Trimorph ramps softening into a pure
tone, SquSaw hybrids that are neither saw nor square nor triangle at any
single setting. None of that palette exists in a standard "pick a
waveform, cross-fade to the next" oscillator.

### Bonus waveshapes: Quasi Saw / Quasi Square

Two more waveforms in the same module, still DSF at the core but used
differently: a direct transcription of `QuasiBandlimited.cxx`'s "Direct
Quasi-Bandlimited Oscillators (No-Integration)" (Walter H. Hackett).
Where every other waveform in this module runs `pureSawEng` through a
leaky integrator, Quasi Saw/Square are evaluated **directly per-sample,
with no integrator at all** — the same Dirichlet-kernel discrete-
summation identity, shaped through a square root instead of used
linearly, with odd
symmetry restored via `sign(sin(x))`:

```
quasi(t, N) = sign(sin(x)) · sqrt(1 − sin(x·m) / (m·sin(x)))  ·  [cos(x) for Saw, 1 for Square]
x = t · 2π,  m = nearest odd integer ≥ N + 1
```

Same Harmonics knob, same Nyquist-derived harmonic ceiling as every other
waveform here — just a different shaping formula underneath. Verified
numerically (Python) that it produces a clean sawtooth/square ramp shape
(not just bounded noise), stays bounded to ~1.1 peak across the harmonic
range this module uses, and confirmed zero NaN across a full frequency ×
Harmonics sweep in `wasmtime` and live in the browser.

## 🔥🎛️ The Tube Oscillator: alias-*taming* instead of alias-*freeing* ⚡

The DSF starter kit above is alias-free *by construction* — a closed
form that literally cannot contain a harmonic above Nyquist. The Tube
Oscillator is the next weapon in this fight, and it's the opposite
philosophy: it doesn't compute a harmonic count at all. Instead it runs
a plain sine or parabolic phase through a `tanh` saturation stage — the
same soft-clip curve a vacuum tube, a transistor, or an analog
waveshaper produces — and *throttles how hard that saturation bites as
pitch rises*, so the extra harmonics saturation injects stay tame near
Nyquist without ever being counted or capped.

Faithful port of `DistortionOscillator.hpp`
(`soemdsp/include/soemdsp/oscillator/DistortionOscillator.hpp`) and all
ten of its waveshapes: **Analog Saw (Sine)**, **Analog Saw (Parabol)**,
**Perfect Saw**, **Analog Square**, **Square**, **Tri**, **Bow Tri**,
**Distorted Bow Tri**, **Walter Wave**, and **Parabol Sine**. Two knobs:
**Frequency** and **Morph** (0–1, how hard the tanh stage saturates).

The anti-aliasing mechanism is one line:

```
sineAmp = quarterNyquist / (log10(frequency) * frequency) * (π/2) * 0.8
```

`sineAmp` scales the saturation stage's input gain, and it's inversely
proportional to frequency — so as pitch climbs, the oscillator
automatically saturates less, generating fewer of the extra harmonics
that would otherwise start folding around Nyquist. No harmonic count, no
cap, no closed-form summation — just a self-limiting feedback between
pitch and distortion depth. Verified numerically (Python, exact math)
that every one of the ten waveshapes stays bounded in `[-1, 1]` from
55 Hz through 4000 Hz with this in place, and confirmed again in
`wasmtime` and live in the browser across 30 Hz–20 kHz with zero NaN.

`acos` has no freestanding-WASM equivalent (needed for **Perfect Saw**
and **Tri**), so the native build uses a standard fast polynomial
approximation (~7e-5 max error, verified against exact `math.acos`
before shipping) instead.

## 📺⚡ Hackett Shapes: X-Y oscilloscope art, not audio

A change of pace from the oscillator work above — five X-Y shapes
transcribed directly from Walter H. Hackett's PlugNScript formulas:
**Spiral Sphere**, **Ring Sphere**, **Electric Grid Cube**, **Dotted
Cube**, and **Dotted Cube (Dimensional)**.

These are **2D, not 3D** — each shape is a plain `(x, y)` parametric
curve, two numbers per sample, nothing more. What makes them read as
rotating 3D wireframes when plotted on an oscilloscope/vectorscope (the
same X/Y display technique this repo's `spiral` and `lorenzAttractor`
modules already use) is a fake-perspective-divide trick baked into every
formula's denominator:

```
denom = (sin(...) * shape_term) * 0.7 + 2
x = ... / denom
y = ... / denom
```

Points that would be "further away" in the illusion get divided by a
larger denominator and shrink — the same trick a real 3D-to-2D
perspective projection uses, just faked with a sine term instead of an
actual depth coordinate. `A` and `B` are the two shape-control knobs
from the reference patches (density/warp parameters); `Speed` drives a
free-running time value `t` — there's no "one cycle" concept for these
shapes the way there is for an audio oscillator, so `t` just increases
continuously.

Verified numerically (Python) that every shape stays within a sane,
bounded `x`/`y` range (not wildly diverging) across a range of `A`/`B`
values before shipping, and confirmed live in the browser.

**Corrected after shipping:** Ring Sphere's denominator-based perspective
divide was wrong — the real formula multiplies by a `sin(...)·0.3 + 0.7`
scale term (the same style Dotted Cube's dimensional variant uses), not
divide by a `sin(...)·0.7 + 2` denominator. Fixed to match the corrected
formula. Also removed an extraneous `cos(t/4)/2` term from Dotted Cube
(Dimensional)'s `y` that had crept in and wasn't part of the actual
reference formula.

### Walter's Saw: a seventh DSF waveshape

Added directly from Walter H. Hackett, sent with the explicit
instruction "please combine with leaky integrator":

```
pureWaltersSaw(t, m):
  x = t·2π,  n = ⌊(m−1)/2⌋
  return −2·(−cos(x(n+1))·(cos(x)cos(x(n+1)) + sin(x(n+1))sin(x) − sin(x(n+1))) / sin(x) + cos(x)/sin(x))
```

Run through the exact same accumulator every DSF oscillator in this
mission uses — `Harmonics`-morphed, fed through the frequency-adaptive
leaky integrator, guarded at its own removable singularity
(`sin(x) = 0`). Verified numerically (Python) that the raw formula's
amplitude scales with harmonic count the same way `pureSawEng`'s does,
and that the full accumulator pipeline produces a bounded, near-zero-DC
sawtooth-family shape from 55 Hz through 10 kHz, confirmed with zero NaN
across a full frequency × Harmonics sweep.

## License

This repository is source-available for noncommercial use only. Commercial use
requires a separate written commercial license from Soundemote. See
[`LICENSE`](LICENSE).
