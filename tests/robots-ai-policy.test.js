// tests/robots-ai-policy.test.js
//
// Contract test for the AI-crawler policy the build emits in dist/robots.txt.
//
// Run:
//   node --test tests/robots-ai-policy.test.js
//
// ── What this pins ────────────────────────────────────────────────────────────
// The site publishes llms.txt — a summary written for language models — and at
// the same time sits behind Cloudflare's managed block, which disallows the AI
// crawlers. Both are correct only because "AI crawler" is two different things:
// bots that collect for TRAINING, and agents that read a page because a person
// asked. The managed block turns away the first kind; llms.txt is addressed to
// the second. Nothing in the file said so, so the two artefacts read as a
// contradiction and the next person to touch either could resolve it the wrong
// way.
//
// These tests hold the split in place: the read-time agents keep an explicit
// Allow, and that list can never overlap the training list Cloudflare blocks —
// which would make our own file argue with itself.
//
// Not covered here, deliberately: whether the edge honours any of it. Measured
// 2026-08-12, every agent below gets HTTP 403 from the WAF, robots.txt
// notwithstanding. That is a Cloudflare dashboard setting, unreachable from
// this repository and untestable from it.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

const SITE = 'https://vimathic.com';

let renderRobots, READ_TIME_AI_AGENTS;
before(async () => {
  ({ renderRobots, READ_TIME_AI_AGENTS } = await import('../plugins/vimathic-docs.js'));
});

// The training crawlers Cloudflare's managed block prepends with `Disallow: /`,
// read off the live file on 2026-08-12. Kept here only to prove our allow-list
// never intersects it — not to reproduce it.
// Stated here rather than read from READ_TIME_AI_AGENTS on purpose: a test that
// iterates the list it is checking cannot notice a deletion from that list.
// These three are the agents behind the assistants people actually ask about a
// page, so dropping one is a policy change and has to be made deliberately.
const MUST_BE_ALLOWED = ['Claude-User', 'OAI-SearchBot', 'PerplexityBot'];

const CLOUDFLARE_BLOCKS_FOR_TRAINING = [
  'Amazonbot', 'Applebot-Extended', 'Bytespider', 'CCBot', 'ClaudeBot',
  'CloudflareBrowserRenderingCrawler', 'Google-Extended', 'GPTBot',
  'meta-externalagent',
];

/**
 * robots.txt as { userAgent: [directive lines] }.
 * Comments and blank lines drop out; a group runs until the next User-agent.
 */
function parseGroups(txt) {
  const groups = {};
  let current = null;

  for (const raw of txt.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;

    const ua = line.match(/^User-agent:\s*(.+)$/i);
    if (ua) { current = ua[1].trim(); groups[current] ??= []; continue; }
    if (current) groups[current].push(line);
  }
  return groups;
}

const allows = (groups, ua) =>
  (groups[ua] ?? []).some(d => /^Allow:\s*\/$/i.test(d)) &&
  !(groups[ua] ?? []).some(d => /^Disallow:\s*\/$/i.test(d));

describe('robots.txt states the read-vs-train split it means', () => {

  test('every read-time AI agent gets an explicit Allow of its own', () => {
    const groups = parseGroups(renderRobots(SITE));

    for (const ua of READ_TIME_AI_AGENTS) {
      assert.ok(groups[ua], `no group for ${ua} — it inherits whatever * happens to say`);
      assert.ok(allows(groups, ua), `${ua} is not allowed by its own group`);
    }
  });

  test('the agents assistants actually read with cannot be dropped silently', () => {
    const groups = parseGroups(renderRobots(SITE));

    for (const ua of MUST_BE_ALLOWED) {
      assert.ok(allows(groups, ua),
        `${ua} lost its Allow — llms.txt is addressed to agents like this one`);
    }
  });

  test('the allow-list never overlaps the training list Cloudflare blocks', () => {
    // An agent in both places makes the served file contradict itself, and
    // which half wins is left to each crawler's merge rules.
    for (const ua of READ_TIME_AI_AGENTS) {
      assert.ok(!CLOUDFLARE_BLOCKS_FOR_TRAINING.includes(ua),
        `${ua} is a training crawler Cloudflare disallows — allowing it here reverses ` +
        `the training policy by accident`);
    }
  });

  test('the file still points search engines at the sitemap', () => {
    assert.match(renderRobots(SITE), /^Sitemap: https:\/\/vimathic\.com\/sitemap\.xml$/m);
  });

  test('the catch-all group is unchanged — unlisted agents are welcome', () => {
    assert.ok(allows(parseGroups(renderRobots(SITE)), '*'));
  });

  test('the comment tells the next reader where the training toggle lives', () => {
    // The policy is split across two systems; a file that does not say so
    // invites someone to "fix" the apparent contradiction in the wrong one.
    const txt = renderRobots(SITE);
    assert.match(txt, /llms\.txt/, 'nothing explains who the Allow groups are for');
    assert.match(txt, /Cloudflare dashboard/, 'nothing says where the training policy lives');
  });

  // ── controls: the probe has to be able to fail ──────────────────────────────

  test('control — the parser reports a Disallow when there is one', () => {
    const groups = parseGroups('User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n');
    assert.equal(allows(groups, 'GPTBot'), false);
    assert.equal(allows(groups, '*'), true);
  });

  test('control — the parser does not read commented-out directives', () => {
    const groups = parseGroups('# User-agent: Ghost\n# Allow: /\nUser-agent: *\nAllow: /\n');
    assert.deepEqual(Object.keys(groups), ['*']);
  });

  test('control — the allow-list is not empty', () => {
    assert.ok(READ_TIME_AI_AGENTS.length > 0,
      'an empty list passes every assertion above without asserting anything');
  });
});
