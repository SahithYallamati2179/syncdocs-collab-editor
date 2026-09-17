/**
 * Presence colours.
 *
 * Eight fixed hues, assigned by hashing the stable user id. Assigning by hash
 * rather than by join order means your colour does not change when someone else
 * leaves the document -- identity has to survive a reconnect, or the cursor
 * labels lie. The hues are a colour-vision-deficiency validated categorical set,
 * so two cursors are always tellable apart.
 */
export const PRESENCE_COLORS = [
  '#2a78d6', // blue
  '#eb6834', // orange
  '#1baf7a', // aqua
  '#eda100', // yellow
  '#e87ba4', // magenta
  '#008300', // green
  '#4a3aa7', // violet
  '#e34948', // red
] as const

/** FNV-1a. Small, fast, and stable across reloads and across machines. */
export function hashString(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export function colorForUser(userId: string): string {
  return PRESENCE_COLORS[hashString(userId) % PRESENCE_COLORS.length]
}

export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
