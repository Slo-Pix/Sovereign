import { mkdir, chmod, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '../../..');
const local = (value: string | undefined, fallback: string) => isAbsolute(value || '') ? value! : resolve(ROOT, value || fallback);

function option(name: string, fallback?: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback;
}
function id(value: string) {
  if (!/^0x[0-9a-f]{64}$/.test(value)) throw new Error('Invalid agreement ID');
  return value;
}
async function main() {
  const agreementId = id(option('--agreement', process.env.RECONCILE_AGREEMENT_ID || '')!);
  const credentialsFile = local(process.env.FEED_CREDENTIAL_FILE, 'packages/cre/.local/feed.credentials.json');
  const authFile = local(process.env.FEED_AUTH_FILE, 'packages/cre/.local/position-auth.json');
  const readToken = randomBytes(32).toString('base64url');
  const writeToken = randomBytes(32).toString('base64url');
  await mkdir(resolve(ROOT, 'packages/cre/.local'), { recursive: true, mode: 0o700 });
  await writeFile(credentialsFile, JSON.stringify({ credentials: [
    { agreementId, role: 'read', token: readToken, capacity: 60, windowSeconds: 60 },
    { agreementId, role: 'write', token: writeToken, capacity: 30, windowSeconds: 60 },
  ] }, null, 2) + '\n', { mode: 0o600 });
  await writeFile(authFile, JSON.stringify({ agreementId, readToken }, null, 2) + '\n', { mode: 0o600 });
  await chmod(credentialsFile, 0o600); await chmod(authFile, 0o600);
  console.log(JSON.stringify({ agreementId, credentialsFile, authFile }));
}
main().catch(() => { console.error('Feed provisioning preparation failed.'); process.exitCode = 1; });
