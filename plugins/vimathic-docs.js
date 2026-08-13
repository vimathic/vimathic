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
//   // DOCS is an array of { slug, title, order, group, description, html },
//   // sorted by `order` then `title`, ready to drive a tabs UI.
//
// FIX(#45, r4): that line used to promise `raw` and to omit `group`, and it
// was wrong in both directions. load() strips `raw` on the way out — the
// markdown source would roughly double the docs payload inside the single-file
// bundle — so a consumer written against the old contract read `undefined`
// with nothing to warn it, while `group`, the field about-modal.js branches on
// to decide standalone tab versus dropdown, was the one nobody had written
// down. Keep this list and the object parseDoc returns in step.
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
import { execFileSync } from 'node:child_process';
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

// Drops `<!-- ... -->` blocks, including multi-line ones. Fenced code blocks
// are masked out first: a comment shown as an HTML example inside a fence is
// content the page is meant to display, not an aside about the page. The
// placeholder is a Unicode private-use character, which cannot occur in real
// prose, so restoring a fence can never collide with document text.
const FENCE_MARK = '\uE000';

function stripHtmlComments(md) {
  const fences = [];
  const masked = md.replace(/^ {0,3}(`{3,}|~{3,})[\s\S]*?^ {0,3}\1[ \t]*$/gm, (m) => {
    fences.push(m);
    return FENCE_MARK + (fences.length - 1) + FENCE_MARK;
  });
  return masked
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(new RegExp(FENCE_MARK + '(\\d+)' + FENCE_MARK, 'g'), (_, i) => fences[Number(i)]);
}

function parseDoc(filepath, source) {
  const slug = path.basename(filepath, '.md');
  const meta = { title: null, order: 1000, description: null, group: null };
  let body = source;

  // FIX(#39, r4): the fences and the lines between them used to require a bare
  // LF. Git's Windows default (core.autocrlf=true) normalises CRLF away on
  // commit but converts LF back to CRLF *on checkout*, so a Windows clone has a
  // CRLF working tree — and this plugin reads the working tree. Nothing matched
  // there: every document fell back to a title-cased slug and order 1000, lost
  // its group, and printed its own YAML block as body text, which is exactly
  // the About-modal failure the `order: 0` fix above was written to prevent.
  const fmMatch = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (fmMatch) {
    const [, fmBlock, rest] = fmMatch;
    body = rest;
    for (const rawLine of fmBlock.split('\n')) {
      const line = rawLine.replace(/\r$/, '');
      const m = line.match(/^([a-zA-Z_][\w-]*)\s*:\s*(.+)$/);
      if (!m) continue;
      const [, key, value] = m;
      const trimmed = value.trim().replace(/^["']|["']$/g, '');
      if (key === 'order') {
        // FIX: `|| 1000` turned a legitimate `order: 0` into the default, and
        // documents/index.md (the Overview tab) declares exactly that — so it
        // sorted last and the About modal, which opens DOCS[0] on first run,
        // opened Quick Start instead of the overview it was written to show.
        // FIX(#40, r4): parseInt stops at the first character it cannot use and
        // hands back what it read so far, so `order: 4.5` arrived as 4 — a
        // silent tie with whatever already holds 4, broken by an unrelated
        // document's title — and `order: 6 spaces` arrived as 6. The guard
        // above cannot see either, because it only ever meets the truncated
        // number. Number() reads the whole value or nothing, which is what the
        // test pinning this parse says it does ("the docs plugin reads
        // frontmatter numbers as numbers"). The empty string is spelled out
        // because Number('') is 0, and an order left blank is not order zero.
        const n = trimmed === '' ? NaN : Number(trimmed);
        meta.order = Number.isFinite(n) ? n : 1000;
      }
      else if (key === 'title') meta.title = trimmed;
      else if (key === 'description') meta.description = trimmed;
      else if (key === 'group') meta.group = trimmed;
    }
  }

  if (!meta.title) {
    meta.title = slug.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
  }

  // `allowDangerousHtml: true` passes raw HTML straight through, and that
  // includes comments — so an author's `<!-- note to self -->` lands verbatim
  // in dist/docs/*.html and, because the About modal embeds the same strings,
  // in the single-file dist/index.html that users download. Markdown comments
  // read as private; strip them so they behave that way. Done on the source so
  // a comment can never be half-rendered into surrounding markup.
  const html = micromark(stripHtmlComments(body), MICROMARK_OPTS);

  let description = meta.description;
  if (!description) {
    const pMatch = html.match(/<p>([\s\S]*?)<\/p>/);
    if (pMatch) {
      // FIX(#38, r4): a paragraph of rendered HTML is not plain text, and
      // stripping its tags does not make it so. micromark has already written
      // `&` as `&amp;` and `"` as `&quot;`, and it keeps the author's line
      // break. Both consumers of this string want text: renderStaticPage runs
      // it through escapeHtml, which turned `&amp;` into `&amp;amp;` so the
      // crawler read the entity code itself, and renderLlmsTxt drops it into a
      // markdown list item, where the codes showed up verbatim in a plain-text
      // file and the newline split one link entry across two lines — breaking
      // the one-entry-per-line shape llms.txt exists to provide. Decoded in the
      // reverse of escapeHtml's order, ampersand LAST, so that an escaped
      // `&amp;lt;` unwinds to `&lt;` and not all the way to `<`. The whitespace
      // collapse also stops slice(157) landing in the middle of an entity.
      description = pMatch[1]
        .replace(/<[^>]+>/g, '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
        .trim();
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

// FIX(#21): added `'` escaping. Every attribute in the templates below happens
// to be written with double quotes, so a raw apostrophe was harmless in
// practice — but that made the safety a property of the call sites rather than
// of this function. One single-quoted attribute added later would have been an
// injection point. `&` stays first: escaping it after the others would
// re-escape the ampersands they just introduced (`&lt;` → `&amp;lt;`).
// `&#39;` rather than `&apos;` — the numeric form is valid in HTML4 too.
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderStaticPage(doc, siteUrl, allDocs) {
  const canonical = `${siteUrl}/docs/${doc.slug === 'index' ? '' : doc.slug + '.html'}`;
  // Convert relative .md links to .html for static pages. The modal version
  // keeps .md because about-modal.js has a cross-doc handler that accepts both.
  //
  // FIX(#41, r4): a document addresses its images relative to the page that
  // embeds them, and in the app that page is dist/index.html — so `./x.webp`
  // means "the file next to the bundle", which resolves under a sub-path deploy
  // and over the file:// deploy README.md documents. (The Roadmap hero used to
  // be written `/support-hero.png`, which from file:// points at the filesystem
  // root and showed the alt text instead.) These static pages live one level
  // down in dist/docs/, so the same reference has to climb back out. Only
  // src/srcset move: the .md→.html links above are docs-internal and already
  // point at siblings in this directory.
  const html = doc.html
    .replace(/href="(\.\/[a-z0-9-]+)\.md"/g, 'href="$1.html"')
    .replace(/\b(src|srcset)="\.\/([^"]*)"/g, '$1="../$2"');
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

// FIX(#47, r4): when a document last changed, as a date. <lastmod> used to be
// one `new Date()` stamped onto every URL, i.e. the BUILD date — and Cloudflare
// Pages rebuilds on every push to main, so a commit touching only the CHANGELOG
// republished a sitemap swearing that all fifteen pages had changed that day.
// The sitemaps.org 0.9 schema this file declares defines <lastmod> as "the date
// of last modification of the file", and a value that is always today is the
// one value that carries no information at all — crawlers discount it.
// The commit date is asked for first because it survives a fresh clone, where
// every mtime is the moment of checkout and therefore says nothing. mtime is
// the answer for a document git does not know — one not yet committed, or a
// copy of the tree with no git in it at all.
function lastModified(filepath, fallback) {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cs', '--', path.basename(filepath)], {
      cwd: path.dirname(filepath), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(out)) return out;
  } catch {
    // Not a git checkout, or git is not installed. mtime below.
  }
  try {
    return fs.statSync(filepath).mtime.toISOString().slice(0, 10);
  } catch {
    return fallback;
  }
}

function renderSitemap(siteUrl, docs, docsDir) {
  const today = new Date().toISOString().slice(0, 10);
  const dates = new Map(docs.map(d =>
    [d.slug, lastModified(path.join(docsDir, `${d.slug}.md`), today)]));
  // ISO dates sort as strings, so the newest is simply the last one.
  const newestDoc = [...dates.values()].sort().at(-1) ?? today;
  const urls = [
    // The bundle really is rebuilt on every deploy, so the root keeps the build
    // date. The docs landing page lists every document, so it changes whenever
    // the newest of them does.
    { loc: `${siteUrl}/`,        lastmod: today,      priority: '1.0', changefreq: 'weekly' },
    { loc: `${siteUrl}/docs/`,   lastmod: newestDoc,  priority: '0.9', changefreq: 'monthly' },
    ...docs
      .filter(d => d.slug !== 'index')
      .map(d => ({
        loc: `${siteUrl}/docs/${d.slug}.html`,
        lastmod: dates.get(d.slug),
        priority: '0.7',
        changefreq: 'monthly',
      })),
  ];
  const entries = urls.map(u =>
    `  <url>\n` +
    `    <loc>${u.loc}</loc>\n` +
    `    <lastmod>${u.lastmod}</lastmod>\n` +
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

// The AI-crawler policy has two halves, and they are not the same answer:
//
//   training  (GPTBot, ClaudeBot, CCBot, Google-Extended, …) — NO
//   reading   (Claude-User, OAI-SearchBot, PerplexityBot, …) — YES
//
// The second half is the whole reason llms.txt exists: a summary written for
// LLMs is pointless if the agents that would read it are turned away. It also
// matches the content signal Cloudflare's managed block already publishes on
// `User-agent: *` — `search=yes, ai-train=no, use=reference`. "use=reference"
// IS the invitation; these groups just say the same thing to the named agents
// so it cannot be lost when the managed list grows.
//
// Cloudflare auto-prepends that managed block above this file and lists the
// training crawlers there with `Disallow: /` — we trust that default rather
// than restate it (https://blog.cloudflare.com/ai-bots-content-controls/).
//
// CAVEAT, measured 2026-08-12: robots.txt is the stated policy, the WAF is the
// enforced one, and they disagree. Every agent below currently gets HTTP 403 at
// the edge — OAI-SearchBot, PerplexityBot and Claude-User included — because
// Cloudflare's AI bot blocking does not split training from reading the way
// this file does. Fixing that is a dashboard toggle (AI Crawl Control → allow
// user-initiated / search agents), not a code change. Until it is flipped,
// these groups state the intent; they do not deliver it.
export const READ_TIME_AI_AGENTS = [
  'Claude-User',
  'Claude-SearchBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'PerplexityBot',
  'Perplexity-User',
];

export function renderRobots(siteUrl) {
  const readTime = READ_TIME_AI_AGENTS
    .map(ua => `User-agent: ${ua}\nAllow: /`)
    .join('\n\n');

  return `# VIMATHIC — vimathic.com
#
# Cloudflare auto-prepends a managed content block above this file that
# disallows the AI *training* crawlers. We trust that default rather than
# override it — see https://blog.cloudflare.com/ai-bots-content-controls/.
#
# This file contributes:
#   - an explicit Allow for AI agents that READ on a user's behalf or for
#     search indexing, as opposed to training (see llms.txt, written for them)
#   - the default Allow for any unlisted user-agent
#   - the sitemap pointer for search engines
#
# To change the AI *training* policy: toggle in the Cloudflare dashboard,
# not here.

${readTime}

User-agent: *
Allow: /

Sitemap: ${siteUrl}/sitemap.xml
`;
}

// FIX(#30): the counts in the prose below had drifted from the sources.
// They are hand-maintained (llms.txt is a summary, not generated from the
// catalogue), so re-check them against these files when any of them change:
//   192 formulas  → src/math-collections.js (12 collections, 192 entries)
//   38 GPU shaders→ the shader <optgroup>s in index.html (#gpu-sel, 0..37)
//   44 schemes    → COLOR_SCHEME_COUNT in src/params.js (was stated as 36)
//   122/42/28     → the tier table in MATHEMATICAL_ACCURACY.md
//                   (was stated as 120/44/28; A+B = 164, A+B+C = 192)
// FIX(#30, r2): the bundle size was missed in the first pass and still read
// "~900 KB". Taken from the built artifact — dist/index.html is ~1.10 MB — and
// quoted to one decimal so the few KB every commit adds do not make it stale
// again. documents/index.md quotes the same file the same way; keep the two in
// step and re-check both against dist/index.html after a release build.
// FIX(#46, r4): the companion-file count was the one number in that paragraph
// nobody re-checked. It said "plus four companion files" — five files in all —
// while the two texts a reader would compare it against, SECURITY.md and
// documents/index.md, both describe a deploy of four files INCLUDING
// index.html. llms.txt is the machine-readable one of the three, so an LLM
// answering "what does a VIMATHIC deploy consist of" was the reader most
// likely to be told the wrong thing. Named rather than counted now, in the
// same words documents/index.md uses: an enumeration cannot drift by one in
// silence, and tests/build-docs-plugin.test.js checks the count against
// SECURITY.md's list on every run.
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

> VIMATHIC is a browser-based mathematical VJ studio. It runs entirely in a modern web browser with no installation, accounts, or plugins, and turns audio into real-time visualizations driven by 192 canonical mathematical formulas, 38 GPU shaders, and 44 colour schemes.

VIMATHIC is source-available under Business Source License 1.1 (auto-converting to GPL v3 four years after each version's release — 2030-05-18 for 1.0.0-beta). The entire application is bundled into a single HTML file (~1.1 MB) plus three companion files: a Web Worker for off-main-thread math, the second-screen popup target, and the bundled intro track. It runs offline after first load and makes no telemetry or analytics calls. Recording, MIDI controller support, second-screen output, OBS integration, and a built-in shader editor are all included.

The math accuracy is documented per-formula with tier classification: 122 formulas at IEEE 754 double precision (~10⁻¹⁴), 42 with bounded numerical approximations (10⁻³ to 10⁻⁷), and 28 at visualisation-grade. Reference values cross-checked against mpmath, scipy.special, and NIST DLMF.

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

  // FIX(#49, r4): where the emitted files go is Vite's answer to give, not
  // ours. closeBundle() used to re-derive it as <cwd>/dist, so with any other
  // build.outDir — the one place vite.config.js configures the output — Vite
  // wrote the bundle to one directory while this plugin created a second one
  // beside it and put the docs site, sitemap, robots.txt and llms.txt in
  // there. The build reported success and the deploy silently lost half of
  // itself. Left null until Vite says otherwise so that calling closeBundle()
  // outside a build (the tests do) keeps the documented <cwd>/dist behaviour.
  let outDir = null;

  return {
    name: 'vimathic-docs',

    configResolved(config) {
      outDir = path.resolve(config.root ?? process.cwd(), config.build?.outDir ?? 'dist');
    },

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

      const distDir = outDir ?? path.resolve(process.cwd(), 'dist');
      const docsDistDir = path.join(distDir, 'docs');
      // The log lines below name the real destination rather than the literal
      // "dist", for the same reason the destination itself is no longer a
      // literal: a build log that says dist/ while writing somewhere else is
      // how the split in FIX(#49) stayed invisible.
      const out = path.basename(distDir);

      if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });
      if (!fs.existsSync(docsDistDir)) fs.mkdirSync(docsDistDir, { recursive: true });

      let staticCount = 0;
      for (const doc of docs) {
        const filename = doc.slug === 'index' ? 'index.html' : `${doc.slug}.html`;
        const outPath = path.join(docsDistDir, filename);
        fs.writeFileSync(outPath, renderStaticPage(doc, siteUrl, docs), 'utf8');
        staticCount++;
      }
      console.log(`[vimathic-docs] Emitted ${staticCount} static HTML pages → ${out}/docs/`);

      fs.writeFileSync(path.join(distDir, 'sitemap.xml'), renderSitemap(siteUrl, docs, docsDir), 'utf8');
      console.log(`[vimathic-docs] Emitted ${out}/sitemap.xml`);

      fs.writeFileSync(path.join(distDir, 'robots.txt'), renderRobots(siteUrl), 'utf8');
      console.log(`[vimathic-docs] Emitted ${out}/robots.txt`);

      fs.writeFileSync(path.join(distDir, 'llms.txt'), renderLlmsTxt(siteUrl, docs), 'utf8');
      console.log(`[vimathic-docs] Emitted ${out}/llms.txt`);
    },
  };
}
