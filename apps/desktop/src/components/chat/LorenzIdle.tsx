import { useEffect, useRef } from "react";

/**
 * The empty-chat backdrop: a Lorenz attractor drawn as ASCII, in the app's own
 * palette.
 *
 * It is decoration, not instrumentation — the standalone sketch this came from
 * showed the equations and a live separation readout, and those are
 * deliberately gone. Nothing here is a number the user could act on, so
 * presenting one would be a measurement that isn't measuring anything.
 *
 * Two trajectories start a hair apart and drift into different wings, which is
 * the whole reason the shape is interesting; here it just gives the accent and
 * ink strands something to do.
 */

const SIGMA = 10;
const RHO = 28;
const BETA = 8 / 3;
const DT = 0.006;
const STEPS_PER_FRAME = 3;
const TRAIL_LENGTH = 2200;
/**
 * Steps discarded before anything is recorded. The trajectory starts beside
 * the unstable origin and spends its first several time units spiralling out
 * to the attractor; without this, first paint is that spiral rather than the
 * butterfly.
 */
const SETTLE_STEPS = 3000;
const RAMP = " .:-=+*#%@";

const CHAR_W = 7;
const CHAR_H = 11;

/**
 * The attractor's own extents, in its own units, which is what the shape is
 * *scaled* from — not what the grid is sized to.
 *
 * Scaled to the shape as it usually sits, not to its worst case: the horizontal
 * reach swings as theta mixes y into the x axis, and scaling for the widest
 * angle would leave the shape filling half its box at every other angle. The
 * overshoot at those wide angles used to be dropped by the bounds check in
 * plot(), which trimmed the outer wing flat against the edge for part of every
 * rotation. The grid is now sized to the widest angle instead (see
 * `measureReach`), so the scale here is free to suit the common one.
 */
const HALF_SPAN_X = 24;
const HALF_SPAN_Z = 27;
/**
 * Slack on the measured reach. The extents are measured from a long but finite
 * run, and the trajectory keeps wandering after it; a little headroom is much
 * cheaper than a clipped wing, since it costs blank cells at the edge and
 * nothing else.
 */
const REACH_MARGIN = 1.06;
/** Breathing room inside the grid, so the shape rarely reaches the edge. */
const FILL = 0.9;
/**
 * Deliberate vertical exaggeration past a true 1:1 scale. The attractor is
 * wider than it is tall, and at honest proportions it reads as a squat smear
 * across a wide chat pane; taller gives the wings room to be two wings.
 */
const Y_STRETCH = 1.15;
/** Mild: enough that the near wing reads as nearer, not enough to swing the
 * shape off the grid as it turns. */
const PERSPECTIVE_DEPTH = 0.5;
const FONT = `${CHAR_H}px ui-monospace, "Cascadia Mono", Consolas, "Liberation Mono", monospace`;

interface Point {
  x: number;
  y: number;
  z: number;
}

function derivative(s: Point): Point {
  return {
    x: SIGMA * (s.y - s.x),
    y: s.x * (RHO - s.z) - s.y,
    z: s.x * s.y - BETA * s.z,
  };
}

/** Fourth-order Runge-Kutta — Euler visibly drifts off the attractor at this dt. */
function step(s: Point, dt: number): Point {
  const k1 = derivative(s);
  const k2 = derivative({ x: s.x + (k1.x * dt) / 2, y: s.y + (k1.y * dt) / 2, z: s.z + (k1.z * dt) / 2 });
  const k3 = derivative({ x: s.x + (k2.x * dt) / 2, y: s.y + (k2.y * dt) / 2, z: s.z + (k2.z * dt) / 2 });
  const k4 = derivative({ x: s.x + k3.x * dt, y: s.y + k3.y * dt, z: s.z + k3.z * dt });
  return {
    x: s.x + (dt / 6) * (k1.x + 2 * k2.x + 2 * k3.x + k4.x),
    y: s.y + (dt / 6) * (k1.y + 2 * k2.y + 2 * k3.y + k4.y),
    z: s.z + (dt / 6) * (k1.z + 2 * k2.z + 2 * k3.z + k4.z),
  };
}

/** rgb triples read off the live theme, so the canvas follows light/dark. */
function readPalette(root: HTMLElement): { accent: string; ink: string; background: string } {
  const styles = getComputedStyle(root);
  const pick = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
  return {
    accent: pick("--pot-accent-dot", "#c4b228"),
    ink: pick("--pot-lorenz-ink", "#a3a399"),
    background: pick("--pot-bg", "#ffffff"),
  };
}

export function LorenzIdle({ width = 392 }: { width?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    // The shape is wound forward before anything is sized, because the grid is
    // sized to what it will actually draw (see measureReach below).
    //
    // Two starts a hair apart. The gap is what makes the strands separate.
    let a: Point = { x: 0.1, y: 0, z: 0 };
    let b: Point = { x: 0.1 + 1e-5, y: 0, z: 0 };
    const trailA: Point[] = [];
    const trailB: Point[] = [];
    let theta = 0;

    // Wind the system forward before the first paint so the shape arrives
    // already formed. Growing it from a single dot in view reads as the app
    // still loading, which is the opposite of what an idle screen should say.
    for (let i = 0; i < SETTLE_STEPS; i++) {
      a = step(a, DT);
      b = step(b, DT);
    }
    for (let i = 0; i < TRAIL_LENGTH; i++) {
      a = step(a, DT);
      b = step(b, DT);
      trailA.push(a);
      trailB.push(b);
    }

    // How far the trajectory swings from the view axis, and how far above and
    // below the centre of the box it climbs. The horizontal figure is the
    // radius in the xy plane rather than |x|: theta rotates that plane into the
    // screen, so over one turn every point reaches |rx| = hypot(x, y).
    function measureReach(trails: Point[][]) {
      let radius = 0;
      let rise = 0;
      for (const trail of trails) {
        for (const point of trail) {
          radius = Math.max(radius, Math.hypot(point.x, point.y));
          rise = Math.max(rise, Math.abs(point.z - 25));
        }
      }
      return { radius, rise };
    }

    const reach = measureReach([trailA, trailB]);
    // Worst case, taken rather than searched for: perspective is strongest when
    // the point is nearest, which is when the whole radius has rotated onto the
    // depth axis.
    const nearestGain = 90 / Math.max(1, 90 - reach.radius * PERSPECTIVE_DEPTH);

    // The nominal box. This is what sets the shape's SIZE — the `width` the
    // caller asked for is the width of the attractor, not of the canvas.
    const boxCols = Math.max(20, Math.floor(width / CHAR_W));
    // Height is derived, never passed in. A character cell is 7x11, so a box
    // sized independently on each axis gives the two axes different pixels per
    // unit and flattens the attractor. This solves for equal scale, then
    // applies Y_STRETCH on top as a chosen exaggeration rather than an
    // accident of cell geometry.
    const isotropicRows = (boxCols * CHAR_W * HALF_SPAN_Z) / (HALF_SPAN_X * CHAR_H);
    const boxRows = Math.max(12, Math.round(isotropicRows * Y_STRETCH));

    // Cells per attractor unit, fixed by the box above and never by the grid,
    // so widening the grid adds margin instead of shrinking the drawing.
    const colsPerUnit = ((boxCols / 2) * FILL) / HALF_SPAN_X;
    const rowsPerUnit = ((boxRows / 2) * FILL) / HALF_SPAN_Z;

    // The grid, sized to hold the shape at every angle of the rotation. Anything
    // short of this clips the outer wing flat for part of each turn — which is
    // the whole bug: the attractor was drawn with its sides shaved off.
    const cols = Math.max(
      boxCols,
      2 * Math.ceil(reach.radius * nearestGain * colsPerUnit * REACH_MARGIN) + 1,
    );
    const rows = Math.max(
      boxRows,
      2 * Math.ceil(reach.rise * nearestGain * rowsPerUnit * REACH_MARGIN) + 1,
    );

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = cols * CHAR_W * dpr;
    canvas.height = rows * CHAR_H * dpr;
    canvas.style.width = `${cols * CHAR_W}px`;
    canvas.style.height = `${rows * CHAR_H}px`;
    context.scale(dpr, dpr);
    context.textBaseline = "top";

    let palette = readPalette(document.documentElement);
    const themeWatcher = new MutationObserver(() => {
      palette = readPalette(document.documentElement);
    });
    themeWatcher.observe(document.documentElement, { attributes: true, attributeFilter: ["data-pot-theme"] });

    const cellCount = cols * rows;
    const glyphs = new Array<string>(cellCount);
    const depth = new Float32Array(cellCount);
    const strand = new Uint8Array(cellCount);

    function project(p: Point, angle: number) {
      const cz = p.z - 25;
      const rx = p.x * Math.cos(angle) - p.y * Math.sin(angle);
      const ry = p.x * Math.sin(angle) + p.y * Math.cos(angle);
      const perspective = 90 / (90 + ry * PERSPECTIVE_DEPTH);

      return {
        px: cols / 2 + rx * perspective * colsPerUnit,
        py: rows / 2 - cz * perspective * rowsPerUnit,
      };
    }

    function plot(trail: Point[], strandId: number) {
      for (let i = 0; i < trail.length; i++) {
        const { px, py } = project(trail[i], theta);
        const col = Math.round(px);
        const row = Math.round(py);
        if (col < 0 || col >= cols || row < 0 || row >= rows) continue;

        const index = row * cols + col;
        // Newer points burn brighter, which reads as motion even in a still frame.
        const brightness = Math.min(1, (i / trail.length) * 0.85 + 0.15);
        if (brightness > depth[index]) {
          depth[index] = brightness;
          glyphs[index] = RAMP[Math.min(RAMP.length - 1, Math.floor(brightness * RAMP.length))];
          strand[index] = strandId;
        }
      }
    }

    function advance() {
      for (let s = 0; s < STEPS_PER_FRAME; s++) {
        a = step(a, DT);
        b = step(b, DT);
        trailA.push(a);
        trailB.push(b);
        if (trailA.length > TRAIL_LENGTH) trailA.shift();
        if (trailB.length > TRAIL_LENGTH) trailB.shift();
      }
      theta += 0.0035;
    }

    function draw() {
      glyphs.fill(" ");
      depth.fill(-1);
      strand.fill(0);
      plot(trailA, 1);
      plot(trailB, 2);

      context!.clearRect(0, 0, cols * CHAR_W, rows * CHAR_H);
      context!.font = FONT;
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const index = row * cols + col;
          const glyph = glyphs[index];
          if (glyph === " ") continue;
          // The dim strand recedes further than the accent one, so the shape
          // reads as one object rather than two overlaid drawings.
          const brightness = depth[index];
          context!.globalAlpha = strand[index] === 1 ? 0.25 + brightness * 0.75 : 0.18 + brightness * 0.5;
          context!.fillStyle = strand[index] === 1 ? palette.accent : palette.ink;
          context!.fillText(glyph, col * CHAR_W, row * CHAR_H);
        }
      }
      context!.globalAlpha = 1;
    }

    draw();

    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (reducedMotion) {
      // The formed attractor is still worth showing; it just stops here rather
      // than moving at someone who asked us not to.
      return () => themeWatcher.disconnect();
    }

    let frame = 0;
    const tick = () => {
      advance();
      draw();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      themeWatcher.disconnect();
    };
  }, [width]);

  return (
    <canvas
      ref={canvasRef}
      // Decorative: a screen reader gains nothing from a description of a
      // moving picture of a differential equation.
      aria-hidden="true"
      // maxWidth, because the grid is now wider than the `width` asked for: it
      // carries the margin the rotation needs. On a pane too narrow for that,
      // scaling the whole canvas down beats cutting the wings off again.
      style={{ display: "block", margin: "0 auto", maxWidth: "100%" }}
    />
  );
}
