import { Schema } from 'effect'

/**
 * Schema for an individual JWK
 */
const JWKSchema = Schema.Struct({
	// RFC 7517 standard fields
	kty: Schema.String, // Key Type (required)
	use: Schema.optional(Schema.String), // Public Key Use ("sig" or "enc")
	key_ops: Schema.optional(Schema.mutable(Schema.Array(Schema.String))), // Key Operations
	alg: Schema.optional(Schema.String), // Algorithm
	kid: Schema.optional(Schema.String), // Key ID

	// X.509 fields
	x5u: Schema.optional(Schema.String), // X.509 URL
	x5c: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
	x5t: Schema.optional(Schema.String), // X.509 SHA-1 Thumbprint
	'x5t#S256': Schema.optional(Schema.String), // X.509 SHA-256 Thumbprint

	// RSA key fields (RFC 7518)
	n: Schema.optional(Schema.String), // Modulus
	e: Schema.optional(Schema.String), // Exponent
})

/**
 * Schema for the response body json of a fetch for jWKS response
 */
export const JWKSResponse = Schema.Struct({
	keys: Schema.Array(JWKSchema),
})
