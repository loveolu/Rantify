/**
 * claude-code.mjs — drive Claude via AWS Bedrock (SPEC.md §9).
 *
 * Production mode (modelId set): invokes Claude through the Bedrock Converse API,
 * parses <file path="..."> blocks from the response, and writes them to disk.
 * Stub mode (modelId absent): falls back to run('claude', …) so verify-orchestrator.mjs
 * works offline with makeStubRun().
 */

import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import fs from 'node:fs';
import path from 'node:path';

const FILE_RE = /<file\s+path="([^"]+)"\s*>([\s\S]*?)<\/file>/g;

/**
 * @param {{run?: Function, modelId?: string, region?: string}} deps
 */
export function createClaudeCode({ run, modelId, region, client: clientOverride }) {
  if (modelId) {
    const client = clientOverride ?? new BedrockRuntimeClient({ region: region ?? process.env.AWS_REGION ?? 'us-east-1' });

    return {
      async runSession(cwd, { sessionId, promptFile }) {
        const promptText = fs.readFileSync(promptFile, 'utf8');
        const system = `You are an AI coding agent working in a repository at ${cwd}.

Output each file you create or modify wrapped as:

<file path="relative/file/path">
content
</file>

Include ALL files. End with a brief summary.`;

        const response = await client.send(new ConverseCommand({
          modelId,
          messages: [{ role: 'user', content: [{ text: promptText }] }],
          system: [{ text: system }],
          inferenceConfig: { maxTokens: 8192 },
        }));

        const output = response.output?.message?.content?.[0]?.text ?? '';
        const matches = [...output.matchAll(FILE_RE)];
        for (const [, relPath, content] of matches) {
          const abs = path.join(cwd, relPath);
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.writeFileSync(abs, content.trimStart());
        }

        const aiNotes = path.join(cwd, 'AI_NOTES.md');
        if (!fs.existsSync(aiNotes)) {
          fs.writeFileSync(aiNotes, output);
        }

        return { code: 0, stdout: `Bedrock: ${matches.length} files written`, stderr: '' };
      },
    };
  }

  return {
    async runSession(cwd, { sessionId, promptFile }) {
      return run('claude', [
        '--session-id', sessionId,
        '--working-dir', cwd,
        '--prompt-file', promptFile,
        '--no-interactive',
      ], { cwd });
    },
  };
}
