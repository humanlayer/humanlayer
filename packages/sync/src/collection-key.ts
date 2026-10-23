import z from 'zod/v4'

/**
 * Default key for collections whose rows use the standard `id` primary key.
 * Collections with another identity must supply `getKey` explicitly.
 */
export type CollectionKeyOption<TRow> = { getKey?: (row: TRow) => string } & (TRow extends { id: string }
	? object
	: { getKey: (row: TRow) => string })

const DefaultCollectionKeyRowSchema = z.object({ id: z.string() })

export function defaultCollectionKey(row: unknown): string {
	const parsed = DefaultCollectionKeyRowSchema.safeParse(row)
	if (!parsed.success) {
		throw new TypeError('Collection rows without a string id must provide getKey')
	}
	return parsed.data.id
}
