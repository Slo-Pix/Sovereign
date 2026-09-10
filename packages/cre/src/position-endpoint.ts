// Deliberately narrow canonical origin syntax; no WHATWG URL dependency in CRE WASM.
// No userinfo, path, query, fragment, encoded host, IP literal or ambiguous numeric host.
export function isPositionOrigin(origin: string, allowLoopback = false): boolean {
  if (/\s/.test(origin)) return false
  if (allowLoopback && /^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(origin)) {
    return Number(origin.slice(origin.lastIndexOf(':') + 1)) <= 65535
  }
  const match = /^https:\/\/([a-z0-9.-]+)(?::([1-9][0-9]{0,4}))?$/.exec(origin)
  if (!match || match[1].length > 253 || (match[2] && Number(match[2]) > 65535)) return false
  const labels = match[1].split('.')
  return labels.length >= 2 && /^[a-z]{2,63}$/.test(labels[labels.length - 1]) &&
    labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
}

export function positionEndpoint(origin: string, agreementId: string, allowLoopback = false): string | undefined {
  if (!isPositionOrigin(origin, allowLoopback) || agreementId.length !== 66 || !/^0x[0-9a-fA-F]{64}$/.test(agreementId)) return undefined
  return `${origin}/agreements/${agreementId.toLowerCase()}/position`
}