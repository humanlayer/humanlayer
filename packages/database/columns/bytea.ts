import { customType } from 'drizzle-orm/pg-core'

export const bytea = customType<{
	data: Buffer
	notNull: false
	default: false
}>({
	dataType() {
		return 'bytea'
	},
})
