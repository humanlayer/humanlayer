import * as Schema from 'effect/Schema'

/**
 * What a `pull_request` delivery reports beyond the row the panel renders. The panel's own GraphQL
 * query does not ask for any of it, so these fields are absent unless a delivery carried them, and
 * the writer that stores them treats an absent value as "unchanged" rather than "cleared".
 */

export const PullRequestAuthor = Schema.Struct({
	login: Schema.NullOr(Schema.String),
	/** GitHub's numeric account id as text; stable across renames. */
	id: Schema.NullOr(Schema.String),
	isBot: Schema.Boolean,
})
export type PullRequestAuthor = typeof PullRequestAuthor.Type

export const PullRequestLifecycleTimes = Schema.Struct({
	openedAt: Schema.NullOr(Schema.Number),
	mergedAt: Schema.NullOr(Schema.Number),
	closedAt: Schema.NullOr(Schema.Number),
	mergedByLogin: Schema.NullOr(Schema.String),
})
export type PullRequestLifecycleTimes = typeof PullRequestLifecycleTimes.Type
