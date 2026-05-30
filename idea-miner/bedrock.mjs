/**
 * bedrock.mjs — shared Amazon Bedrock (Claude) client for the Idea Miner (SPEC.md §13).
 *
 * Both the query interpreter and the card generator call Claude through here, using the
 * Bedrock Messages API shape. The dispatch is injectable (`send`) so the test suite never
 * hits AWS. Region resolves from BEDROCK_REGION, then AWS_REGION (matches the orchestrator).
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

export const DEFAULT_BEDROCK_MODEL_ID = 'anthropic.claude-3-5-haiku-20241022-v1:0';

/** @param {NodeJS.ProcessEnv} [env] */
export function resolveRegion(env = process.env) {
  return env.BEDROCK_REGION || env.AWS_REGION || '';
}

/** Throw before any API call if no Bedrock region is configured. Names the variable only. */
export function assertBedrockEnv(env = process.env) {
  if (!resolveRegion(env)) {
    throw new Error('AWS_REGION (or BEDROCK_REGION) is required to call Amazon Bedrock (SPEC §13) — aborting, no API call made');
  }
}

/** @param {object} config @param {NodeJS.ProcessEnv} [env] */
export function resolveModelId(config = {}, env = process.env) {
  return env.BEDROCK_MODEL_ID || config.bedrock_model_id || DEFAULT_BEDROCK_MODEL_ID;
}

export function buildBedrockBody(systemPrompt, userPrompt, { maxTokens = 4096 } = {}) {
  return {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  };
}

/**
 * Invoke a Claude model on Bedrock and return the assistant text.
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @param {{config?:object, region?:string, modelId?:string, maxTokens?:number, send?:Function}} [deps]
 * @returns {Promise<string>}
 */
export async function callBedrock(systemPrompt, userPrompt, { config = {}, region, modelId, maxTokens, send } = {}) {
  const body = buildBedrockBody(systemPrompt, userPrompt, { maxTokens });
  const command = new InvokeModelCommand({
    modelId: modelId ?? resolveModelId(config),
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(body),
  });

  const dispatch = send ?? ((cmd) => new BedrockRuntimeClient({ region: region ?? resolveRegion() }).send(cmd));
  const res = await dispatch(command);
  const raw = res.body;
  const text = raw instanceof Uint8Array || Buffer.isBuffer(raw) ? new TextDecoder().decode(raw) : String(raw);
  const parsed = JSON.parse(text);
  return parsed.content?.[0]?.text ?? '';
}
