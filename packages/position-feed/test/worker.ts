// Cross-process tests use generated synthetic credentials only. Output is status-only.
import { Store, hashToken } from '../src/store'
import type { Position, Role } from '../src/validation'

const store = new Store(process.env.TEST_DB!)
try {
  const result = store.access(
    process.env.TEST_ID!, process.env.TEST_ROLE as Role, hashToken(process.env.TEST_TOKEN!),
    () => Number(process.env.TEST_NOW),
    process.env.TEST_POSITION ? JSON.parse(process.env.TEST_POSITION) as Position : undefined,
  )
  process.stdout.write(String(result.status))
} finally { store.close() }