/**
 * VIMATHIC — Mathematical VJ Studio
 * Copyright (c) 2026 S. Melentyev. All rights reserved.
 * Licensed under BUSL-1.1 — see LICENSE.txt
 * https://github.com/vimathic/vimathic
 */

/**
 * vimathic-build-info.js — Vite plugin
 *
 * Exposes build-time info to the app via a virtual module
 * `virtual:vimathic-build-info`. The module exports:
 *
 *   - VIMATHIC_VERSION: string  (from package.json)
 *   - VIMATHIC_BUILD_HASH: string  (short git commit hash, "dev" if no git)
 *   - VIMATHIC_BUILD_DATE: string  (ISO yyyy-mm-dd of build)
 *   - VIMATHIC_REPO_URL: string  (constant)
 *
 * Usage in app code:
 *   import { VIMATHIC_BUILD_HASH } from 'virtual:vimathic-build-info';
 *
 * The plugin runs once per build and caches the result. The values get
 * inlined into the bundle by Vite's tree-shaking — there is no runtime
 * git/fs access.
 *
 * Why this matters: someone who copies the deployed `dist/index.html`
 * will carry our exact build hash with them. The About modal displays
 * it, so any deployed copy can be traced back to the upstream commit.
 */

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const VIRTUAL_ID = 'virtual:vimathic-build-info';
const RESOLVED_ID = '\0' + VIRTUAL_ID;

function getGitHash() {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['pipe', 'pipe', 'ignore'] })
      .toString().trim();
  } catch {
    return 'dev';
  }
}

function getPackageVersion(rootDir) {
  try {
    const pkg = JSON.parse(readFileSync(resolve(rootDir, 'package.json'), 'utf-8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function getBuildDate() {
  const d = new Date();
  return d.toISOString().slice(0, 10);  // YYYY-MM-DD
}

export function vimathicBuildInfo(opts = {}) {
  const repoUrl = opts.repoUrl || 'https://github.com/vimathic/vimathic';
  let cachedInfo = null;

  return {
    name: 'vimathic-build-info',
    enforce: 'pre',

    buildStart() {
      // Compute once per build invocation.
      const rootDir = process.cwd();
      cachedInfo = {
        version: getPackageVersion(rootDir),
        hash: getGitHash(),
        date: getBuildDate(),
        repoUrl,
      };
      // Log for build-time visibility (will appear in Vite output)
      console.log(
        `[vimathic-build-info] v${cachedInfo.version} ` +
        `build ${cachedInfo.hash} (${cachedInfo.date})`
      );
    },

    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
    },

    load(id) {
      if (id !== RESOLVED_ID) return;
      const info = cachedInfo || {
        version: '0.0.0',
        hash: 'dev',
        date: getBuildDate(),
        repoUrl,
      };
      return [
        `export const VIMATHIC_VERSION = ${JSON.stringify(info.version)};`,
        `export const VIMATHIC_BUILD_HASH = ${JSON.stringify(info.hash)};`,
        `export const VIMATHIC_BUILD_DATE = ${JSON.stringify(info.date)};`,
        `export const VIMATHIC_REPO_URL = ${JSON.stringify(info.repoUrl)};`,
      ].join('\n');
    },
  };
}

export default vimathicBuildInfo;
