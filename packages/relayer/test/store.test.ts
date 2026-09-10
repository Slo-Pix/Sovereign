import { afterEach, expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteStore } from '../src/store'
import { storageScope } from '../src/config'
import { processOnce } from '../src/processor'
import { block, cfg, fixture } from './fixtures'

const dirs: string[] = []
const stores: SqliteStore[] = []
const temp = () => { const dir = mkdtempSync(join(tmpdir(), 'sovereign-relayer-test-')); dirs.push(dir); return dir }
const open = (dir: string, write = true, scope = storageScope(cfg)) => {
  const store = new SqliteStore(dir, scope, write); stores.push(store); return store
}
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

test('0600 database and 0700 directory; commit survives close/reopen', () => {
  const dir = temp(); const store = open(dir)
  store.save({ cursor: block(12n), destination: block(100n) }); store.commit(); store.close()
  expect(statSync(dir).mode & 0o777).toBe(0o700)
  expect(statSync(join(dir, 'relayer.sqlite')).mode & 0o777).toBe(0o600)
  expect(open(dir).load()).toEqual({ cursor: block(12n), destination: block(100n) })
})
test('BEGIN IMMEDIATE refuses concurrent writer across asynchronous network work', async () => {
  const dir = temp(); const first = open(dir)
  await Promise.resolve()
  expect(() => open(dir)).toThrow('locked')
  first.close()
  expect(open(dir).load()).toEqual({})
})
test('close without commit rolls back cursor/receipts, restart reconciles destination', async () => {
  const dir = temp(); const first = open(dir); const f = fixture()
  await processOnce(cfg, f.rpc, first, true)
  first.close() // Simulate loss just before commit, after transaction receipt was observed.
  const restarted = open(dir)
  expect(restarted.load()).toEqual({})
  const plans = await processOnce(cfg, f.rpc, restarted, true)
  restarted.commit()
  expect(plans[0]?.outcome).toBe('reconciled')
  expect(f.data.sends).toEqual(['lockAgreement'])
})
test('dry-run missing storage performs no filesystem creation', () => {
  const dir = join(temp(), 'absent')
  const store = open(dir, false)
  expect(store.load()).toEqual({}); store.commit()
  expect(existsSync(dir)).toBe(false)
})
test('dry-run existing DB remains byte-for-byte unchanged and rejects writes', () => {
  const dir = temp(); const first = open(dir)
  first.save({ cursor: block(12n) }); first.commit(); first.close()
  const path = join(dir, 'relayer.sqlite'); const before = readFileSync(path)
  const reader = open(dir, false)
  expect(reader.load().cursor).toEqual(block(12n))
  expect(() => reader.save({ cursor: block(99n) })).toThrow('dry-run')
  reader.commit(); reader.close()
  expect(readFileSync(path)).toEqual(before)
})
test('storage deployment/origin identity cannot silently change', () => {
  const dir = temp(); const first = open(dir)
  first.save({ cursor: block(12n) }); first.commit(); first.close()
  expect(() => open(dir, true, storageScope({ ...cfg, sourceStart: 11n }))).toThrow('configuration mismatch')
})
test('refuses permissive directory instead of changing unrelated permissions', () => {
  const dir = temp(); chmodSync(dir, 0o755)
  expect(() => open(dir)).toThrow('0700')
})
test('refuses permissive database', () => {
  const dir = temp(); const first = open(dir); first.commit(); first.close()
  chmodSync(join(dir, 'relayer.sqlite'), 0o644)
  expect(() => open(dir)).toThrow('0600')
})
test('refuses symlink directory', () => {
  const root = temp(); const target = temp(); const link = join(root, 'link')
  symlinkSync(target, link)
  expect(() => open(link)).toThrow('symlinks')
})