import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '../../..');
const local = (value: string | undefined, fallback: string) => isAbsolute(value || '') ? value! : resolve(ROOT, value || fallback);
function option(name: string, fallback?: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback;
}
async function main() {
  const auth = JSON.parse(await readFile(local(process.env.FEED_AUTH_FILE, 'packages/cre/.local/position-auth.json'), 'utf8')) as { agreementId: string };
  const credentials = JSON.parse(await readFile(local(process.env.FEED_CREDENTIAL_FILE, 'packages/cre/.local/feed.credentials.json'), 'utf8')) as { credentials: { agreementId: string; role: string; token: string }[] };
  const writer = credentials.credentials.find(value => value.agreementId === auth.agreementId && value.role === 'write');
  if (!writer) throw new Error('Writer credential missing');
  const origin = option('--origin', 'http://127.0.0.1:3101')!;
  const loss = option('--loss', '0')!;
  const elapsed = option('--elapsed', '10')!;
  if (!/^[0-9]+$/.test(loss) || !/^[0-9]+$/.test(elapsed)) throw new Error('Invalid position');
  const timestamp = Math.floor(Date.now() / 1000);
  const response = await fetch(`${origin}/agreements/${auth.agreementId}/position`, {
    method: 'PUT', headers: { Authorization: `Bearer ${writer.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ agreementId: auth.agreementId, currentLossBps: Number(loss), elapsedSeconds: Number(elapsed), timestamp }),
  });
  if (response.status !== 204) throw new Error('Position write rejected');
  console.log(JSON.stringify({ agreementId: auth.agreementId, currentLossBps: Number(loss), elapsedSeconds: Number(elapsed), timestamp }));
}
main().catch(() => { console.error('Position publication failed.'); process.exitCode = 1; });
