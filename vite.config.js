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
      const src  = path.resolve(__dirname, 'second-screen.html');
      const dest = path.resolve(__dirname, 'dist', 'second-screen.html');
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
    // Order matters: vimathicDocs and vimathicBuildInfo must run BEFORE
    // viteSingleFile so their virtual-module content is in the JS graph
    // by the time singleFile inlines everything into one HTML.
    vimathicDocs({ dir: 'documents' }),
    vimathicBuildInfo(),
    viteSingleFile(),
    copySecondScreen(),
  ],
  server: { port: 3000, open: true },
  build: {
    target: 'esnext',
    outDir: 'dist',
    assetsInlineLimit: 100_000_000,
    rollupOptions: {
      input:  { main: 'index.html' },
      output: { inlineDynamicImports: true },
    },
  },
});
