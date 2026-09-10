import { constants, closeSync, fstatSync, openSync, readSync } from 'node:fs'
import { resolve } from 'node:path'
import { Store } from './store'
import { agreementId, credentials, type Role } from './validation'

// Credentials are read only from the explicitly supplied file, never from stdin,
// token arguments, existing project env files, chain config or a secret provider.
function readConfig(path: string): unknown {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.uid !== process.getuid?.() || stat.nlink !== 1 ||
        (stat.mode & 0o777) !== 0o600 || stat.size > 65536) throw new Error('Invalid configuration')
    const bytes = Buffer.alloc(65537)
    let size = 0
    while (size < bytes.length) {
      const count = readSync(fd, bytes, size, bytes.length - size, null)
      if (!count) break
      size += count
    }
    if (size > 65536) throw new Error('Invalid configuration')
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size)))
  } finally { closeSync(fd) }
}

export function operate(args: string[], env: Record<string, string | undefined>): void {
  const [command, ...rest] = args
  if (!['provision', 'rotate', 'revoke'].includes(command ?? '') || rest.length % 2) throw new Error('Invalid arguments')
  const options = new Map<string, string>()
  const allowed = command === 'revoke' ? ['--db', '--agreement', '--role'] : ['--db', '--config']
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i]!
    const value = rest[i + 1]!
    if (!allowed.includes(key) || options.has(key) || !value || value.startsWith('--')) throw new Error('Invalid arguments')
    options.set(key, value)
  }
  const db = options.get('--db') || env.POSITION_FEED_DB || resolve(import.meta.dir, '../state/position.sqlite')
  if (command === 'revoke') {
    const id = options.get('--agreement')
    const role = options.get('--role')
    if (!agreementId(id) || (role !== 'read' && role !== 'write')) throw new Error('Invalid arguments')
    const store = new Store(db)
    try { store.revoke(id, role as Role) } finally { store.close() }
    return
  }
  const path = options.get('--config') || env.POSITION_FEED_CREDENTIAL_CONFIG
  if (!path) throw new Error('Invalid arguments')
  const entries = credentials(readConfig(path))
  const store = new Store(db)
  try { store.provision({ credentials: entries }, command === 'rotate') } finally { store.close() }
}

if (import.meta.main) {
  try {
    operate(Bun.argv.slice(2), process.env)
    process.stdout.write('Operation completed\n')
  } catch {
    process.stderr.write('Operation failed\n')
    process.exitCode = 1
  }
}