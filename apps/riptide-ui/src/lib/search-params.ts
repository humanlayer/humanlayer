import z from 'zod/v4'

export const optionalBooleanSearchParam = z
	.preprocess((value) => {
		if (value === 'true') return true
		if (value === 'false') return false
		return value
	}, z.boolean())
	.optional()
