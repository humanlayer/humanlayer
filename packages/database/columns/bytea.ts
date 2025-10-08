import { customType } from 'drizzle-orm/pg-core'

export const bytea = customType<{
	data: string
	notNull: false
	default: false
}>({
	dataType() {
		return 'bytea'
	},
	toDriver(val) {
		let newVal = val
		if (val.startsWith('0x')) {
			newVal = val.slice(2)
		}

		return Buffer.from(newVal, 'hex')
	},
	fromDriver(val: unknown) {
		return (val as Buffer).toString('hex')
	},
})
