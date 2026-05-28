// plugins/vimathic-docs.js
//
// Vite plugin: reads `documents/*.md` at build (and dev-server) time and
// does two jobs from a single source-of-truth:
//
//   1. In-app modal — exposes a JS module via the virtual import
//      `virtual:vimathic-docs`. The About modal renders this.
//
//   2. SEO + AI discoverability — at build time, emits:
//        dist/docs/<slug>.html       static page per .md, indexable
//        dist/docs/index.html        landing (from documents/index.md if present)
//        dist/sitemap.xml            XML sitemap of all doc URLs
//        dist/robots.txt             crawler rules (AI opt-in)
//        dist/llms.txt               llmstxt.org-format summary for LLM search
//
// Consuming code (modal side):
//   import DOCS from 'virtual:vimathic-docs';
//   // DOCS is an array of { slug, title, html, order, raw, description },
//   // sorted by `order` then `title`, ready to drive a tabs UI.
//
// Markdown features enabled:
//   • CommonMark (via micromark core)
//   • GFM tables (via micromark-extension-gfm-table) — pipe syntax with
//     header separator row. CommonMark proper does NOT include tables;
//     we add this one GFM extension because documents/*.md use tables for
//     option references throughout. We deliberately do NOT pull in full
//     `micromark-extension-gfm` (autolinks, footnotes, strikethrough,
//     tasklists, tagfilter) — none of those features are used.
//
// Security:
//   We render Markdown via `micromark` with `allowDangerousHtml: true`.
//   This permits raw HTML (<picture>/<source>/<img> for hero images,
//   inline <kbd>) to pass through. Safe because documents/*.md is a
//   TRUSTED source — maintainer-authored, PR-reviewed. Fork-and-accept-
//   untrusted-markdown? Flip back to false or pipe through DOMPurify.

import fs from 'node:fs';
import path from 'node:path';
import { micromark } from 'micromark';
import { gfmTable, gfmTableHtml } from 'micromark-extension-gfm-table';

const VIRTUAL_ID         = 'virtual:vimathic-docs';
const RESOLVED_ID        = '\0' + VIRTUAL_ID;
const DEFAULT_DOCS_DIR   = 'documents';
const DEFAULT_SITE_URL   = 'https://vimathic.com';

// Hoisted once — extensions are stateless and reusable across parses.
const MICROMARK_OPTS = {
  allowDangerousHtml: true,
  extensions:     [gfmTable()],
  htmlExtensions: [gfmTableHtml()],
};

function parseDoc(filepath, source) {
  const slug = path.basename(filepath, '.md');
  const meta = { title: null, order: 1000, description: null, group: null };
  let body = source;

  const fmMatch = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (fmMatch) {
    const [, fmBlock, rest] = fmMatch;
    body = rest;
    for (const line of fmBlock.split('\n')) {
      const m = line.match(/^([a-zA-Z_][\w-]*)\s*:\s*(.+)$/);
      if (!m) continue;
      const [, key, value] = m;
      const trimmed = value.trim().replace(/^["']|["']$/g, '');
      if (key === 'order') meta.order = parseInt(trimmed, 10) || 1000;
      else if (key === 'title') meta.title = trimmed;
      else if (key === 'description') meta.description = trimmed;
      else if (key === 'group') meta.group = trimmed;
    }
  }

  if (!meta.title) {
    meta.title = slug.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
  }

  const html = micromark(body, MICROMARK_OPTS);

  let description = meta.description;
  if (!description) {
    const pMatch = html.match(/<p>([\s\S]*?)<\/p>/);
    if (pMatch) {
      description = pMatch[1].replace(/<[^>]+>/g, '').trim();
      if (description.length > 160) description = description.slice(0, 157) + '...';
    }
  }

  return {
    slug,
    title: meta.title,
    order: meta.order,
    group: meta.group,
    description: description || '',
    html,
    raw: body,
  };
}

function loadAll(docsDir) {
  if (!fs.existsSync(docsDir)) return [];
  const entries = fs.readdirSync(docsDir)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const full = path.join(docsDir, f);
      try {
        return parseDoc(full, fs.readFileSync(full, 'utf8'));
      } catch (err) {
        console.warn(`[vimathic-docs] Failed to parse ${full}:`, err.message);
        return {
          slug:  path.basename(f, '.md'),
          title: `⚠ ${path.basename(f, '.md')} (parse error)`,
          order: 9999,
          group: null,
          description: '',
          html:  `<p><strong>Parse error in <code>${f}</code></strong></p><pre>${escapeHtml(err.message)}</pre>`,
          raw:   '',
        };
      }
    });
  return entries.sort((a, b) =>
    a.order !== b.order ? a.order - b.order : a.title.localeCompare(b.title),
  );
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderStaticPage(doc, siteUrl, allDocs) {
  const canonical = `${siteUrl}/docs/${doc.slug === 'index' ? '' : doc.slug + '.html'}`;
  // Convert relative .md links to .html for static pages. The modal version
  // keeps .md because about-modal.js has a cross-doc handler that accepts both.
  const html = doc.html.replace(/href="(\.\/[a-z0-9-]+)\.md"/g, 'href="$1.html"');
  const navLinks = allDocs
    .filter(d => d.slug !== doc.slug)
    .map(d => `<li><a href="./${d.slug === 'index' ? '' : d.slug + '.html'}">${escapeHtml(d.title)}</a></li>`)
    .join('\n      ');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(doc.title)} — VIMATHIC</title>
<meta name="description" content="${escapeHtml(doc.description)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="canonical" href="${canonical}">
<meta property="og:title" content="${escapeHtml(doc.title)} — VIMATHIC">
<meta property="og:description" content="${escapeHtml(doc.description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:type" content="article">
<meta name="robots" content="index,follow">
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:780px;margin:2em auto;padding:1em;background:#0a0a0e;color:#e0e0e0;line-height:1.6}
  h1,h2,h3{color:#fff}
  h1{border-bottom:1px solid #333;padding-bottom:.3em}
  a{color:#7aa8ff}
  code{background:#1a1a22;padding:.1em .3em;border-radius:3px;font-size:.9em}
  pre{background:#1a1a22;padding:1em;border-radius:6px;overflow-x:auto}
  pre code{background:none;padding:0}
  table{border-collapse:collapse;margin:1em 0;width:100%}
  th,td{border:1px solid #333;padding:.4em .8em;text-align:left}
  th{background:#1a1a22;color:#fff;font-weight:600}
  blockquote{border-left:3px solid #555;padding-left:1em;color:#bbb;margin:1em 0}
  img{max-width:100%;height:auto;border-radius:6px}
  .crumb{font-size:.85em;opacity:.7;margin-bottom:1.5em}
  .crumb a{color:#7aa8ff;text-decoration:none}
  nav.related{margin-top:3em;padding-top:1.5em;border-top:1px solid #333;font-size:.9em}
  nav.related ul{list-style:none;padding:0;columns:2;column-gap:2em}
  nav.related li{padding:.2em 0}
  footer{margin-top:3em;padding-top:1em;border-top:1px solid #222;font-size:.8em;opacity:.6;text-align:center}
</style>
</head>
<body>
  <div class="crumb">
    <a href="https://vimathic.com">VIMATHIC</a> · <a href="./">Documentation</a> · ${escapeHtml(doc.title)}
  </div>

  ${html}

  <nav class="related">
    <strong>Other pages:</strong>
    <ul>
      ${navLinks}
    </ul>
  </nav>

  <footer>
    VIMATHIC · <a href="https://vimathic.com" style="color:inherit">vimathic.com</a> · <a href="https://github.com/vimathic/vimathic" style="color:inherit">source on GitHub</a>
  </footer>
</body>
</html>
`;
}

function renderSitemap(siteUrl, docs) {
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    { loc: `${siteUrl}/`,        priority: '1.0', changefreq: 'weekly' },
    { loc: `${siteUrl}/docs/`,   priority: '0.9', changefreq: 'monthly' },
    ...docs
      .filter(d => d.slug !== 'index')
      .map(d => ({
        loc: `${siteUrl}/docs/${d.slug}.html`,
        priority: '0.7',
        changefreq: 'monthly',
      })),
  ];
  const entries = urls.map(u =>
    `  <url>\n` +
    `    <loc>${u.loc}</loc>\n` +
    `    <lastmod>${today}</lastmod>\n` +
    `    <changefreq>${u.changefreq}</changefreq>\n` +
    `    <priority>${u.priority}</priority>\n` +
    `  </url>`
  ).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>
`;
}

function renderRobots(siteUrl) {
  return `# VIMATHIC — vimathic.com
#
# Cloudflare auto-prepends a managed content block above this file
# that handles AI crawler controls (training bots disallowed,
# search bots allowed). We trust that default rather than override
# it — see https://blog.cloudflare.com/ai-bots-content-controls/.
#
# This file only contributes:
#   - the default Allow for any unlisted user-agent
#   - the sitemap pointer for search engines
#
# To change AI crawler policy: toggle in the Cloudflare dashboard,
# not here.

User-agent: *
Allow: /

Sitemap: ${siteUrl}/sitemap.xml
`;
}

function renderLlmsTxt(siteUrl, docs) {
  const docLinks = docs
    .filter(d => d.slug !== 'index')
    .map(d => {
      const url = `${siteUrl}/docs/${d.slug}.html`;
      const desc = d.description ? `: ${d.description}` : '';
      return `- [${d.title}](${url})${desc}`;
    })
    .join('\n');
  return `# VIMATHIC

> VIMATHIC is a browser-based mathematical VJ studio. It runs entirely in a modern web browser with no installation, accounts, or plugins, and turns audio into real-time visualizations driven by 192 canonical mathematical formulas, 38 GPU shaders, and 36 colour schemes.

VIMATHIC is source-available under Business Source License 1.1 (auto-converting to GPL v3 in 2031). The entire application is bundled into a single HTML file (~900 KB) plus four companion files. It runs offline after first load and makes no telemetry or analytics calls. Recording, MIDI controller support, second-screen output, OBS integration, and a built-in shader editor are all included.

The math accuracy is documented per-formula with tier classification: 120 formulas at IEEE 754 double precision (~10⁻¹⁴), 44 with bounded numerical approximations (10⁻³ to 10⁻⁷), and 28 at visualisation-grade. Reference values cross-checked against mpmath, scipy.special, and NIST DLMF.

## Documentation

${docLinks}

## Repository

- [GitHub repository](https://github.com/vimathic/vimathic)
- [Mathematical Accuracy methodology](https://github.com/vimathic/vimathic/blob/main/MATHEMATICAL_ACCURACY.md)
- [Science references](${siteUrl}/docs/science.html)
- [License](${siteUrl}/docs/license.html)

## Stack

Three.js (WebGL) · Web Audio API · Web MIDI API · Vite + vite-plugin-singlefile · micromark

## Author

S. Melentyev, in collaboration with Claude (Anthropic AI). AI assistance is openly disclosed.
`;
}

export function vimathicDocs(opts = {}) {
  const docsDir = path.resolve(process.cwd(), opts.dir ?? DEFAULT_DOCS_DIR);
  const siteUrl = (opts.siteUrl ?? DEFAULT_SITE_URL).replace(/\/$/, '');

  return {
    name: 'vimathic-docs',

    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
      return null;
    },

    load(id) {
      if (id !== RESOLVED_ID) return null;
      const docs = loadAll(docsDir);
      const lean = docs.map(({ raw, ...rest }) => rest);
      return `export default ${JSON.stringify(lean)};`;
    },

    handleHotUpdate(ctx) {
      if (!ctx.file.startsWith(docsDir)) return;
      const mod = ctx.server.moduleGraph.getModuleById(RESOLVED_ID);
      if (mod) {
        ctx.server.moduleGraph.invalidateModule(mod);
        return [mod];
      }
    },

    configureServer(server) {
      server.watcher.add(docsDir);
    },

    closeBundle() {
      const docs = loadAll(docsDir);
      if (docs.length === 0) {
        console.warn('[vimathic-docs] No docs to emit (documents/ empty or missing)');
        return;
      }

      const distDir = path.resolve(process.cwd(), 'dist');
      const docsDistDir = path.join(distDir, 'docs');

      if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });
      if (!fs.existsSync(docsDistDir)) fs.mkdirSync(docsDistDir, { recursive: true });

      let staticCount = 0;
      for (const doc of docs) {
        const filename = doc.slug === 'index' ? 'index.html' : `${doc.slug}.html`;
        const outPath = path.join(docsDistDir, filename);
        fs.writeFileSync(outPath, renderStaticPage(doc, siteUrl, docs), 'utf8');
        staticCount++;
      }
      console.log(`[vimathic-docs] Emitted ${staticCount} static HTML pages → dist/docs/`);

      fs.writeFileSync(path.join(distDir, 'sitemap.xml'), renderSitemap(siteUrl, docs), 'utf8');
      console.log('[vimathic-docs] Emitted dist/sitemap.xml');

      fs.writeFileSync(path.join(distDir, 'robots.txt'), renderRobots(siteUrl), 'utf8');
      console.log('[vimathic-docs] Emitted dist/robots.txt');

      fs.writeFileSync(path.join(distDir, 'llms.txt'), renderLlmsTxt(siteUrl, docs), 'utf8');
      console.log('[vimathic-docs] Emitted dist/llms.txt');
    },
  };
}
