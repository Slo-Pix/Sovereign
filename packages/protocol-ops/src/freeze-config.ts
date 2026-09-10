import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { isAddress } from 'viem';
import { isAbsolute, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '../../..');
const local = (value: string | undefined, fallback: string) => isAbsolute(value || '') ? value! : resolve(ROOT, value || fallback);
function option(name: string, fallback?: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback;
}
function required(name: string) { const value = process.env[name]; if (!value) throw new Error(`Missing ${name}`); return value; }
async function main() {
  const receiver = option('--receiver');
  const origin = option('--origin', 'http://127.0.0.1:3101');
  const owner = process.env.DEPLOYER_ADDRESS;
  if (!receiver || !isAddress(receiver) || !owner || !isAddress(owner)) throw new Error('Invalid receiver/owner');
  const publicPath = local(process.env.DEMO_PUBLIC_FILE, 'packages/cre/.local/demo.public.json');
  const policyPath = local(process.env.DEMO_POLICY_FILE, 'packages/cre/.local/demo.policy.json');
  const authPath = local(process.env.FEED_AUTH_FILE, 'packages/cre/.local/position-auth.json');
  const configPath = local(process.env.CRE_CONFIG_FILE, 'packages/cre/.local/sovereign.config.json');
  const envPath = local(process.env.CRE_ENV_FILE, 'packages/cre/.local/cre.env');
  const publicDemo = JSON.parse(await readFile(publicPath, 'utf8')) as { agreementId: string; intentId: string; terms: Record<string, string>; };
  const policyFile = JSON.parse(await readFile(policyPath, 'utf8')) as { policy: Record<string, string> };
  const auth = JSON.parse(await readFile(authPath, 'utf8')) as { agreementId: string; readToken: string };
  if (auth.agreementId !== publicDemo.agreementId) throw new Error('Feed/agreement mismatch');
  const config = {
    schedule: '*/3 * * * * *', agreementId: publicDemo.agreementId,
    agreementRegistry: '0x81134eF33D0C195c6c17610f40C5FF53afBD6AF4',
    intentRegistry: '0x2AB9B14995048f0A6e0A80830c2654a1d72f8deD',
    decisionSink: '0xFAf580b27CBE494adcE3F4D9F78caB42a6e3088D',
    policySecretId: 'SOVEREIGN_POLICY', positionAuthSecretId: 'SOVEREIGN_POSITION_AUTH',
    terms: publicDemo.terms, positionOrigin: origin, allowInsecurePositionLoopback: true,
    maxPositionAgeSeconds: 30, delivery: 'simulation-sepolia', reportReceiver: receiver,
  };
  await mkdir(resolve(ROOT, 'packages/cre/.local'), { recursive: true, mode: 0o700 });
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  const secrets = [
    `SOVEREIGN_POLICY_JSON=${JSON.stringify(policyFile.policy)}`,
    `SOVEREIGN_POSITION_AUTH_JSON=${JSON.stringify({ origin, agreementId: auth.agreementId, token: auth.readToken })}`,
    `CRE_ETH_PRIVATE_KEY=${required('DEPLOYER_PRIVATE_KEY')}`,
  ].join('\n') + '\n';
  await writeFile(envPath, secrets, { mode: 0o600 });
  await chmod(configPath, 0o600); await chmod(envPath, 0o600);
  console.log(JSON.stringify({ configPath, envPath, receiver, deployer: owner, positionOrigin: origin }));
}
main().catch(() => { console.error('CRE configuration freeze failed.'); process.exitCode = 1; });
