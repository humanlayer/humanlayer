import * as Schema from 'effect/Schema'

export const ElectricFetchError = Schema.Struct({
	name: Schema.Literal('FetchError'),
	status: Schema.Number,
	url: Schema.String,
})
export type ElectricFetchError = typeof ElectricFetchError.Type
