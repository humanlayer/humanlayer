import * as Schema from 'effect/Schema'

export const WorkOsAccessTokenClaims = Schema.Struct({
	iss: Schema.NonEmptyString,
	sub: Schema.NonEmptyString,
	sid: Schema.NonEmptyString,
	act: Schema.optionalKey(Schema.Struct({ sub: Schema.NonEmptyString })),
	org_id: Schema.optionalKey(Schema.String),
	internal_org_id: Schema.optionalKey(Schema.String),
	role: Schema.optionalKey(Schema.String),
	roles: Schema.optionalKey(Schema.mutable(Schema.Array(Schema.String))),
	permissions: Schema.optionalKey(Schema.mutable(Schema.Array(Schema.String))),
	entitlements: Schema.optionalKey(Schema.mutable(Schema.Array(Schema.String))),
	feature_flags: Schema.optionalKey(Schema.mutable(Schema.Array(Schema.String))),
})
export interface WorkOsAccessTokenClaims extends Schema.Schema.Type<typeof WorkOsAccessTokenClaims> {}

const decodeWorkOsAccessTokenClaims = Schema.decodeUnknownSync(WorkOsAccessTokenClaims)

export function parseWorkOsAccessTokenClaims(input: unknown): WorkOsAccessTokenClaims {
	return decodeWorkOsAccessTokenClaims(input)
}
