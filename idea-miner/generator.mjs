/**
 * generator.mjs — LLM Build Card generation + schema validation (SPEC.md §6.5; Req 4).
 *
 * generate() calls Claude (Anthropic API), validates the result against the §5.2 schema,
 * retries once with the error appended, and on a second failure emits a Failed_Card
 * (status="failed") carrying the raw output. It never sets a builder.* field. The Claude
 * call is injectable so the suite never hits the network.
 */

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const MODEL = 'claude-haiku-4-5-20251001'; // current Haiku (improvement over the design's 3.5 id)
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const SCHEMA_PATH = path.join(import.meta.dirname, '..', 'fixtures', 'sample-spec.md');
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

/** @typedef {{valid:boolean, errors:string[]}} ValidationResult */

// ---- prompts ----

export function buildSystemPrompt() {
  return [
    'You are a technical product manager. Given developer complaints, produce a DevTool',
    'Build Card in the EXACT YAML+Markdown format provided. You MUST return ONLY the file',
    'content — no preamble, no code fences, no commentary. The file is a YAML front-matter',
    'block (delimited by ---) followed by Markdown sections including ## Acceptance Criteria.',
  ].join('\n');
}

export function buildUserPrompt(cluster, config, schemaTemplate, errorMsg) {
  const subreddits = [...new Set(cluster.posts.map((p) => p.subreddit))].join(', ');
  const complaints = cluster.posts
    .map((p) => `- (paraphrase, strip usernames/PII) ${String(p.body ?? '').slice(0, 400)}`)
    .join('\n');
  const retry = errorMsg ? `\n\nYour previous output FAILED validation:\n${errorMsg}\nFix every issue and return only the corrected file.\n` : '';
  return [
    `Theme: ${config.theme}`,
    `Cluster: ${cluster.name}   Unique authors: ${cluster.uniqueAuthors}   Subreddits: ${subreddits}`,
    `Complaint count: ${cluster.posts.length}`,
    `Complaints:\n${complaints}`,
    `\nSchema (reproduce this structure EXACTLY, filling all fields; status must be "inbox"; all builder.* must be null):\n${schemaTemplate}`,
    retry,
  ].join('\n');
}

async function callClaude(systemPrompt, userPrompt, fetchImpl = globalThis.fetch) {
  const res = await fetchImpl(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      // cache the large schema-bearing system prompt across clusters in a run
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic returned HTTP ${res.status}`);
  const data = await res.json();
  return data.content?.[0]?.text ?? '';
}

// ---- validation ----

function parseFrontMatter(text) {
  const parts = String(text).split(/^---\s*$/m);
  if (parts.length < 3) return null;
  try { return { fm: yaml.load(parts[1]), body: parts.slice(2).join('---') }; }
  catch { return null; }
}

const isNonEmptyStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isPosInt = (v) => Number.isInteger(v) && v > 0;
const isStrArray = (v) => Array.isArray(v) && v.length > 0 && v.every(isNonEmptyStr);

/** @returns {ValidationResult} */
export function validateCard(text, themes) {
  const errors = [];
  const parsed = parseFrontMatter(text);
  if (!parsed) return { valid: false, errors: ['front-matter missing or not valid YAML'] };
  const { fm, body } = parsed;
  const check = (cond, msg) => { if (!cond) errors.push(msg); };

  check(isNonEmptyStr(fm?.id) && UUID_V4.test(fm.id), 'id must be a UUID v4');
  check(String(fm?.schema_version) === '1', 'schema_version must be "1"');
  check(isNonEmptyStr(fm?.created_at) && ISO_8601.test(fm.created_at), 'created_at must be ISO 8601');
  check(isNonEmptyStr(fm?.updated_at) && ISO_8601.test(fm.updated_at), 'updated_at must be ISO 8601');
  check(isNonEmptyStr(fm?.title), 'title must be a non-empty string');
  check(isNonEmptyStr(fm?.theme) && themes.some((t) => t.id === fm.theme), 'theme must match a known theme id');
  check(fm?.status === 'inbox', 'status must be "inbox"');

  check(isNonEmptyStr(fm?.persona?.role) && isNonEmptyStr(fm?.persona?.org_size) && isNonEmptyStr(fm?.persona?.stack_context), 'persona.role/org_size/stack_context required');

  const pop = fm?.proof_of_pain;
  check(isPosInt(pop?.unique_authors) && isPosInt(pop?.subreddit_count) && isPosInt(pop?.timeframe_days), 'proof_of_pain counts must be positive integers');
  check(Array.isArray(pop?.sample_complaints) && pop.sample_complaints.length > 0 &&
    pop.sample_complaints.every((c) => isNonEmptyStr(c?.text) && isNonEmptyStr(c?.source_url) && c?.reddit_score != null && isNonEmptyStr(c?.scraped_at)),
    'proof_of_pain.sample_complaints must be a non-empty array of {text, source_url, reddit_score, scraped_at}');

  check(isStrArray(fm?.why_now), 'why_now must be a non-empty string array');

  const bs = fm?.build_suggestion;
  check(isNonEmptyStr(bs?.summary), 'build_suggestion.summary required');
  check(isStrArray(bs?.key_capabilities), 'build_suggestion.key_capabilities must be a non-empty string array');
  check(isNonEmptyStr(bs?.tech_constraints?.language) && isNonEmptyStr(bs?.tech_constraints?.runtime), 'build_suggestion.tech_constraints needs language and runtime');

  const ss = fm?.signal_strength;
  check(typeof ss?.score === 'number' && ss.score >= 0 && ss.score <= 1, 'signal_strength.score must be a float in [0,1]');
  check(isNonEmptyStr(ss?.explanation), 'signal_strength.explanation required');

  check(fm?.builder && typeof fm.builder === 'object' && Object.values(fm.builder).every((v) => v === null), 'builder.* fields must all be null');

  check(/##\s*Acceptance Criteria/i.test(body) && /-\s*\[ \]/.test(body), 'body must contain ## Acceptance Criteria with at least one - [ ] item');

  return { valid: errors.length === 0, errors };
}

// ---- failed card ----

export function injectFailedStatus(rawText, errorMsg) {
  const fm = {
    status: 'failed', schema_version: '1', error: String(errorMsg ?? 'validation failed'),
    builder: { session_id: null, repo_url: null, pr_url: null, box_task_id: null, phase: null, last_run_at: null, tests_pass: null, build_pass: null },
  };
  return `---\n${yaml.dump(fm)}---\n\n# Failed Card\n\nThe LLM output did not validate after one retry.\n\n## Validation error\n${errorMsg ?? ''}\n\n## Raw LLM output\n${rawText ?? ''}\n`;
}

// ---- orchestration ----

/**
 * @param {object} cluster @param {object} config @param {{id:string}[]} themes
 * @param {{callClaudeImpl?:Function}} [deps]
 * @returns {Promise<string>} spec.md content (a valid card, or a Failed_Card)
 */
export async function generate(cluster, config, themes, { callClaudeImpl = callClaude } = {}) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is required to generate cards (SPEC §13) — aborting, no API call made');
  const schemaTemplate = fs.readFileSync(SCHEMA_PATH, 'utf8');
  const system = buildSystemPrompt();

  const attempt = async (errorMsg) => {
    try {
      const text = await callClaudeImpl(system, buildUserPrompt(cluster, config, schemaTemplate, errorMsg));
      const res = validateCard(text, themes);
      return { text, valid: res.valid, errors: res.errors };
    } catch (err) {
      return { text: '', valid: false, errors: [`transport error: ${err.message}`] };
    }
  };

  const first = await attempt();
  if (first.valid) return first.text;

  const second = await attempt(first.errors.join('; '));
  if (second.valid) return second.text;

  return injectFailedStatus(second.text || first.text, second.errors.join('; '));
}
