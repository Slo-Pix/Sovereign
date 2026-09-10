import { Database } from 'bun:sqlite'
import { createHash, timingSafeEqual } from 'node:crypto'
import { chmodSync, existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { credentials, fresh, type Position, type Role } from './validation'

type Auth = { hash: string; capacity: number; window_seconds: number }
type Quota = { window_start: number; used: number }
export type Outcome = { status: number; position?: Position }
const dummyHash = createHash('sha256').update('unassigned credential slot').digest()
export const hashToken = (value: string): string => createHash('sha256').update(value).digest('hex')

function secureFile(path: string): void {
  if (!existsSync(path)) {
    // existsSync follows symlinks; also reject dangling links.
    try { lstatSync(path); throw new Error('Unsafe state') } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    return
  }
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== process.getuid?.()) {
    throw new Error('Unsafe state')
  }
  chmodSync(path, 0o600)
}

function securePath(input: string): string {
  const path = resolve(input)
  const directory = dirname(path)
  // Set before SQLite creates the database or WAL/SHM. This is a dedicated process.
  process.umask(0o077)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const stat = lstatSync(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(directory) !== directory ||
      stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o700) throw new Error('Unsafe state')
  for (const suffix of ['', '-wal', '-shm', '-journal']) secureFile(path + suffix)
  return path
}

export class Store {
  private readonly db: Database

  constructor(path: string) {
    const filename = securePath(path)
    this.db = new Database(filename, { create: true, strict: true })
    try {
      this.db.exec(`
        PRAGMA busy_timeout = 5000;
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = FULL;
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS credentials (
          hash TEXT PRIMARY KEY,
          agreement_id TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('read', 'write')),
          capacity INTEGER NOT NULL,
          window_seconds INTEGER NOT NULL,
          active INTEGER NOT NULL CHECK (active IN (0, 1))
        );
        CREATE UNIQUE INDEX IF NOT EXISTS active_slot ON credentials(agreement_id, role) WHERE active = 1;
        CREATE TABLE IF NOT EXISTS quotas (
          hash TEXT NOT NULL REFERENCES credentials(hash),
          agreement_id TEXT NOT NULL,
          route TEXT NOT NULL,
          window_start INTEGER NOT NULL,
          used INTEGER NOT NULL,
          PRIMARY KEY (hash, agreement_id, route)
        );
        CREATE TABLE IF NOT EXISTS observations (
          agreementId TEXT PRIMARY KEY,
          currentLossBps INTEGER NOT NULL,
          elapsedSeconds INTEGER NOT NULL,
          timestamp INTEGER NOT NULL
        );
      `)
      for (const suffix of ['', '-wal', '-shm']) secureFile(filename + suffix)
    } catch (error) {
      this.db.close()
      throw error
    }
  }

  close(): void { this.db.close() }

  provision(input: unknown, rotate = false): void {
    const entries = credentials(input)
    // Hash all secrets before entering the transaction; only hashes reach SQLite/WAL.
    const rows = entries.map(({ token, ...entry }) => ({ ...entry, hash: hashToken(token) }))
    this.db.transaction(() => {
      for (const entry of rows) {
        const existing = this.db.query('SELECT hash FROM credentials WHERE agreement_id = ? AND role = ? AND active = 1')
          .get(entry.agreementId, entry.role)
        if (Boolean(existing) !== rotate) throw new Error('Invalid operation')
        // Never reuse a token, even after revocation or across roles/agreements.
        if (this.db.query('SELECT hash FROM credentials WHERE hash = ?').get(entry.hash)) throw new Error('Invalid operation')
        if (rotate) this.db.query('UPDATE credentials SET active = 0 WHERE agreement_id = ? AND role = ?')
          .run(entry.agreementId, entry.role)
        this.db.query('INSERT INTO credentials VALUES (?, ?, ?, ?, ?, 1)')
          .run(entry.hash, entry.agreementId, entry.role, entry.capacity, entry.windowSeconds)
      }
    }).immediate()
  }

  revoke(id: string, role: Role): void {
    this.db.transaction(() => {
      this.db.query('UPDATE credentials SET active = 0 WHERE agreement_id = ? AND role = ?')
        .run(id, role)
    }).immediate()
  }

  private auth(id: string, role: Role, digest: string): Auth | null {
    // Query the public slot, not the provided secret; always compare fixed-size hashes.
    const row = this.db.query<Auth, [string, Role]>(
      'SELECT hash, capacity, window_seconds FROM credentials WHERE agreement_id = ? AND role = ? AND active = 1',
    ).get(id, role)
    const matched = timingSafeEqual(Buffer.from(digest, 'hex'), row ? Buffer.from(row.hash, 'hex') : dummyHash)
    return matched && row ? row : null
  }

  authorized(id: string, role: Role, digest: string): boolean {
    return this.auth(id, role, digest) !== null
  }

  private consume(auth: Auth, id: string, role: Role, now: number): boolean {
    const route = `${role === 'read' ? 'GET' : 'PUT'} /agreements/${id}/position`
    const start = Math.floor(now / auth.window_seconds) * auth.window_seconds
    const previous = this.db.query<Quota, [string, string, string]>(
      'SELECT window_start, used FROM quotas WHERE hash = ? AND agreement_id = ? AND route = ?',
    ).get(auth.hash, id, route)
    // A backwards wall clock cannot reset the last observed quota window.
    const sameWindow = previous && start <= previous.window_start
    if (sameWindow && previous.used >= auth.capacity) return false
    this.db.query(`INSERT INTO quotas VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(hash, agreement_id, route) DO UPDATE SET window_start = excluded.window_start, used = excluded.used`)
      .run(auth.hash, id, route, sameWindow ? previous.window_start : start, sameWindow ? previous.used + 1 : 1)
    return true
  }

  access(id: string, role: Role, digest: string, clock: () => number, observation?: Position): Outcome {
    // BEGIN IMMEDIATE spans re-authentication, quota, timestamp comparison and write.
    // Separate processes/connections cannot both accept the same observation or overdraw a quota.
    return this.db.transaction((): Outcome => {
      const auth = this.auth(id, role, digest)
      if (!auth) return { status: 401 }
      const now = clock()
      if (!Number.isSafeInteger(now) || now < 0) return { status: 503 }
      if (!this.consume(auth, id, role, now)) return { status: 429 }
      const previous = this.db.query<Position, [string]>(
        'SELECT agreementId, currentLossBps, elapsedSeconds, timestamp FROM observations WHERE agreementId = ?',
      ).get(id)
      if (role === 'read') {
        if (!previous || !fresh(previous.timestamp, now)) return { status: 503 }
        return { status: 200, position: previous }
      }
      if (!observation || !fresh(observation.timestamp, now)) return { status: 400 }
      if (previous && (observation.timestamp <= previous.timestamp || observation.elapsedSeconds < previous.elapsedSeconds)) {
        return { status: 409 }
      }
      this.db.query(`INSERT INTO observations VALUES (?, ?, ?, ?)
        ON CONFLICT(agreementId) DO UPDATE SET currentLossBps = excluded.currentLossBps,
          elapsedSeconds = excluded.elapsedSeconds, timestamp = excluded.timestamp`)
        .run(id, observation.currentLossBps, observation.elapsedSeconds, observation.timestamp)
      return { status: 204 }
    }).immediate()
  }
}