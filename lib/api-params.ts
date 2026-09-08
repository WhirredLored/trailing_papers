import type { NextApiRequest } from 'next'

/**
 * Next's dynamic route params are typed `string | string[] | undefined` because a
 * repeated key (?id=a&id=b) really does arrive as an array. Passing that straight
 * into .eq() builds a malformed filter, so every route narrows it here first.
 *
 * Returns null when the param is missing or empty; callers reject with 400.
 */
export function routeParam(req: NextApiRequest, key: string): string | null {
  const raw = req.query[key]
  if (typeof raw === 'string') return raw.length > 0 ? raw : null
  if (Array.isArray(raw)) {
    const first = raw[0]
    return typeof first === 'string' && first.length > 0 ? first : null
  }
  return null
}
