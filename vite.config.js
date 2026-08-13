import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import fs from 'fs';
import path from 'path';
import { vimathicDocs } from './plugins/vimathic-docs.js';
import { vimathicBuildInfo } from './plugins/vimathic-build-info.js';

/**
 * Tiny inline plugin — copies second-screen.html verbatim into dist/
 * after build. No extra npm deps. viteSingleFile only touches index.html.
 */
function copySecondScreen() {
  return {
    name: 'copy-second-screen',
    closeBundle() {
      // import.meta.dirname, not __dirname: this file is ESM ("type":"module"),
      // so __dirname only existed because Vite's bundling config loader injected
      // it. Vite 8 warns that the native loader — the planned default — does not,
      // and the copy would fail with a ReferenceError the day that flips.
      const src  = path.resolve(import.meta.dirname, 'second-screen.html');
      const dest = path.resolve(import.meta.dirname, 'dist', 'second-screen.html');
      if (fs.existsSync(src)) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
        console.log('✔ second-screen.html → dist/');
      }
    },
  };
}

export default defineConfig({
  plugins: [
    // vimathicDocs and vimathicBuildInfo produce virtual modules that must be
    // in the JS graph before singleFile inlines everything into one HTML.
    // Ordering here is belt-and-braces only: vimathicBuildInfo is enforce:'pre'
    // and viteSingleFile is enforce:'post', so Vite already orders them.
    vimathicDocs({ dir: 'documents' }),
    vimathicBuildInfo(),
    viteSingleFile(),
    copySecondScreen(),
  ],
  // FIX(#43, r4): strictPort. Without it, Vite treats 3000 as a preference and
  // quietly binds the next free port when it is taken — while playwright.config.js
  // hardcodes http://localhost:3000 twice as an absolute, and reuses whatever
  // already answers there when not on CI. With two checkouts of this repo open,
  // the e2e suite then runs against the other one: the right app at the wrong
  // revision, whose failures read as product bugs. Failing to start is the
  // honest outcome, and it says which port is busy.
  server: { port: 3000, strictPort: true, open: true },
  build: {
    target: 'esnext',
    outDir: 'dist',
    // FIX(#24): assetsInlineLimit and rollupOptions.output.inlineDynamicImports
    // used to live here and did nothing. viteSingleFile overwrites the former
    // with a `() => true` predicate, and under Vite 8 (Rolldown) it sets
    // `codeSplitting: false`, which makes inlineDynamicImports both redundant
    // and warned-about on every build. Removed so nobody tunes a dead knob.
    //
    // Do NOT re-add `assetsDir` here either: viteSingleFile sets it to '' and
    // that is what puts math-worker-<hash>.js in the ROOT of dist/, where the
    // single-file whitelist in .github/workflows/ci.yml expects to find it.
    rollupOptions: {
      input: { main: 'index.html' },
    },
  },
});
