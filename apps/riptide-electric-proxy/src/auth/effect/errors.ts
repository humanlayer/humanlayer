import { Data } from 'effect'

/**
 * Generic error for when we can't fetch JWKS
 */
export class JWKSFetchError extends Data.TaggedError('JWKSFetchError')<{
	cause: string
	message: string
}> {}

/**
 * Specific error for when JWKS fetch times out
 */
export class JWKSFetchTimeoutError extends Data.TaggedError('JWKSFetchTimeoutError')<{}> {}

/**
 * Error for when a token shows up with a key that we can't find
 */
export class JWKSKeyNotFoundError extends Data.TaggedError('JWKSKeyNotFoundError')<{
	kid: string
}> {}

/**
 * Error for when the keys are not ready - I think we should not actualyl need this
 */
export class JWKSNotReadyError extends Data.TaggedError('JWKSNotReadyError')<{}> {}

/**
 * Error for when importing a successfully-fetched key causes an error
 */
export class JWKSKeyImportError extends Data.TaggedError('JWKSKeyImportError')<{
	kid: string
	cause: string
}> {}

export class JWTMalformedError extends Data.TaggedError('JWTMalformedError')<{
	cause: string
}> {}

export class JWTMissingKidError extends Data.TaggedError('JWTMissingKidError')<{}> {}

export class JWTMissingIssuerError extends Data.TaggedError('JWTMissingIssuerError')<{}> {}

export class JWTVerificationError extends Data.TaggedError('JWTVerificationError')<{
	cause: string
}> {}

export class JWTMissingInternalOrgIdError extends Data.TaggedError('JWTMissingInternalOrgIdError')<{
	workosOrganizationId?: string
}> {}
