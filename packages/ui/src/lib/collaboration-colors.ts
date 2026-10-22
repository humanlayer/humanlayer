/** Presentation-only identity. Never use awareness to authorize or attribute a prompt. */
export interface CollaborationIdentity {
  displayName: string
  photoUrl?: string
}

export function collaborationPaletteSlot(memberId: string): number {
  let hash = 2166136261
  for (const character of memberId) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619)
  return 1 + ((hash >>> 0) % 6)
}

export function collaborationColor(memberId: string): string {
  return `var(--terminal-color-${collaborationPaletteSlot(memberId)})`
}
