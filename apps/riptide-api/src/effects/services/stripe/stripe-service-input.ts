import { Effect } from 'effect'
import * as Schema from 'effect/Schema'

import { StripeServiceInputParseError } from './stripe.errors'

export function decodeStripeServiceInput<S extends Schema.Top>(schema: S, input: unknown, operation: string) {
	return Schema.decodeUnknownEffect(schema)(input).pipe(
		Effect.mapError((cause) => new StripeServiceInputParseError({ operation, cause })),
	)
}
