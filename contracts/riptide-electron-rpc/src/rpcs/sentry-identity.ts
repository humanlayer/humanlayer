import * as Rpc from 'effect/rpc/Rpc'
import * as Schema from 'effect/Schema'

export class SetSentryIdentity extends Rpc.make('SetSentryIdentity', {
	payload: {
		userId: Schema.NullOr(Schema.String),
		email: Schema.optional(Schema.String),
		organizationId: Schema.optional(Schema.String),
		organizationName: Schema.optional(Schema.String),
	},
	success: Schema.Void,
}) {}
