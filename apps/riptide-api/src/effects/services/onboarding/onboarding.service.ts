import type { SessionLabel } from '@humanlayer/db/tables/sessions'
import { isStructuredTaskWorkflow, type TaskWorkflowType } from '@humanlayer/schemas/effect/taskconfiguration'
import { Context, DateTime, Effect, Layer } from 'effect'

import { PostgresDb } from '../postgres/postgres-db.service'
import { ResendService } from '../resend/resend.service'
import { WorkosService } from '../workos/workos.service'
import { assignOnboardingSequence, loadOnboardingConfigFromEffectConfig } from './onboarding-config'
import {
	AutomationStartFailed,
	ContactLookupFailed,
	EnrollmentResendFailed,
	MilestonePatchFailed,
	type OnboardingError,
	type OnboardingMilestone,
} from './onboarding-errors'
import {
	hasDesignDocIterated,
	hasImplementationLabel,
	isCrossUserHumanComment,
	isDesignDiscussionArtifact,
	isDesignReviewArtifactById,
	isPrDescriptionArtifact,
	isStructureOutlineArtifact,
} from './onboarding-milestones'
import { ONBOARDING_EVENT_STARTED, OnboardingProperties } from './onboarding-properties'

export class OnboardingService extends Context.Service<
	OnboardingService,
	{
		enrollMember: (input: { userId: string; organizationId: string }) => Effect.Effect<void, OnboardingError>
		recordRpiTaskCreated: (input: {
			userId: string
			taskId: string
			workflowType: TaskWorkflowType
			isDraft: boolean
		}) => Effect.Effect<void, OnboardingError>
		recordTrackerConnected: (input: {
			userId: string
			organizationId: string
			provider: 'linear' | 'jira'
			integrationId: string
		}) => Effect.Effect<void, OnboardingError>
		recordDesignDocIterated: (input: {
			resourceOwnerUserId: string
			artifactId: string
			taskId: string | null
			fileName: string
			frontmatterType?: string
			versionNumber?: number
		}) => Effect.Effect<void, OnboardingError>
		recordDesignDocInboundCommentReceived: (input: {
			ownerUserId: string
			commenterUserId: string
			artifactId: string
			commentId: string
			taskId: string | null
			createdByAgent: boolean
		}) => Effect.Effect<void, OnboardingError>
		recordDesignDocInboundCommentResolved: (input: {
			ownerUserId: string
			resolverUserId: string
			commentId: string
			artifactId: string
			taskId: string | null
			isResolved: boolean
		}) => Effect.Effect<void, OnboardingError>
		recordStructureOutlineCreated: (input: {
			resourceOwnerUserId: string
			artifactId: string
			taskId: string | null
			fileName: string
			frontmatterType?: string
		}) => Effect.Effect<void, OnboardingError>
		recordImplementationStarted: (input: {
			userId: string
			sessionId: string
			taskId: string | null
			labels?: SessionLabel[]
			label?: SessionLabel
			source: 'daemon_event_label' | 'auto_advance'
		}) => Effect.Effect<void, OnboardingError>
		recordImplementationComplete: (input: {
			resourceOwnerUserId: string
			artifactId: string
			taskId: string | null
			fileName: string
		}) => Effect.Effect<void, OnboardingError>
		recordCommentedOnTeammateDoc: (input: {
			ownerUserId: string
			commenterUserId: string
			artifactId: string
			commentId: string
			taskId: string | null
			createdByAgent: boolean
		}) => Effect.Effect<void, OnboardingError>
	}
>()('OnboardingService') {}

export const OnboardingServiceLive = Layer.effect(
	OnboardingService,
	Effect.gen(function* () {
		const resend = yield* ResendService
		const workos = yield* WorkosService
		const postgres = yield* PostgresDb
		// Resolve and validate campaign config once while the layer is built so the
		// live service closes over validated values instead of reading config per
		// enrollment. Config/validation failures become defects via `Effect.orDie`,
		// keeping this layer's error channel `never` for the app runtime.
		const config = yield* loadOnboardingConfigFromEffectConfig

		const enrollMember = ({ userId, organizationId }: { userId: string; organizationId: string }) =>
			Effect.gen(function* () {
				const user = yield* workos
					.getUser({ userId })
					.pipe(
						Effect.mapError(
							(cause) => new ContactLookupFailed({ userId, operation: 'workos_profile_lookup', cause }),
						),
					)
				const existing = yield* resend.getContact({ email: user.email }).pipe(
					Effect.mapError(
						(cause) =>
							new ContactLookupFailed({
								userId,
								email: user.email,
								operation: 'contact_lookup',
								cause,
							}),
					),
				)

				if (existing?.properties?.[OnboardingProperties.enrolledAt]) return

				const sequence = assignOnboardingSequence(config)
				const properties = {
					[OnboardingProperties.workosUserId]: userId,
					[OnboardingProperties.enrolledAt]: DateTime.formatIso(yield* DateTime.now),
					[OnboardingProperties.sequence]: sequence,
					[OnboardingProperties.disabled]: config.enabled ? '0' : '1',
					[OnboardingProperties.isAdmin]: '1',
				}

				yield* resend
					.upsertContact({
						email: user.email,
						firstName: user.firstName,
						lastName: user.lastName,
						properties,
						segments: [{ id: config.productUsersSegmentId }],
					})
					.pipe(
						Effect.mapError(
							(cause) =>
								new EnrollmentResendFailed({
									userId,
									email: user.email,
									operation: 'contact_patch',
									cause,
								}),
						),
					)

				yield* resend
					.sendEvent({
						event: ONBOARDING_EVENT_STARTED,
						email: user.email,
						payload: { userId, organizationId, sequence },
					})
					.pipe(Effect.mapError((cause) => new AutomationStartFailed({ userId, email: user.email, cause })))
			})

		// Write-once, blind milestone patch. Milestone writes do not read the
		// Resend contact first (the TDD's write-once semantics): once a product
		// event proves the milestone, the matching `onboarding__*` property is set
		// to "1". Re-setting the same value is acceptable and keeps the path cheap.
		// The only query is the WorkOS profile lookup needed to resolve the contact
		// email (the `workos_user_id` -> Resend contact identity bridge).
		const patchMilestone = (input: { userId: string; milestone: OnboardingMilestone; property: string }) =>
			Effect.gen(function* () {
				const user = yield* workos.getUser({ userId: input.userId }).pipe(
					Effect.mapError(
						(cause) =>
							new MilestonePatchFailed({
								userId: input.userId,
								milestone: input.milestone,
								cause,
							}),
					),
				)

				yield* resend
					.patchContactProperties({
						email: user.email,
						properties: { [input.property]: '1' },
					})
					.pipe(
						Effect.catchTag('ResendOperationError', (err) =>
							err.category === 'resource_missing'
								? resend.upsertContact({
										email: user.email,
										firstName: user.firstName,
										lastName: user.lastName,
										properties: { [input.property]: '1' },
									})
								: Effect.fail(err),
						),
						Effect.mapError(
							(cause) =>
								new MilestonePatchFailed({
									userId: input.userId,
									milestone: input.milestone,
									cause,
								}),
						),
					)
			})

		const recordRpiTaskCreated = (input: {
			userId: string
			taskId: string
			workflowType: TaskWorkflowType
			isDraft: boolean
		}) =>
			Effect.gen(function* () {
				// No-op unless a launched structured-workflow task (RPI / outline /
				// PRD-TDD) was created/promoted. The caller passes the values it already
				// wrote, so there is no DB query here.
				if (!isStructuredTaskWorkflow(input.workflowType) || input.isDraft) return
				yield* patchMilestone({
					userId: input.userId,
					milestone: 'rpi_task_created',
					property: OnboardingProperties.rpiTaskCreated,
				})
			})

		const recordTrackerConnected = (input: {
			userId: string
			organizationId: string
			provider: 'linear' | 'jira'
			integrationId: string
		}) =>
			// Exchange success is the proof; no DB query needed.
			patchMilestone({
				userId: input.userId,
				milestone: 'tracker_connected',
				property: OnboardingProperties.trackerConnected,
			})

		// Wrap a proof query's transport failure in the milestone domain error so
		// detached observability carries the campaign milestone alongside the user.
		const proofQueryError = (userId: string, milestone: OnboardingMilestone) => (cause: Error) =>
			new MilestonePatchFailed({ userId, milestone, cause })

		const recordDesignDocIterated = (input: {
			resourceOwnerUserId: string
			artifactId: string
			taskId: string | null
			fileName: string
			frontmatterType?: string
			versionNumber?: number
		}) =>
			Effect.gen(function* () {
				// No-op unless the artifact is a design discussion. The caller passes the
				// frontmatter type / filename it already wrote, so this is a cheap guard.
				if (!isDesignDiscussionArtifact({ frontmatterType: input.frontmatterType, fileName: input.fileName })) {
					return
				}

				// Proof: the design discussion has been iterated to >=2 versions.
				const iterated = yield* hasDesignDocIterated(postgres, {
					artifactId: input.artifactId,
					versionNumber: input.versionNumber,
				}).pipe(Effect.mapError(proofQueryError(input.resourceOwnerUserId, 'design_doc_iterated')))

				if (!iterated) return

				yield* patchMilestone({
					userId: input.resourceOwnerUserId,
					milestone: 'design_doc_iterated',
					property: OnboardingProperties.designDocIterated,
				})
			})

		const recordDesignDocInboundCommentReceived = (input: {
			ownerUserId: string
			commenterUserId: string
			artifactId: string
			commentId: string
			taskId: string | null
			createdByAgent: boolean
		}) =>
			Effect.gen(function* () {
				// Inbound means a different human commented on the owner's doc. Agent
				// comments and self-comments never count.
				if (!isCrossUserHumanComment(input)) return

				const isReviewDoc = yield* isDesignReviewArtifactById(postgres, {
					artifactId: input.artifactId,
				}).pipe(Effect.mapError(proofQueryError(input.ownerUserId, 'design_doc_inbound_comment_received')))

				if (!isReviewDoc) return

				// The owner is the one progressing through the sequence — patch their contact.
				yield* patchMilestone({
					userId: input.ownerUserId,
					milestone: 'design_doc_inbound_comment_received',
					property: OnboardingProperties.designDocInboundCommentReceived,
				})
			})

		const recordDesignDocInboundCommentResolved = (input: {
			ownerUserId: string
			resolverUserId: string
			commentId: string
			artifactId: string
			taskId: string | null
			isResolved: boolean
		}) =>
			Effect.gen(function* () {
				// Only the resolved transition closes the loop.
				if (!input.isResolved) return

				const isReviewDoc = yield* isDesignReviewArtifactById(postgres, {
					artifactId: input.artifactId,
				}).pipe(Effect.mapError(proofQueryError(input.ownerUserId, 'design_doc_inbound_comment_resolved')))

				if (!isReviewDoc) return

				yield* patchMilestone({
					userId: input.ownerUserId,
					milestone: 'design_doc_inbound_comment_resolved',
					property: OnboardingProperties.designDocInboundCommentResolved,
				})
			})

		// --- Full-sequence tail milestones (PR Milestone 5) ---

		const recordStructureOutlineCreated = (input: {
			resourceOwnerUserId: string
			artifactId: string
			taskId: string | null
			fileName: string
			frontmatterType?: string
		}) =>
			Effect.gen(function* () {
				// No-op unless the artifact is a structure outline. The caller passes the
				// frontmatter type / filename it already wrote, so this is a cheap guard
				// with no DB query: a written structure outline is itself the proof.
				if (!isStructureOutlineArtifact({ frontmatterType: input.frontmatterType, fileName: input.fileName })) {
					return
				}

				yield* patchMilestone({
					userId: input.resourceOwnerUserId,
					milestone: 'structure_outline_created',
					property: OnboardingProperties.structureOutlineCreated,
				})
			})

		const recordImplementationStarted = (input: {
			userId: string
			sessionId: string
			taskId: string | null
			labels?: SessionLabel[]
			label?: SessionLabel
			source: 'daemon_event_label' | 'auto_advance'
		}) =>
			Effect.gen(function* () {
				// No-op unless the labels touched by this product event include the
				// implementation label. The caller passes the label(s) it just
				// appended/created, so this is a cheap in-memory guard with no DB query.
				let labels = input.labels
				if (input.label) {
					const existingLabels = input.labels ?? []
					labels = [...existingLabels, input.label]
				}
				if (!hasImplementationLabel(labels)) return

				yield* patchMilestone({
					userId: input.userId,
					milestone: 'implementation_started',
					property: OnboardingProperties.implementationStarted,
				})
			})

		const recordImplementationComplete = (input: {
			resourceOwnerUserId: string
			artifactId: string
			taskId: string | null
			fileName: string
		}) =>
			Effect.gen(function* () {
				// A written pr-description is the proof the implementation completed. The
				// caller passes the filename it already wrote, so no DB query is needed.
				if (!isPrDescriptionArtifact({ fileName: input.fileName })) return

				yield* patchMilestone({
					userId: input.resourceOwnerUserId,
					milestone: 'implementation_complete',
					property: OnboardingProperties.implementationComplete,
				})
			})

		const recordCommentedOnTeammateDoc = (input: {
			ownerUserId: string
			commenterUserId: string
			artifactId: string
			commentId: string
			taskId: string | null
			createdByAgent: boolean
		}) =>
			Effect.gen(function* () {
				// Outbound: the commenter left a comment on SOMEONE ELSE'S doc. Agent
				// comments and self-comments never count. This is the mirror of the
				// inbound-comment direction check — here the commenter is the one
				// progressing through the sequence, not the owner. Any artifact type
				// counts (the lesson is "see your team's work", not design-doc specific).
				if (!isCrossUserHumanComment(input)) return

				yield* patchMilestone({
					userId: input.commenterUserId,
					milestone: 'commented_on_teammate_doc',
					property: OnboardingProperties.commentedOnTeammateDoc,
				})
			})

		return {
			enrollMember,
			recordRpiTaskCreated,
			recordTrackerConnected,
			recordDesignDocIterated,
			recordDesignDocInboundCommentReceived,
			recordDesignDocInboundCommentResolved,
			recordStructureOutlineCreated,
			recordImplementationStarted,
			recordImplementationComplete,
			recordCommentedOnTeammateDoc,
		}
	}).pipe(Effect.orDie),
)
