// Debug: time how long Box search + folder tree provisioning take.
import path from 'node:path';
try { process.loadEnvFile(path.join(import.meta.dirname, '.env')); } catch {}
import { RealBoxClient } from './box-hub/box-client-real.mjs';

const box = new RealBoxClient();

const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

log('start: _tree (folder provisioning)');
const t0 = Date.now();
try {
  const tree = await box._tree();
  log(`tree resolved in ${Date.now() - t0}ms; root=${tree['DevTool-Loop']}`);
} catch (err) {
  log(`tree FAILED in ${Date.now() - t0}ms: ${err.message}`);
  console.error(err);
  process.exit(1);
}

log('start: listCardsWithMetadata');
const t1 = Date.now();
try {
  const cards = await box.listCardsWithMetadata();
  log(`listCardsWithMetadata returned ${cards.length} cards in ${Date.now() - t1}ms`);
  console.log(JSON.stringify(cards, null, 2).slice(0, 2000));
} catch (err) {
  log(`listCardsWithMetadata FAILED in ${Date.now() - t1}ms: ${err.message}`);
  console.error(err);
}
process.exit(0);
