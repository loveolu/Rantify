/**
 * interpreter.mjs — turn a user's free-text request into Reddit search parameters (SPEC §6.1).
 *
 * The user types something like "feedback about Notion's AI features" (plus an optional
 * subreddit). Claude on Bedrock expands that into a subject label, a handful of Reddit search
 * phrases, and a theme id. Output is strict JSON; parsing is tolerant (strips code fences,
 * grabs the first {...} block) and falls back to using the raw query as a single phrase so the
 * pipeline still runs if the model misbehaves. The Bedrock call is injectable for tests.
 */

import { callBedrock, assertBedrockEnv } from './bedrock.mjs';

export const DEFAULT_THEME = 'product-feedback';

export function buildInterpretSystemPrompt() {
  return [
    'You convert a user request into Reddit search parameters for mining product feedback.',
    'Return ONLY a JSON object (no preamble, no code fences, no commentary) with exactly:',
    '  "subject": a short label for what feedback is about (the company, product, or feature),',
    '  "searchPhrases": an array of 3-6 concise Reddit search queries that would surface real',
    '     user opinions, complaints, and praise about the subject,',
    '  "theme": one id from the provided theme list, or "product-feedback" if none fit.',
    'Do not include usernames. Keep phrases short (2-5 words).',
  ].join('\n');
}

export function buildInterpretUserPrompt(query, { subreddit, themeIds = [] } = {}) {
  return [
    `User request: ${query}`,
    subreddit ? `The user restricted the search to r/${subreddit}.` : 'No subreddit restriction (search all of Reddit).',
    `Available theme ids: ${themeIds.length ? themeIds.join(', ') : '(none)'} — or "product-feedback".`,
    'Respond with the JSON object now.',
  ].join('\n');
}

/** Strip code fences and extract the first balanced {...} JSON object; null if none. */
export function extractJson(text) {
  const stripped = String(text ?? '').replace(/```(?:json)?/gi, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try { return JSON.parse(stripped.slice(start, end + 1)); }
  catch { return null; }
}

const cleanPhrase = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** Normalize a subreddit name: drop a leading r/ and whitespace; '' / nullish → undefined. */
export function normalizeSubreddit(sub) {
  const s = String(sub ?? '').trim().replace(/^\/?r\//i, '').trim();
  return s.length ? s : undefined;
}

/**
 * @param {string} query free text from the user
 * @param {{subreddit?:string, themes?:{id:string}[], config?:object}} [opts]
 * @param {{callBedrockImpl?:Function}} [deps]
 * @returns {Promise<{subject:string, searchPhrases:string[], theme:string, subreddit?:string}>}
 */
export async function interpretQuery(query, { subreddit, themes = [], config = {} } = {}, { callBedrockImpl } = {}) {
  assertBedrockEnv();
  const trimmed = cleanPhrase(query);
  if (!trimmed) throw new Error('interpretQuery: empty query');

  const themeIds = themes.map((t) => t.id);
  const call = callBedrockImpl ?? ((sys, user) => callBedrock(sys, user, { config }));

  let parsed = null;
  try {
    const raw = await call(buildInterpretSystemPrompt(), buildInterpretUserPrompt(trimmed, { subreddit: normalizeSubreddit(subreddit), themeIds }));
    parsed = extractJson(raw);
  } catch {
    parsed = null; // fall through to the safe fallback below
  }

  const subject = cleanPhrase(parsed?.subject) || trimmed;
  let searchPhrases = Array.isArray(parsed?.searchPhrases)
    ? parsed.searchPhrases.map(cleanPhrase).filter(Boolean)
    : [];
  if (searchPhrases.length === 0) searchPhrases = [trimmed]; // fallback: search the raw request

  const candidateTheme = cleanPhrase(parsed?.theme);
  const theme = themeIds.includes(candidateTheme) ? candidateTheme : DEFAULT_THEME;

  return { subject, searchPhrases, theme, subreddit: normalizeSubreddit(subreddit) };
}
