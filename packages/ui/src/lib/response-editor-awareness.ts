import z from 'zod/v4'

const id = z.object({ client: z.number().int().nonnegative(), clock: z.number().int().nonnegative() })
const position = z.object({
  type: id.nullish(),
  tname: z.string().nullish(),
  item: id.nullish(),
  assoc: z.number().int().optional(),
})
export const relativeSelectionSchema = z.object({ anchor: position, head: position })
const announcement = z.object({
  user: z.object({ memberId: z.string().min(1).max(256) }),
  session: z.object({ present: z.literal(true) }),
  cursor: z.unknown().optional(),
})

/** Discard peer presentation fields and malformed cursors at the boundary. */
export function readResponseEditorAwareness(value: unknown) {
  const parsed = announcement.safeParse(value)
  if (!parsed.success) return null
  const cursor = relativeSelectionSchema.safeParse(parsed.data.cursor)
  return { memberId: parsed.data.user.memberId, cursor: cursor.success ? cursor.data : null }
}
