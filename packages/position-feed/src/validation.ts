export const MAX_BODY_BYTES = 16 * 1024
export const MAX_AGE_SECONDS = 30
export const BODY_TIMEOUT_MS = 2000
export type Role = 'read' | 'write'
export type Position = {
  agreementId: string
  currentLossBps: number
  elapsedSeconds: number
  timestamp: number
}
export type Credential = {
  agreementId: string
  role: Role
  token: string
  capacity: number
  windowSeconds: number
}

export function agreementId(value: unknown): value is string {
  return typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && value.length === 66
}

export function token(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 32 && value.length <= 4096 &&
    /^[A-Za-z0-9._~+\/-]+={0,2}$/.test(value) && !/\s/.test(value)
}

export function safeUint(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

export function exactObject(value: unknown, keys: string[]): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
}

export function position(value: unknown, id: string, now: number): Position | null {
  if (!exactObject(value, ['agreementId', 'currentLossBps', 'elapsedSeconds', 'timestamp']) ||
      value.agreementId !== id || !agreementId(value.agreementId) ||
      !safeUint(value.currentLossBps) || !safeUint(value.elapsedSeconds) ||
      !safeUint(value.timestamp) || !fresh(value.timestamp, now)) return null
  return value as Position
}

export function fresh(timestamp: number, now: number): boolean {
  return safeUint(now) && timestamp <= now && now - timestamp <= MAX_AGE_SECONDS
}

// Validate the entire file before opening the database or writing any state.
export function credentials(value: unknown): Credential[] {
  if (!exactObject(value, ['credentials']) || !Array.isArray(value.credentials) ||
      value.credentials.length === 0 || value.credentials.length > 100) throw new Error('Invalid configuration')
  const slots = new Set<string>()
  const tokens = new Set<string>()
  return value.credentials.map(item => {
    if (!exactObject(item, ['agreementId', 'role', 'token', 'capacity', 'windowSeconds']) ||
        !agreementId(item.agreementId) || (item.role !== 'read' && item.role !== 'write') ||
        !token(item.token) || !safeUint(item.capacity) || item.capacity < 1 || item.capacity > 10000 ||
        !safeUint(item.windowSeconds) || item.windowSeconds < 1 || item.windowSeconds > 86400) {
      throw new Error('Invalid configuration')
    }
    const slot = `${item.agreementId}:${item.role}`
    if (slots.has(slot) || tokens.has(item.token)) throw new Error('Invalid configuration')
    slots.add(slot)
    tokens.add(item.token)
    return item as Credential
  })
}