// Shared offline JS mirror of the Hackett Shapes module -- five X-Y
// oscilloscope shapes, all transcribed directly from Walter H. Hackett's
// PlugNScript formulas. Each is a plain 2D (x, y) parametric curve --
// there's no real 3D geometry here -- but the /(...*k+c) denominator in
// every one is a fake-perspective-divide trick: it shrinks points that
// would be "further away" in the illusion, which is what makes a 2D X-Y
// plot read as a rotating 3D wireframe (a sphere, a cube) on an
// oscilloscope/vectorscope display, the same technique this project's
// existing spiral/lorenzAttractor scope2d modules use.
//
// `a` and `b` are the two shape-control knobs from the reference patches
// (density/warp parameters); `t` is a free-running phase that advances by
// `speed / sampleRate` every sample -- there's no "one cycle" concept for
// these shapes the way there is for an audio oscillator, so it's just a
// continuously increasing time value.

function createHackettShapesState() {
  return { t: 0 };
}

// shape: 0=Spiral Sphere, 1=Ring Sphere, 2=Electric Grid Cube,
//        3=Dotted Cube, 4=Dotted Cube (Dimensional)
function hackettShapesSample(options = {}) {
  const state = options.state;
  const speed = Number(options.speed) || 0;
  const sampleRate = Number(options.sampleRate) > 1 ? Number(options.sampleRate) : 48000;
  const a = Number(options.a) || 1;
  const b = Number(options.b) || 1;
  const shape = Math.round(Number(options.shape) || 0);
  const level = Number(options.level) || 0;

  state.t += speed / sampleRate;
  const t = state.t;

  let x = 0;
  let y = 0;
  switch (shape) {
    case 0: {
      // Spiral Sphere
      const frac = ((a * t) % 1 + 1) % 1;
      const circ = Math.sqrt(Math.max(0, 1 - (frac * 2 - 1) ** 2));
      const denom = (Math.sin(a * t * Math.PI * b) * circ) * 0.7 + 2;
      x = (Math.cos(a * t * Math.PI * b) * circ) / denom;
      y = (frac * 2 - 1 + Math.cos(t / 2) / 2) / denom;
      break;
    }
    case 1: {
      // Ring Sphere -- corrected: multiply by the perspective-scale term
      // (like Dotted Cube's dimensional variant), not divide by it.
      const fb = Math.floor(b + 1);
      const idx = Math.floor((((a * t) % 1 + 1) % 1) * fb) / fb;
      const circ = Math.sqrt(Math.max(0, 1 - (idx * 2 - 1) ** 2));
      const ang = ((((a * t * fb) % 1) + 1) % 1) * Math.PI * 2;
      const scale = (Math.sin(ang) * circ) * 0.3 + 0.7;
      x = (Math.cos(ang) * circ) * scale;
      y = (idx * 2 - 1 + Math.cos(t / 2) / 2) * scale;
      break;
    }
    case 2: {
      // Electric Grid Cube
      const fa = Math.floor(a);
      const fb = Math.floor(b);
      const xa = Math.floor(5 * Math.cos(b * Math.sin(2 * t * Math.PI * fa) * Math.PI * 2 * b + a * 3)) / 5;
      const xb = Math.floor(5 * Math.cos(2 * t * Math.PI * fa * fb)) / 5;
      const denom = ((Math.sin(t / 2) * xa) + (Math.cos(t / 2) * xb)) * 0.7 + 2;
      x = ((Math.cos(t / 2) * xa) - (Math.sin(t / 2) * xb)) / denom;
      y = (Math.floor(5 * Math.sin(Math.cos(1.38 * a + 2 * t * Math.PI * fa + 0.3 * fb) * Math.PI * 2 * b + a)) / 5 + Math.cos(t / 2) / 2) / denom;
      break;
    }
    case 3: {
      // Dotted Cube
      const xa = Math.floor((((t * a) * 5) % 1 - 0.4) * 5) / 5;
      const xb = Math.floor((((t * a) * 25) % 1) * 5) / 5;
      const denom = (Math.sin(t) * xa + Math.cos(t) * xb) * 0.7 + 2;
      x = (Math.cos(t) * xa - Math.sin(t) * xb) / denom;
      y = (Math.floor(((t * a) % 1 - 0.4) * 5) / 5) / denom;
      break;
    }
    default: {
      // Dotted Cube (Dimensional) -- Hackett's own follow-up, "shows a
      // bit more dimension": same dotted-cube grid, but rotated by `b`
      // (not just a fixed rotation) and rescaled (rather than divided)
      // by the perspective term, which is what gives it the extra depth
      // cue.
      const xa = Math.floor((((t * a) * 5) % 1) * 5) / 5;
      const xb = Math.floor((((t * a) * 25) % 1) * 5) / 5;
      const xa2 = Math.floor((((t * a) * 5) % 1 - 0.4) * 5) / 5;
      const scale = (Math.sin(t * b) * xa2 + Math.cos(t * b) * xb) * 0.3 + 0.7;
      x = (Math.cos(t * b) * xa - Math.sin(t * b) * xb) * scale;
      y = (Math.floor(((t * a) % 1 - 0.4) * 5) / 5) * scale;
      break;
    }
  }

  if (!Number.isFinite(x)) x = 0;
  if (!Number.isFinite(y)) y = 0;
  return { x: x * level, y: y * level };
}
