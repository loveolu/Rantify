import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { createJobRegistry } from './mine-jobs.mjs';

const JSON_HEADER = { 'Content-Type': 'application/json' };

/**
 * @param {{box:object, tokenStore?:object,
 *   mine?:(req:{query:string,subreddit?:string,creator_email?:string})=>Promise<{fileId:string,cardId:string}>,
 *   jobs?:ReturnType<typeof createJobRegistry>}} deps
 */
export function createApi({ box, tokenStore, mine, jobs = createJobRegistry() }) {
  async function getCards(req, res) {
    const cards = await box.listCardsWithMetadata();
    const list = cards.map(({ fileId, cardId, metadata }) => ({
      fileId, cardId, ...metadata,
    }));
    json(res, 200, list);
  }

  async function getCard(req, res, fileId) {
    const meta = await box.getMetadata(fileId);
    let hasArtifacts = [];
    for (const name of ['REVIEW_NOTES.md', 'build_summary.md']) {
      try { await box.getArtifact({ cardId: meta.card_id, name }); hasArtifacts.push(name); }
      catch { /* not found */ }
    }
    json(res, 200, { fileId, cardId: meta.card_id, ...meta, has_artifacts: hasArtifacts });
  }

  async function getSpec(req, res, fileId) {
    const content = await box.getSpecMarkdown(fileId);
    json(res, 200, { content });
  }

  async function getArtifact(req, res, fileId, name) {
    const meta = await box.getMetadata(fileId);
    const content = await box.getArtifact({ cardId: meta.card_id, name });
    json(res, 200, { content });
  }

  async function createCard(req, res) {
    const body = await readJson(req);
    const cardId = body.card_id ?? randomUUID();
    const specMarkdown = buildSpec(body, cardId);
    const metadata = {
      status: 'inbox',
      theme: body.theme,
      pain_score: body.pain_score,
      card_id: cardId,
      creator_email: body.creator_email ?? null,
      builder_session_id: null,
      repo_url: null,
      pr_url: null,
      box_task_id: null,
    };
    const ref = await box.uploadCard({ cardId, specMarkdown, metadata });
    json(res, 201, ref);
  }

  async function setStatus(req, res, fileId) {
    const body = await readJson(req);
    const { status } = body;
    if (!status) { json(res, 400, { error: 'missing status' }); return; }
    const meta = await box.getMetadata(fileId);
    await box.setMetadata(fileId, { status });
    await box.moveCard(meta.card_id, status);
    json(res, 200, { ...meta, status });
  }

  // Kick off a background mining job from a free-text request; return instantly.
  async function startMine(req, res) {
    if (typeof mine !== 'function') { json(res, 503, { error: 'mining is not configured on this server' }); return; }
    const body = await readJson(req);
    const query = String(body.query ?? '').trim();
    if (!query) { json(res, 400, { error: 'missing query' }); return; }
    const subreddit = body.subreddit ? String(body.subreddit).trim() : undefined;
    const creator_email = body.creator_email ? String(body.creator_email).trim() : undefined;

    const jobId = jobs.start({ query, subreddit, creatorEmail: creator_email });
    // Fire-and-forget: the dashboard polls GET /api/mine for progress.
    Promise.resolve()
      .then(() => mine({ query, subreddit, creator_email }))
      .then((ref) => jobs.complete(jobId, ref))
      .catch((err) => jobs.fail(jobId, err));

    json(res, 202, { jobId, status: 'mining' });
  }

  function listMine(req, res) {
    json(res, 200, { jobs: jobs.list() });
  }

  async function authStatus(req, res) {
    const connections = [];
    if (tokenStore) {
      const raw = await fs.readFile(tokenStore.filePath, 'utf8').catch(() => '{}');
      const data = JSON.parse(raw);
      for (const [email, entry] of Object.entries(data)) {
        connections.push({ email, login: entry.login, connected: true });
      }
    }
    json(res, 200, { connections });
  }

  return async function handleApi(req, res) {
    const u = new URL(req.url, `http://${req.headers.host}`);
    const parts = u.pathname.split('/').filter(Boolean);
    const method = req.method;

    addCorsHeaders(res);
    if (method === 'OPTIONS') { res.writeHead(204).end(); return; }

    try {
      if (parts[0] === 'api') {
        if (parts[1] === 'cards') {
          if (parts.length === 2 && method === 'GET') return await getCards(req, res);
          if (parts.length === 2 && method === 'POST') return await createCard(req, res);
          if (parts.length === 3 && method === 'GET') return await getCard(req, res, parts[2]);
          if (parts.length === 3 && method === 'PUT') return await setStatus(req, res, parts[2]);
          if (parts.length === 4 && parts[3] === 'spec' && method === 'GET') return await getSpec(req, res, parts[2]);
          if (parts.length === 5 && parts[3] === 'artifacts' && method === 'GET') return await getArtifact(req, res, parts[2], parts[4]);
        }
        if (parts[1] === 'mine') {
          if (parts.length === 2 && method === 'POST') return await startMine(req, res);
          if (parts.length === 2 && method === 'GET') return listMine(req, res);
        }
        if (parts[1] === 'auth' && parts[2] === 'status' && method === 'GET') return await authStatus(req, res);
      }
      json(res, 404, { error: 'not found' });
    } catch (err) {
      json(res, 500, { error: err.message ?? String(err) });
    }
  };
}

function json(res, status, data) {
  res.writeHead(status, JSON_HEADER);
  res.end(JSON.stringify(data));
}

function addCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (err) { reject(new Error('invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function buildSpec(body, cardId) {
  const theme = body.theme ?? 'untitled';
  const title = body.title ?? body.theme ?? 'Untitled dev tool';
  const description = body.description ?? '';
  const score = body.pain_score ?? 0.5;
  const now = new Date().toISOString();
  // id MUST equal the card's metadata card_id (SPEC §5.3 sync invariant / §12.1 traceability).
  return `---
id: "${cardId}"
schema_version: "1"
created_at: "${now}"
updated_at: "${now}"
title: "${title.replace(/"/g, "'")}"
theme: ${theme}
status: "inbox"
signal_strength:
  score: ${score}
builder:
  session_id: null
  repo_url: null
  pr_url: null
  box_task_id: null
  phase: null
  last_run_at: null
  tests_pass: null
  build_pass: null
---

# ${title.replace(/[\r\n]/g, ' ')}

## Problem Summary
${description}

## Acceptance Criteria
- [ ] Implements the tool described above.
- [ ] Includes a README and basic tests.
`;
}
