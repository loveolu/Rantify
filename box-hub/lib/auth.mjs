/**
 * auth.mjs — Client Credentials Grant (CCG) Box client, enterprise subject (SPEC.md §7.1, §13).
 * The SDK construction is injectable so unit tests never need real credentials or a network.
 */

const REQUIRED = ['BOX_CLIENT_ID', 'BOX_CLIENT_SECRET', 'BOX_ENTERPRISE_ID'];

/** Validate + extract Box creds; throw naming every missing variable (fail fast, no logging). */
export function requireBoxEnv(env = process.env) {
  const missing = REQUIRED.filter((k) => !env[k]);
  if (missing.length) throw new Error(`Missing Box env var(s): ${missing.join(', ')} (SPEC §13)`);
  return { clientId: env.BOX_CLIENT_ID, clientSecret: env.BOX_CLIENT_SECRET, enterpriseId: env.BOX_ENTERPRISE_ID };
}

/** Default factory: build the real CCG-authenticated SDK client (enterprise subject). */
async function defaultMakeClient({ clientId, clientSecret, enterpriseId }) {
  const { BoxClient } = await import('box-typescript-sdk-gen/client.generated');
  const { BoxCcgAuth, CcgConfig } = await import('box-typescript-sdk-gen/box/ccgAuth.generated');
  const auth = new BoxCcgAuth({ config: new CcgConfig({ clientId, clientSecret, enterpriseId }) });
  return new BoxClient({ auth });
}

let cached;
/**
 * Return a memoized authenticated client. `makeClient` is injectable for tests.
 * @param {Record<string,string|undefined>} [env]
 * @param {(creds:{clientId:string,clientSecret:string,enterpriseId:string})=>any} [makeClient]
 */
export async function getBoxClient(env = process.env, makeClient = defaultMakeClient) {
  if (!cached) cached = await makeClient(requireBoxEnv(env));
  return cached;
}

/** Test seam: drop the memoized client. */
export function _resetBoxClient() { cached = undefined; }
