/**
 * mine.mjs — query-driven feedback mining (SPEC.md §6; Rantify).
 *
 * Given a user's free-text request (and optional subreddit), run:
 *   interpret (Bedrock) -> scrape (Apify) -> score -> group -> generate (Bedrock) -> upload (Box).
 * The output is a schema-valid inbox Build Card (an implementation spec) ready for developer
 * review. Every external stage is injectable so the suite never touches the network.
 */

import yaml from 'js-yaml';
import { interpretQuery } from './interpreter.mjs';
import { scrape } from './scraper.mjs';
import { score } from './scorer.mjs';
import { generate } from './generator.mjs';
import { upload } from './uploader.mjs';

/** Read the front-matter of a generated spec (status/error) without importing generator internals. */
function readFrontMatter(specMarkdown) {
  try { return yaml.load(String(specMarkdown).split(/^---\s*$/m)[1]) ?? {}; }
  catch { return {}; }
}

const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'about', 'feedback', 'from', 'into', 'that', 'this', 'app', 'feature']);

/** Derive subject-relevance terms from a subject label (words >= 3 chars, minus stopwords). */
export function subjectTerms(subject) {
  return String(subject ?? '')
    .split(/[^a-z0-9]+/i)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w.toLowerCase()));
}

/** Wrap all scored posts about a subject into a single group the generator understands. */
export function groupBySubject(subject, posts) {
  return {
    name: subject,
    posts,
    uniqueAuthors: new Set(posts.map((p) => p.author)).size,
    subredditCount: new Set(posts.map((p) => p.subreddit)).size,
  };
}

/**
 * @param {{query:string, subreddit?:string, creatorEmail?:string}} request
 * @param {{
 *   boxClient:object, config:object, themes:{id:string}[],
 *   interpretImpl?:Function, scrapeImpl?:Function, scoreImpl?:Function,
 *   generateImpl?:Function, uploadImpl?:Function,
 *   callBedrockImpl?:Function, fetchImpl?:Function, invokeModelImpl?:Function
 * }} deps
 * @returns {Promise<{fileId:string,cardId:string}|'failed'|'duplicate'>}
 */
export async function mineFromQuery(
  { query, subreddit, creatorEmail },
  {
    boxClient, config, themes,
    interpretImpl = interpretQuery, scrapeImpl = scrape, scoreImpl = score,
    generateImpl = generate, uploadImpl = upload,
    callBedrockImpl, fetchImpl, invokeModelImpl,
  },
) {
  if (!query || !String(query).trim()) throw new Error('mineFromQuery: query is required');

  // 1. Interpret the free-text request into search parameters.
  const interpretation = await interpretImpl(query, { subreddit, themes, config }, { callBedrockImpl });

  // 2. Scrape Reddit with the interpreted phrases (scoped to the chosen subreddit, else all Reddit).
  const posts = await scrapeImpl(
    { ...config, searchPhrases: interpretation.searchPhrases, subreddit: interpretation.subreddit },
    { fetchImpl },
  );

  // 3. Score + filter. Posts are already topically filtered, so keep a low floor; recency/window still apply.
  const scored = scoreImpl(posts, {
    ...config,
    subjectTerms: subjectTerms(interpretation.subject),
    min_final_score: config.mine_min_final_score ?? 0,
  });
  if (scored.length === 0) {
    throw new Error(`no usable feedback found for "${interpretation.subject}" (try a broader query or different subreddit)`);
  }

  // 4. Group all feedback about the subject into one group.
  const group = groupBySubject(interpretation.subject, scored);

  // 5. Generate the implementation spec (problem + solution) from the feedback.
  const specMarkdown = await generateImpl(group, { ...config, theme: interpretation.theme, subject: interpretation.subject }, themes, { invokeModelImpl });

  // Surface a generation failure as a job error instead of uploading a status:"failed" card.
  const fm = readFrontMatter(specMarkdown);
  if (fm.status !== 'inbox') {
    throw new Error(`could not generate a valid spec for "${interpretation.subject}": ${fm.error ?? 'model output failed schema validation'}`);
  }

  // 6. Upload as an inbox card (no theme de-dup; carry the submitter's email through).
  return uploadImpl(specMarkdown, boxClient, {
    dedupe: false,
    extraMetadata: { creator_email: creatorEmail ?? null, box_task_id: null },
  });
}
