import { BoxCcgAuth, CcgConfig } from 'box-typescript-sdk-gen';
import { BoxClient } from 'box-typescript-sdk-gen';

let clientCache = null;

export function getClient() {
  if (clientCache) return clientCache;
  const auth = new BoxCcgAuth({
    config: new CcgConfig({
      clientId: process.env.BOX_CLIENT_ID,
      clientSecret: process.env.BOX_CLIENT_SECRET,
      enterpriseId: process.env.BOX_ENTERPRISE_ID,
    }),
  });
  clientCache = new BoxClient({ auth });
  return clientCache;
}
