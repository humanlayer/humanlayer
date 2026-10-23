import { Effect, Redacted, Schema } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'

import {
	GitHubProviderAccessBlockedError,
	GitHubProviderDecodeError,
	GitHubProviderForbiddenError,
	GitHubProviderResponseError,
	GitHubProviderTransportError,
} from '../github.errors'

// https://docs.github.com/en/graphql/overview/resource-limitations — a refusal is reported per
// denied node, so a document that selects ten forbidden nodes answers with ten of these.
const FORBIDDEN = 'FORBIDDEN'

const GitHubGraphQLError = Schema.Struct({
	message: Schema.optional(Schema.String),
	type: Schema.optional(Schema.String),
	path: Schema.optional(Schema.Array(Schema.Union([Schema.String, Schema.Number]))),
})
type GitHubGraphQLError = Schema.Schema.Type<typeof GitHubGraphQLError>

const GitHubGraphQLEnvelope = Schema.Struct({
	data: Schema.optional(Schema.Unknown),
	errors: Schema.optional(Schema.Array(GitHubGraphQLError)),
})

const errorPath = (error: GitHubGraphQLError): string => (error.path ?? []).join('.')

const errorMessages = (errors: readonly GitHubGraphQLError[]): string =>
	errors.map((error) => error.message ?? 'unknown').join('; ')

const ROOT_PATH = 'repository'

const refusedByGrant = (errors: readonly GitHubGraphQLError[]): boolean =>
	errors.some((error) => error.type === FORBIDDEN)

const refusedAtRoot = (errors: readonly GitHubGraphQLError[]): boolean =>
	errors.some((error) => error.type === FORBIDDEN && errorPath(error) === ROOT_PATH)

/** `messages` is GitHub's own prose and is shown to the user; the types and paths are for the capture. */
export interface GitHubGraphQLErrorsCause {
	readonly kind: 'graphql_errors'
	readonly messages: string
	readonly types: readonly string[]
	readonly paths: readonly string[]
}

export const isGitHubGraphQLErrorsCause = (cause: unknown): cause is GitHubGraphQLErrorsCause =>
	typeof cause === 'object' && cause !== null && (cause as GitHubGraphQLErrorsCause).kind === 'graphql_errors'

// GraphQL answers `200 OK` with a populated `errors[]` on a query failure, so a transport-level
// success is not a successful query.
export const graphql = <A>(input: {
	readonly apiBaseUrl: URL
	readonly installationToken: Redacted.Redacted<string>
	readonly operation: string
	readonly query: string
	readonly variables: Readonly<Record<string, unknown>>
	readonly schema: Schema.ConstraintDecoder<A, never>
}) =>
	Effect.gen(function* () {
		const httpClient = yield* HttpClient.HttpClient
		const url = new URL('/graphql', input.apiBaseUrl)
		const request = HttpClientRequest.post(url.toString()).pipe(
			HttpClientRequest.bearerToken(Redacted.value(input.installationToken)),
			HttpClientRequest.setHeader('Accept', 'application/vnd.github+json'),
			HttpClientRequest.setHeader('X-GitHub-Api-Version', '2022-11-28'),
			HttpClientRequest.setHeader('User-Agent', 'HumanLayer-Riptide'),
			HttpClientRequest.bodyJsonUnsafe({ query: input.query, variables: input.variables }),
		)
		const response = yield* httpClient
			.execute(request)
			.pipe(Effect.mapError((cause) => new GitHubProviderTransportError({ operation: input.operation, cause })))
		if (response.status < 200 || response.status >= 300) {
			return yield* Effect.fail(
				new GitHubProviderResponseError({ operation: input.operation, status: response.status }),
			)
		}
		const envelope = yield* response.json.pipe(
			Effect.flatMap((json) => Schema.decodeUnknownEffect(GitHubGraphQLEnvelope)(json)),
			Effect.mapError((cause) => new GitHubProviderDecodeError({ operation: input.operation, cause })),
		)
		const errors = envelope.errors ?? []
		if (errors.length > 0) {
			if (refusedAtRoot(errors)) {
				return yield* Effect.fail(
					new GitHubProviderAccessBlockedError({
						operation: input.operation,
						paths: errors.map(errorPath),
						messages: errorMessages(errors),
					}),
				)
			}
			if (refusedByGrant(errors)) {
				return yield* Effect.fail(
					new GitHubProviderForbiddenError({
						operation: input.operation,
						paths: errors.map(errorPath),
						messages: errorMessages(errors),
					}),
				)
			}
			const cause: GitHubGraphQLErrorsCause = {
				kind: 'graphql_errors',
				messages: errorMessages(errors),
				types: errors.map((error) => error.type ?? 'unknown'),
				paths: errors.map(errorPath),
			}
			return yield* Effect.fail(new GitHubProviderDecodeError({ operation: input.operation, cause }))
		}
		return yield* Schema.decodeUnknownEffect(input.schema)(envelope.data).pipe(
			Effect.mapError((cause) => new GitHubProviderDecodeError({ operation: input.operation, cause })),
		)
	}).pipe(Effect.withSpan(`github.api.graphql.${input.operation}`))
