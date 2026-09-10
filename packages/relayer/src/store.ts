import { Database } from 'bun:sqlite'
import { constants, closeSync, existsSync, lstatSync, mkdirSync, openSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { requireRelay, RelayError, type Action, type Decision, type Evidence, type State, type Store } from './model'

const stringify = (v: unknown) => JSON.stringify(v, (_, value) => typeof value === 'bigint' ? value.toString() : value)
function decode(text: string): State {
  const value = JSON.parse(text) as State
  for (const block of [value.cursor, value.destination]) {
    if (block) {
      requireRelay(/^(0|[1-9][0-9]*)$/.test(String(block.number)) && /^0x[0-9a-fA-F]{64}$/.test(block.hash),
        'Invalid stored cursor; restore a verified database backup, not a guessed start block.')
      block.number = BigInt(block.number)
    }
  }
  return value
}
function secure(path: string, directory: boolean): void {
  const stat = lstatSync(path)
  requireRelay(!stat.isSymbolicLink() && (directory ? stat.isDirectory() : stat.isFile())
    && (stat.mode & 0o777) === (directory ? 0o700 : 0o600)
    && stat.uid === process.getuid?.() && (directory || stat.nlink === 1),
  'State storage must be owned by this user: directory 0700, files 0600, no symlinks/hardlinks.')
}

/** DELETE journal + FULL sync; BEGIN IMMEDIATE is held across every network await, not a TTL lease. */
export class SqliteStore implements Store {
  private db?: Database
  private active = false
  constructor(directory: string, private scope: string, private broadcast: boolean) {
    const dir = resolve(directory)
    if (!existsSync(dir)) {
      if (!broadcast) return // Genuinely read-only: no directory/database creation in dry-run.
      mkdirSync(dir, { recursive: true, mode: 0o700 })
    }
    secure(dir, true)
    requireRelay(realpathSync(dir) === dir, 'State directory path must not contain symlinks.')
    const path = join(dir, 'relayer.sqlite')
    if (!existsSync(path)) {
      if (!broadcast) return
      try { closeSync(openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    }
    secure(path, false)
    for (const suffix of ['-journal', '-wal', '-shm']) if (existsSync(path + suffix)) secure(path + suffix, false)
    const db = new Database(path, { readonly: !broadcast, strict: true })
    try {
      db.exec('PRAGMA busy_timeout = 0')
      if (broadcast) {
        requireRelay((db.query('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode === 'delete',
          'State DB must use DELETE journal mode, not WAL.')
        db.exec('PRAGMA synchronous = FULL')
        try { db.exec('BEGIN IMMEDIATE') }
        catch { throw new RelayError('Relayer database is locked; another broadcast process is running. Do not use a second database.') }
        this.active = true
        db.exec(`CREATE TABLE IF NOT EXISTS checkpoint (id INTEGER PRIMARY KEY CHECK(id=1), scope TEXT NOT NULL, state TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS receipts (decision_id TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL,
            PRIMARY KEY(decision_id, action));`)
      } else {
        db.exec('BEGIN')
        this.active = true
      }
      this.db = db
      this.load() // Refuse a different origin/deployment even if there are no new logs.
    } catch (error) { db.close(); throw error }
  }
  load(): State {
    if (!this.db) return {}
    const exists = this.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='checkpoint'").get()
    if (!exists) return {}
    const row = this.db.query('SELECT scope, state FROM checkpoint WHERE id=1').get() as { scope: string; state: string } | null
    if (!row) return {}
    requireRelay(row.scope === this.scope, 'Database configuration mismatch; do not change deployment, start blocks, identity, or confirmations in place.')
    return decode(row.state)
  }
  save(state: State): void {
    requireRelay(this.broadcast && this.active && this.db, 'Cannot checkpoint a dry-run or closed store.')
    this.db.query('INSERT INTO checkpoint VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET state=excluded.state')
      .run(this.scope, stringify(state))
  }
  evidence(event: Decision, action: Action, evidence: Evidence): void {
    requireRelay(this.broadcast && this.active && this.db, 'Cannot write receipt evidence in dry-run.')
    this.db.query('INSERT INTO receipts VALUES (?, ?, ?) ON CONFLICT(decision_id, action) DO UPDATE SET evidence=excluded.evidence')
      .run(event.decisionId, action, stringify(evidence))
  }
  commit(): void {
    if (this.active && this.db) {
      this.db.exec(this.broadcast ? 'COMMIT' : 'ROLLBACK')
      this.active = false
    }
  }
  close(): void {
    try { if (this.active) this.db?.exec('ROLLBACK') }
    finally { this.active = false; this.db?.close(); this.db = undefined }
  }
}