/**
 * VIMATHIC — Mathematical VJ Studio
 * Copyright (c) 2026 S. Melentyev. All rights reserved.
 * Licensed under BUSL-1.1 — see LICENSE.txt
 * https://github.com/vimathic/vimathic
 */

// src/ui/about-modal.js — Documentation modal with browser-style tabs.
//
// Docs come from the build-time virtual module produced by plugins/vimathic-docs.js.
// At build time it reads `documents/*.md`, parses to safe HTML, and exposes the
// list here. To update docs: edit the .md file, rebuild — no code changes.
//
// Public API:
//   bindAboutModal()  — wire button + escape; idempotent (safe to call once at boot).
//
// DOM contract:
//   #btn-about         — trigger button (info icon)
//   #about-overlay     — fixed-position backdrop
//   #about-box         — modal frame
//   #about-tabs        — horizontal tab strip (filled by JS)
//   #about-content     — scrolling panel for active doc's HTML
//   #about-close       — × button in header
//
// Why tabs are generated in JS instead of HTML:
//   • The doc list is dynamic at build time. Hard-coding tab buttons in
//     index.html would force every doc rename to touch HTML too.
//   • Empty-state ("no docs yet") needs a different render entirely. Keeping
//     both paths in one place avoids HTML stubs that lie about content.

import DOCS from 'virtual:vimathic-docs';
import {
  VIMATHIC_VERSION,
  VIMATHIC_BUILD_HASH,
  VIMATHIC_BUILD_DATE,
  VIMATHIC_REPO_URL,
} from 'virtual:vimathic-build-info';

const LS_LAST_TAB = 'vimathic_about_last_tab';

let _wired = false;
let _activeSlug = null;

export function bindAboutModal() {
  if (_wired) return;
  _wired = true;

  const btn      = document.getElementById('btn-about');
  const overlay  = document.getElementById('about-overlay');
  const tabsEl   = document.getElementById('about-tabs');
  const contentEl = document.getElementById('about-content');
  const closeBtn = document.getElementById('about-close');

  // Defensive: if HTML hasn't been updated yet, skip wiring rather than crash.
  if (!btn || !overlay || !tabsEl || !contentEl || !closeBtn) {
    console.warn('[about-modal] DOM elements missing; modal disabled.');
    return;
  }

  btn.addEventListener('click', () => open(tabsEl, contentEl, overlay));
  closeBtn.addEventListener('click', () => close(overlay));
}

function open(tabsEl, contentEl, overlay) {
  // Lazy-build the tab strip on first open. Cheap, but no point doing it
  // on boot if the user never opens the modal.
  if (!tabsEl.dataset.built) {
    buildTabs(tabsEl, contentEl);
    tabsEl.dataset.built = '1';
  }

  // Pick the tab to show:
  //   1. Remembered tab from a previous session, if it still exists.
  //   2. First tab.
  //   3. Empty-state if there are no docs.
  if (DOCS.length === 0) {
    contentEl.innerHTML = `<div class="about-empty">
      <p>No documentation yet.</p>
      <p style="opacity:.6">Drop <code>.md</code> files into <code>documents/</code> and rebuild.</p>
    </div>`;
  } else {
    const remembered = safeLocalStorage.get(LS_LAST_TAB);
    const target = DOCS.find(d => d.slug === remembered) || DOCS[0];
    showDoc(target.slug, tabsEl, contentEl);
  }

  overlay.classList.add('open');
}

function close(overlay) {
  overlay.classList.remove('open');
  // Close any open dropdown menus — they live in document.body so they'd
  // otherwise stay visible after the modal is dismissed.
  for (const m of document.querySelectorAll('.about-tab-group-menu')) {
    m.style.display = 'none';
  }
}

// ── Tab rendering with optional grouping ────────────────────────────────
// Docs without a `group` field render as standalone top-level tabs.
// Docs sharing a `group` field collapse into a dropdown menu.
//
// Group labels are derived from the slug-style `group` value via a small
// map so authors don't have to repeat the display title in every file.
// Unknown groups fall back to a title-cased version of the slug.

const GROUP_LABELS = {
  'getting-started': 'Getting Started',
  'production':      'Production',
  'about':           'About',
};

function groupLabel(slug) {
  if (GROUP_LABELS[slug]) return GROUP_LABELS[slug];
  return slug.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
}

/**
 * Walk DOCS in order. Emit:
 *  - standalone <button.about-tab> for docs without a group
 *  - one <div.about-tab-group> per group, containing a <button.about-tab-group-trigger>
 *    and a <div.about-tab-group-menu> with the group's docs as <button.about-tab>
 *
 * Group ordering follows the order of the FIRST doc with that group in DOCS.
 * Within a group, docs render in their natural `order` (already sorted).
 */
function buildTabs(tabsEl, contentEl) {
  tabsEl.innerHTML = '';

  // First pass: figure out group rendering positions.
  // For each unique group, we render it at the position of its first member.
  const seenGroups = new Set();
  const renderQueue = [];  // each item is either { kind: 'doc', doc } or { kind: 'group', group, docs: [] }

  for (const doc of DOCS) {
    if (!doc.group) {
      renderQueue.push({ kind: 'doc', doc });
      continue;
    }
    if (seenGroups.has(doc.group)) {
      // Append to the existing group entry
      const entry = renderQueue.find(e => e.kind === 'group' && e.group === doc.group);
      entry.docs.push(doc);
    } else {
      seenGroups.add(doc.group);
      renderQueue.push({ kind: 'group', group: doc.group, docs: [doc] });
    }
  }

  // Second pass: render
  for (const entry of renderQueue) {
    if (entry.kind === 'doc') {
      tabsEl.appendChild(makeStandaloneTab(entry.doc, tabsEl, contentEl));
    } else {
      tabsEl.appendChild(makeGroupTab(entry.group, entry.docs, tabsEl, contentEl));
    }
  }
}

function makeStandaloneTab(doc, tabsEl, contentEl) {
  const tab = document.createElement('button');
  tab.className   = 'about-tab';
  tab.dataset.slug = doc.slug;
  tab.textContent = doc.title;
  tab.addEventListener('click', () => showDoc(doc.slug, tabsEl, contentEl));
  return tab;
}

function makeGroupTab(groupKey, docs, tabsEl, contentEl) {
  const wrap = document.createElement('div');
  wrap.className = 'about-tab-group';
  wrap.dataset.group = groupKey;

  const trigger = document.createElement('button');
  trigger.className = 'about-tab about-tab-group-trigger';
  trigger.textContent = groupLabel(groupKey) + ' ▾';
  trigger.dataset.group = groupKey;

  // Menu lives in document.body (not inside wrap) so it can escape any
  // ancestor's stacking context, overflow:hidden, or transform. Position
  // is computed from the trigger's viewport rect on each open.
  //
  // color is set on the menu itself (not just inherited) so dropdown items
  // visibly match the tab text color (cyan-green accent of the project).
  // Without this, items fell back to the browser default near-black on the
  // dark menu background and were almost invisible.
  const menu = document.createElement('div');
  menu.className = 'about-tab-group-menu';
  menu.dataset.group = groupKey;
  menu.style.cssText = [
    'position:fixed',
    'background:#1a1a22',
    'border:1px solid #333',
    'border-radius:6px',
    'padding:.3em 0',
    'min-width:200px',
    'box-shadow:0 8px 24px rgba(0,0,0,.6)',
    'z-index:2147483647',  // max safe int — wins over anything
    'color:#0fc',          // match the tab-text accent so items are readable
    'display:none',
  ].join(';');

  for (const doc of docs) {
    const item = document.createElement('button');
    item.className   = 'about-tab about-tab-group-item';
    item.dataset.slug = doc.slug;
    item.textContent = doc.title;
    // color:inherit picks up the menu's #0fc above; explicit fallback kept
    // for safety in case a host stylesheet resets button colors.
    item.style.cssText = 'display:block;width:100%;text-align:left;padding:.5em 1em;background:transparent;border:0;color:inherit;cursor:pointer;font:inherit;white-space:nowrap;';
    item.addEventListener('mouseenter', () => { item.style.background = 'rgba(0,255,200,0.08)'; });
    item.addEventListener('mouseleave', () => { item.style.background = 'transparent'; });
    item.addEventListener('click', () => {
      showDoc(doc.slug, tabsEl, contentEl);
      menu.style.display = 'none';
    });
    menu.appendChild(item);
  }

  // Position menu just below trigger, aligned to trigger's left edge.
  // If menu would overflow viewport right edge, shift it left.
  function positionMenu() {
    const rect = trigger.getBoundingClientRect();
    const menuW = menu.offsetWidth || 200;
    const viewportW = window.innerWidth;
    let left = rect.left;
    if (left + menuW > viewportW - 8) {
      left = Math.max(8, viewportW - menuW - 8);
    }
    menu.style.top  = (rect.bottom + 4) + 'px';
    menu.style.left = left + 'px';
  }

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    // Close any other open menus first
    for (const m of document.querySelectorAll('.about-tab-group-menu')) {
      if (m !== menu) m.style.display = 'none';
    }
    if (menu.style.display === 'block') {
      menu.style.display = 'none';
    } else {
      menu.style.display = 'block';
      positionMenu();
    }
  });

  // Click-outside to close (anywhere except trigger or menu itself)
  document.addEventListener('click', (e) => {
    if (e.target !== trigger && !menu.contains(e.target)) {
      menu.style.display = 'none';
    }
  });

  // Reposition on viewport changes while menu is open
  window.addEventListener('resize', () => {
    if (menu.style.display === 'block') positionMenu();
  });
  window.addEventListener('scroll', () => {
    if (menu.style.display === 'block') positionMenu();
  }, true);

  wrap.style.cssText = 'display:inline-block;';
  wrap.appendChild(trigger);
  // Menu is attached to body, NOT to wrap — that's how it escapes
  // any parent's overflow / transform / stacking context.
  document.body.appendChild(menu);
  return wrap;
}

function showDoc(slug, tabsEl, contentEl) {
  const doc = DOCS.find(d => d.slug === slug);
  if (!doc) return;

  _activeSlug = slug;
  safeLocalStorage.set(LS_LAST_TAB, slug);

  // Highlight active tab — works for both standalone tabs and group items.
  // Also highlight the group trigger if active doc is inside a group.
  for (const t of tabsEl.querySelectorAll('.about-tab')) {
    t.classList.remove('active');
  }
  const activeTab = tabsEl.querySelector(`.about-tab[data-slug="${slug}"]`);
  if (activeTab) activeTab.classList.add('active');
  if (doc.group) {
    const trigger = tabsEl.querySelector(`.about-tab-group-trigger[data-group="${doc.group}"]`);
    if (trigger) trigger.classList.add('active');
  }

  // Render. Doc HTML is already sanitised at build time (micromark with
  // allowDangerousHtml: false). innerHTML is safe given that constraint.
  // Build info footer is appended below — same on every tab; serves as
  // proof-of-build for downstream copies.
  contentEl.innerHTML =
    `<article class="about-doc">${doc.html}</article>` +
    buildInfoFooterHtml();
  // Reset scroll on tab switch so user sees the top of each doc, not where
  // they were in the previous one.
  contentEl.scrollTop = 0;

  // ── Intercept cross-doc links ──────────────────────────────────────────
  // Markdown docs link to each other with relative paths like `./safety.md`
  // or `./safety.html`. In the static docs site (dist/docs/*.html) those
  // resolve correctly. Inside the About modal they would otherwise trigger
  // a real navigation to /safety.md, which 404s and reloads the page —
  // dropping the user out of the running visualizer.
  //
  // Delegated handler on `.about-doc`: if the click target is an <a> whose
  // href points at one of our doc slugs (with .md or .html suffix, with
  // or without ./ prefix), preventDefault and switch tabs internally.
  // External http(s) links, mailto:, and anchor links (#section) fall
  // through to default browser behaviour.
  const article = contentEl.querySelector('.about-doc');
  if (article) {
    article.addEventListener('click', (e) => {
      const a = e.target.closest('a');
      if (!a) return;
      const href = a.getAttribute('href') || '';
      // External / mailto / anchor / empty — leave alone.
      if (!href || /^(https?:|mailto:|#)/i.test(href)) return;
      // Pull out the slug from ./foo.md or foo.md or ./foo.html or foo.html
      const m = href.match(/^\.?\/?([a-z0-9-]+)\.(md|html)$/i);
      if (!m) return;
      const targetSlug = m[1];
      // Confirm it's a real doc; if not, let browser try (will 404, but
      // at least it's not us silently swallowing a typo).
      if (!DOCS.find(d => d.slug === targetSlug)) return;
      e.preventDefault();
      showDoc(targetSlug, tabsEl, contentEl);
    });
  }
}

// ── Build info footer ────────────────────────────────────────────────────
// Rendered below every doc tab. The hash + date come from the
// vimathic-build-info Vite plugin (reads `git rev-parse HEAD` at build).
// A pristine `dist/index.html` from this repo will display the upstream
// commit hash on any host that serves it — useful for tracing forks back
// to the upstream build.
function buildInfoFooterHtml() {
  // escape values defensively (they originate from package.json + git output,
  // but treating them as untrusted is cheaper than reasoning about it).
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
  }[c]));
  return (
    `<footer class="about-build-info" style="` +
    `margin-top:2em;padding-top:1em;border-top:1px solid rgba(255,255,255,0.1);` +
    `font-size:0.85em;opacity:0.6;text-align:center;font-family:monospace;` +
    `">` +
    `VIMATHIC ${esc(VIMATHIC_VERSION)} · ` +
    `build <code>${esc(VIMATHIC_BUILD_HASH)}</code> ` +
    `(${esc(VIMATHIC_BUILD_DATE)}) · ` +
    `<a href="${esc(VIMATHIC_REPO_URL)}" target="_blank" rel="noopener" ` +
    `style="color:inherit;text-decoration:underline;">source</a> · ` +
    `<a href="https://github.com/vimathic/vimathic/issues" target="_blank" rel="noopener" ` +
    `style="color:inherit;text-decoration:underline;">feedback</a> · ` +
    `<a href="mailto:vimathic.info@proton.me" ` +
    `style="color:inherit;text-decoration:underline;">email</a>` +
    `</footer>`
  );
}

// ── localStorage helpers ─────────────────────────────────────────────────
// In private/incognito modes, localStorage may throw on write. Treat all
// access as best-effort: missing persistence is a minor UX downgrade,
// not a crash.
const safeLocalStorage = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, val) {
    try { localStorage.setItem(key, val); } catch { /* ignore */ }
  },
};

// ── Exported for Escape-key handler in controls.js ──────────────────────
// Lets the existing Escape-closes-modals loop manage About too.
export const ABOUT_OVERLAY_ID = 'about-overlay';
