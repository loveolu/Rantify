/**
 * generator.mjs — LLM implementation-spec generation + schema validation (SPEC.md §6.5; Req 4).
 *
 * generate() takes a group of real user-feedback posts about a subject (a company or feature)
 * and asks Claude on Amazon Bedrock to write an implementation spec.md: the PROBLEM evidenced
 * by the feedback plus a proposed SOLUTION written as actionable build instructions. It
 * validates against the §5.2 schema, retries once with the error appended, and on a second
 * failure emits a Failed_Card (status="failed"). It never sets a builder.* field. The Bedrock
 * call is injectable so the suite never hits the network.
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import yaml from 'js-yaml';
import { callBedrock, buildBedrockBody, resolveModelId, assertBedrockEnv, DEFAULT_BEDROCK_MODEL_ID } from './bedrock.mjs';

// Re-exported so existing importers (and tests) keep a single entry point.
export { callBedrock, buildBedrockBody, resolveModelId, DEFAULT_BEDROCK_MODEL_ID };

const SCHEMA_PATH = path.join(import.meta.dirname, '..', 'fixtures', 'sample-spec.md');
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

/** @typedef {{valid:boolean, errors:string[]}} ValidationResult */

// ---- prompts ----

export function buildSystemPrompt() {
  return [
    'You are a senior product engineer. You are given real user feedback collected from Reddit',
    'about a specific product, company, or feature. Produce an implementation spec as a Build',
    'Card in the YAML+Markdown format provided. The card must (1) describe the PROBLEM the',
    'feedback reveals, grounded in the quotes, and (2) propose a SOLUTION written as actionable',
    'build instructions a developer or AI coding agent can follow, ending with a concrete',
    '## Acceptance Criteria checklist (at least one "- [ ]" item).',
    '',
    'Focus ONLY on these fields — everything else (id, schema_version, created_at, updated_at,',
    'status, theme, proof_of_pain counts + sample_complaints, builder) is filled in automatically,',
    'so omit or leave them as placeholders:',
    '  title, persona {role, org_size, stack_context}, why_now (list), build_suggestion {summary,',
    '  key_capabilities (list), tech_constraints {language, runtime}}, signal_strength.explanation,',
    '  and the Markdown body (## Problem Summary, ## Proposed Tool, ## Acceptance Criteria).',
    '',
    'You MUST return ONLY the file content — no preamble, no code fences, no commentary. The file',
    'is a YAML front-matter block (delimited by ---) followed by the Markdown sections.',
  ].join('\n');
}

export function buildUserPrompt(group, config, schemaTemplate, errorMsg) {
  const subject = config.subject ?? group.name;
  const subreddits = [...new Set(group.posts.map((p) => p.subreddit))].filter(Boolean).join(', ');
  const feedback = group.posts
    .map((p) => `- (paraphrase, strip usernames/PII) ${String(p.body ?? '').slice(0, 400)}`)
    .join('\n');
  const retry = errorMsg ? `\n\nYour previous output FAILED validation:\n${errorMsg}\nFix every issue and return only the corrected file.\n` : '';
  return [
    `Subject (what the feedback is about): ${subject}`,
    `Theme: ${config.theme}`,
    `Unique authors: ${group.uniqueAuthors}   Subreddits: ${subreddits}   Feedback count: ${group.posts.length}`,
    `User feedback:\n${feedback}`,
    `\nSchema (reproduce this structure EXACTLY, filling all fields; status must be "inbox"; all builder.* must be null):\n${schemaTemplate}`,
    retry,
  ].join('\n');
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

// ---- system-managed fields ----

const NULL_BUILDER = { session_id: null, repo_url: null, pr_url: null, box_task_id: null, phase: null, last_run_at: null, tests_pass: null, build_pass: null };

/** Build sample_complaints straight from the scraped posts (real quotes/urls beat model guesses). */
function complaintsFromPosts(posts = [], scrapedAt) {
  return posts
    .map((p) => ({
      text: String(p.body ?? '').replace(/\s+/g, ' ').trim().slice(0, 300),
      source_url: /^https?:\/\//.test(p.permalink ?? '') ? p.permalink : `https://www.reddit.com${p.permalink ?? ''}`,
      reddit_score: Number.isFinite(p.score) ? p.score : (Number.isFinite(p.reddit_score) ? p.reddit_score : 0),
      scraped_at: scrapedAt,
    }))
    .filter((c) => c.text.length > 0)
    .slice(0, 5);
}

/**
 * Overwrite the fields the Idea Miner / Orchestrator own (so the model can't get them wrong) and
 * fill evidence we already know from the scrape. The model keeps ownership of the semantic fields.
 * @param {string} text raw LLM output
 * @param {{theme:string, uniqueAuthors:number, subredditCount:number, timeframeDays:number, posts:object[]}} facts
 */
export function applySystemFields(text, facts) {
  const parsed = parseFrontMatter(text);
  const fm = parsed?.fm && typeof parsed.fm === 'object' ? { ...parsed.fm } : {};
  const body = parsed ? parsed.body : `\n${String(text ?? '')}`;
  const now = new Date().toISOString();

  fm.id = randomUUID();
  fm.schema_version = '1';
  fm.created_at = now;
  fm.updated_at = now;
  fm.status = 'inbox';
  fm.theme = facts.theme;
  fm.builder = { ...NULL_BUILDER };

  const complaints = complaintsFromPosts(facts.posts, now);
  fm.proof_of_pain = {
    ...(fm.proof_of_pain && typeof fm.proof_of_pain === 'object' ? fm.proof_of_pain : {}),
    unique_authors: Math.max(1, facts.uniqueAuthors || 1),
    subreddit_count: Math.max(1, facts.subredditCount || 1),
    timeframe_days: Math.max(1, facts.timeframeDays || 30),
    sample_complaints: complaints.length > 0 ? complaints : (fm.proof_of_pain?.sample_complaints ?? []),
  };

  const score = fm.signal_strength?.score;
  fm.signal_strength = {
    ...(fm.signal_strength && typeof fm.signal_strength === 'object' ? fm.signal_strength : {}),
    score: typeof score === 'number' && score >= 0 && score <= 1 ? score : 0.6,
  };

  return `---\n${yaml.dump(fm)}---\n${body}`;
}

// ---- failed card ----

export function injectFailedStatus(rawText, errorMsg) {
  const fm = {
    status: 'failed', id: randomUUID(), schema_version: '1', error: String(errorMsg ?? 'validation failed'),
    builder: { ...NULL_BUILDER },
  };
  return `---\n${yaml.dump(fm)}---\n\n# Failed Card\n\nThe LLM output did not validate after one retry.\n\n## Validation error\n${errorMsg ?? ''}\n\n## Raw LLM output\n${rawText ?? ''}\n`;
}

// ---- orchestration ----

/**
 * @param {object} group  a feedback group { name, posts, uniqueAuthors, subredditCount }
 * @param {object} config @param {{id:string}[]} themes
 * @param {{invokeModelImpl?:Function}} [deps]
 * @returns {Promise<string>} spec.md content (a valid card, or a Failed_Card)
 */
export async function generate(group, config, themes, { invokeModelImpl } = {}) {
  assertBedrockEnv();
  const schemaTemplate = fs.readFileSync(SCHEMA_PATH, 'utf8');
  const system = buildSystemPrompt();
  const callModel = invokeModelImpl ?? ((sys, user) => callBedrock(sys, user, { config }));

  const facts = {
    theme: config.theme,
    uniqueAuthors: group.uniqueAuthors,
    subredditCount: group.subredditCount,
    timeframeDays: config.window_days,
    posts: group.posts ?? [],
  };

  const attempt = async (errorMsg) => {
    try {
      const raw = await callModel(system, buildUserPrompt(group, config, schemaTemplate, errorMsg));
      // Repair system/known fields before validating so the model only owns the semantic content.
      const text = applySystemFields(raw, facts);
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
