import * as Schema from 'effect/Schema'

export const PlanningArtifactIdentity = Schema.Struct({
	frontmatterType: Schema.optional(Schema.NullOr(Schema.String)),
	fileName: Schema.optional(Schema.NullOr(Schema.String)),
})
export interface PlanningArtifactIdentity extends Schema.Schema.Type<typeof PlanningArtifactIdentity> {}

export const PlanningCommentEligibilityInput = Schema.Struct({
	...PlanningArtifactIdentity.fields,
	ownerUserId: Schema.String,
	commenterUserId: Schema.String,
})
export interface PlanningCommentEligibilityInput extends Schema.Schema.Type<typeof PlanningCommentEligibilityInput> {}

export const RecordFirstInboundReviewCommentInput = Schema.Struct({
	...PlanningCommentEligibilityInput.fields,
	organizationId: Schema.String,
	createdByAgent: Schema.Boolean,
	now: Schema.BigInt,
})
export interface RecordFirstInboundReviewCommentInput extends Schema.Schema.Type<
	typeof RecordFirstInboundReviewCommentInput
> {}

export const CollaborationBackfillTarget = Schema.TaggedUnion({
	Organization: { organizationId: Schema.String },
	AllOrganizations: {},
})
export type CollaborationBackfillTarget = typeof CollaborationBackfillTarget.Type

export const BackfillCollaborationMilestonesInput = Schema.Struct({
	target: CollaborationBackfillTarget,
	apply: Schema.Boolean,
})
export interface BackfillCollaborationMilestonesInput extends Schema.Schema.Type<
	typeof BackfillCollaborationMilestonesInput
> {}

export const CollaborationBackfillCommandInput = Schema.Struct({
	organizationId: Schema.NullOr(Schema.String),
	allOrganizations: Schema.Boolean,
	apply: Schema.Boolean,
})
export interface CollaborationBackfillCommandInput extends Schema.Schema.Type<
	typeof CollaborationBackfillCommandInput
> {}

export const CollaborationBackfillOwnerCursor = Schema.Struct({
	organizationId: Schema.String,
	ownerUserId: Schema.String,
})
export interface CollaborationBackfillOwnerCursor extends Schema.Schema.Type<typeof CollaborationBackfillOwnerCursor> {}

export const CollaborationBackfillCandidate = Schema.Struct({
	organizationId: Schema.String,
	ownerUserId: Schema.String,
})
export interface CollaborationBackfillCandidate extends Schema.Schema.Type<typeof CollaborationBackfillCandidate> {}

export const CollaborationBackfillSummary = Schema.Struct({
	ownersChecked: Schema.Number,
	ownersWithQualifyingFeedback: Schema.Number,
	settingsRowsChanged: Schema.Number,
	failed: Schema.Boolean,
})
export interface CollaborationBackfillSummary extends Schema.Schema.Type<typeof CollaborationBackfillSummary> {}

export class CollaborationBackfillInvalidInput extends Schema.TaggedError<CollaborationBackfillInvalidInput>()(
	'CollaborationBackfillInvalidInput',
	{ message: Schema.String },
) {}

export class CollaborationBackfillPersistenceUnavailable extends Schema.TaggedError<CollaborationBackfillPersistenceUnavailable>()(
	'CollaborationBackfillPersistenceUnavailable',
	{ operation: Schema.String, retryable: Schema.Boolean },
) {}

export class CollaborationBackfillInvalidStoredMetadata extends Schema.TaggedError<CollaborationBackfillInvalidStoredMetadata>()(
	'CollaborationBackfillInvalidStoredMetadata',
	{ artifactId: Schema.String },
) {}

export class CollaborationBackfillIncompleteVerification extends Schema.TaggedError<CollaborationBackfillIncompleteVerification>()(
	'CollaborationBackfillIncompleteVerification',
	{ remainingOwnerCount: Schema.Number },
) {}
