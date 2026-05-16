// math-worker.js — off-main-thread surface generation for the CPU formula path.
//
// Runs generateSurfaceFromFormula() inside a Web Worker so the heavy
// per-vertex evaluation of formulas like Mandelbrot or the Lorenz attractor
// does not stall the render loop. The result is shipped back to the main
// thread as a Transferable Float32Array — ownership of the underlying
// ArrayBuffer moves rather than being copied, so a 256×256 grid (≈256 KiB)
// crosses the boundary in microseconds and produces no GC pressure on
// either side. The main thread copies the contents into its own persistent
// receive buffer (see MathVisualizer._hfBuffer) before the next tick, which
// lets the worker reuse its buffer too.
//
// ── Message contract ──────────────────────────────────────────────────────
//   IN  { type: 'setFormula', collectionId, formulaKey }
//         Resolve a formula from MATH_COLLECTIONS and arm it for future
//         ticks. Unknown ids respond with an error message and clear the
//         active formula — the main thread treats that as "fall back to
//         sync mode" via the worker.onerror path.
//
//   IN  { type: 'tick', time, gridSize, extent, audioParams }
//         Evaluate the active formula over a gridSize×gridSize grid spanning
//         [-extent, extent]² with the given audio params. Silently ignored
//         when no formula is armed — a stray tick during a formula switch
//         is normal and not an error.
//
//   IN  { type: 'deactivate' }
//         Drop the active formula. No response — the main thread doesn't
//         wait for an ack and re-arms with setFormula when needed.
//
//   OUT { type: 'result', hf: Float32Array }   — buffer transferred, not copied
//   OUT { type: 'error',  message: string }    — diagnostic; never thrown

import { getFormula, generateSurfaceFromFormula } from './math-collections.js';

// Armed formula state. formulaKey is retained alongside formulaFn purely
// to label future diagnostic messages — the evaluator only needs the fn.
let formulaFn   = null;
let formulaKey  = null;

self.onmessage = ({ data }) => {
  switch (data.type) {

    case 'setFormula': {
      const f = getFormula(data.collectionId, data.formulaKey);
      if (!f) {
        // Unknown id: report and disarm. Leaving a stale formulaFn armed
        // would silently keep producing output the caller no longer wants.
        self.postMessage({ type: 'error', message: `Formula not found: ${data.collectionId}/${data.formulaKey}` });
        formulaFn = null;
        return;
      }
      formulaFn  = f.f;
      formulaKey = data.formulaKey;
      break;
    }

    case 'tick': {
      if (!formulaFn) return;
      const { time, gridSize, extent = 3.5, audioParams, gen } = data;
      const hf = generateSurfaceFromFormula(formulaFn, audioParams, gridSize, extent, time);
      // Echo the generation token back unchanged. The main thread uses it
      // to discard results that were superseded by a setFormula/setMode
      // call that happened while this tick was being computed.
      // Second argument is the transfer list — moves ownership of the
      // ArrayBuffer to the main thread instead of structured-cloning it.
      self.postMessage({ type: 'result', hf, gen }, [hf.buffer]);
      break;
    }

    case 'deactivate': {
      formulaFn  = null;
      formulaKey = null;
      break;
    }

    default:
      // Defensive: protocol-level errors should be loud, not silent. If a
      // future caller sends a new message type, this surface makes the
      // mismatch obvious instead of producing zero frames.
      self.postMessage({ type: 'error', message: `Unknown message type: ${data.type}` });
  }
};
