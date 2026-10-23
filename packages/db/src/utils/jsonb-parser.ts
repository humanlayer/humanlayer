import z from 'zod/v4'

/**
 * Electric sends JSONB columns as strings over the wire, so select schemas must
 * JSON.parse string values before applying the column's Zod schema. Values that
 * are already parsed (e.g. rows read directly from Postgres) pass through.
 * Works for both object- and array-shaped JSONB columns.
 */
export const jsonbParser = <T extends z.ZodTypeAny>(schema: T) =>
	z.preprocess((val) => {
		if (typeof val === 'string') {
			try {
				return JSON.parse(val)
			} catch {
				return val
			}
		}
		return val
	}, schema)
