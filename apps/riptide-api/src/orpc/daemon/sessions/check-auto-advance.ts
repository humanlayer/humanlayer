import { artifacts } from '@humanlayer/db/tables/artifacts'
import { sessions } from '@humanlayer/db/tables/sessions'
import { taskUserSettings } from '@humanlayer/db/tables/task-user-settings'
import { tasks } from '@humanlayer/db/tables/tasks'
import { userSettings } from '@humanlayer/db/tables/user-settings'
import type { TaskWorkflowType, WorktreeTiming } from '@humanlayer/schemas/effect/taskconfiguration'
import { and, eq, gt, not, sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { Effect } from 'effect'

import { createSessionForLaunch } from '../../../db/create-session-for-launch'
import type { AppRuntime } from '../../../effects/app-runtime'
import { OnboardingService } from '../../../effects/services/onboarding/onboarding.service'
import { Sentry } from '../../../instrument'
import logger from '../../../logger'

interface AutoAdvanceTransition {
	taskFlag:
		| 'auto_advance_questions_to_research'
		| 'auto_advance_research_to_design'
		| 'auto_advance_plan_to_worktree'
		| 'auto_advance_worktree_to_implementation'
		| 'auto_advance_implementation_to_pr'
	label: string
	artifactFrontmatterType?: string
	dedupLabel: string
	launchTitle: string
	launchLabel: string
	launchLabelTitle: string
	skill: string
	promptSuffix?: string
}

const transitions: AutoAdvanceTransition[] = [
	{
		taskFlag: 'auto_advance_questions_to_research',
		label: 'rpi:research-questions',
		artifactFrontmatterType: 'research-questions',
		dedupLabel: 'rpi:research',
		launchTitle: 'Research',
		launchLabel: 'rpi:research',
		launchLabelTitle: 'research',
		skill: 'rpi:create-research',
	},
	{
		taskFlag: 'auto_advance_research_to_design',
		label: 'rpi:research',
		artifactFrontmatterType: 'research',
		dedupLabel: 'rpi:design',
		launchTitle: 'Design Discussion',
		launchLabel: 'rpi:design',
		launchLabelTitle: 'design',
		skill: 'rpi:create-design-discussion',
	},
	{
		taskFlag: 'auto_advance_plan_to_worktree',
		label: 'rpi:plan',
		dedupLabel: 'rpi:worktree-setup',
		launchTitle: 'Worktree Setup',
		launchLabel: 'rpi:worktree-setup',
		launchLabelTitle: 'worktree-setup',
		skill: 'rpi:setup-worktree',
		promptSuffix:
			'- just perform the task without checking with the user or confirming paths, use your best judgement',
	},
	{
		taskFlag: 'auto_advance_worktree_to_implementation',
		label: 'rpi:worktree-setup',
		dedupLabel: 'rpi:implementation',
		launchTitle: 'Implementation',
		launchLabel: 'rpi:implementation',
		launchLabelTitle: 'implementation',
		skill: 'rpi:implement-plan',
		promptSuffix: '- implement all phases consecutively without pausing between phases, commit after each phase',
	},
	{
		taskFlag: 'auto_advance_implementation_to_pr',
		label: 'rpi:implementation',
		dedupLabel: 'rpi:describe-pr',
		launchTitle: 'Describe PR',
		launchLabel: 'rpi:describe-pr',
		launchLabelTitle: 'describe-pr',
		skill: 'rpi:describe-pr',
	},
]

const PLAN_TO_IMPLEMENTATION_TRANSITION_OVERRIDE = {
	dedupLabel: 'rpi:implementation',
	launchTitle: 'Implementation',
	launchLabel: 'rpi:implementation',
	launchLabelTitle: 'implementation',
	skill: 'rpi:implement-plan',
	promptSuffix: '- implement all phases consecutively without pausing between phases, commit after each phase',
} satisfies Partial<AutoAdvanceTransition>

const RESEARCH_TO_PRD_TRANSITION_OVERRIDE = {
	dedupLabel: 'rpi:design-prd',
	launchTitle: 'Product Requirements Doc',
	launchLabel: 'rpi:design-prd',
	launchLabelTitle: 'design-prd',
	skill: 'rpi:create-prd',
} satisfies Partial<AutoAdvanceTransition>

function maybeOverrideAutoAdvanceTransitionFromTaskWorktreeTiming(
	transition: AutoAdvanceTransition,
	worktreeTiming: WorktreeTiming | null,
): AutoAdvanceTransition {
	// Product semantics for the persisted plan flag are "auto-advance after plan".
	// The DB column keeps its historical plan-to-worktree name, but tasks that
	// create worktrees upfront or never create them should continue directly to implementation.
	const isPlanToWorktreeTransition = transition.taskFlag === 'auto_advance_plan_to_worktree'
	const shouldSkipDeferredWorktree = worktreeTiming === 'now' || worktreeTiming === 'never'

	if (!isPlanToWorktreeTransition || !shouldSkipDeferredWorktree) {
		return transition
	}

	return {
		...transition,
		...PLAN_TO_IMPLEMENTATION_TRANSITION_OVERRIDE,
	}
}

function maybeOverrideAutoAdvanceTransitionFromTaskWorkflowType(
	transition: AutoAdvanceTransition,
	workflowType: TaskWorkflowType | null,
): AutoAdvanceTransition {
	const isResearchToDesignTransition = transition.taskFlag === 'auto_advance_research_to_design'
	const shouldRouteResearchToPrd = workflowType === 'prd_tdd'

	if (!isResearchToDesignTransition || !shouldRouteResearchToPrd) {
		return transition
	}

	return {
		...transition,
		...RESEARCH_TO_PRD_TRANSITION_OVERRIDE,
	}
}

/**
 * Check if a session should auto-advance to the next phase.
 * Fires as a fire-and-forget after session transitions to ready_for_input.
 *
 * Iterates a config-driven transition table. For each transition, checks:
 * 1. Task has the transition's flag enabled (per-user override wins, falls back to task-level)
 * 2. Session has the matching label
 * 3. Completion detection — either artifact-based (artifactFrontmatterType set) or extraction-based
 *    (reads next_step_suggestions with a next_step_found entry; captures suggestedDirectory)
 * 4. No session with the dedup label already exists for this task
 *
 * First match wins (a session only has one RPI label).
 */
export async function checkAutoAdvance(
	db: PostgresJsDatabase,
	sessionId: string,
	organizationId: string,
	effectRuntime?: AppRuntime,
) {
	try {
		// Load session with task join — select both auto-advance flags.
		// Also LEFT JOIN task_user_settings for the session creator to resolve per-user overrides.
		const [session] = await db
			.select({
				id: sessions.id,
				task_id: sessions.task_id,
				labels: sessions.labels,
				created_at: sessions.created_at,
				archived: sessions.archived,
				working_directory: sessions.working_directory,
				host_id: sessions.host_id,
				permissions_mode: sessions.permissions_mode,
				model: sessions.model,
				effort: sessions.effort,
				fast_mode: sessions.fast_mode,
				provider: sessions.provider,
				coding_agent: sessions.coding_agent,
				resource_owner_user_id: sessions.resource_owner_user_id,
				created_by: sessions.created_by,
				task_auto_advance_questions: tasks.auto_advance_questions_to_research,
				task_auto_advance_research: tasks.auto_advance_research_to_design,
				task_auto_advance_plan_to_worktree: tasks.auto_advance_plan_to_worktree,
				task_auto_advance_worktree_to_impl: tasks.auto_advance_worktree_to_implementation,
				task_auto_advance_impl_to_pr: tasks.auto_advance_implementation_to_pr,
				task_workflow_type: tasks.workflow_type,
				task_worktree_timing: tasks.worktree_timing,
				user_auto_advance_questions: taskUserSettings.auto_advance_questions_to_research,
				user_auto_advance_research: taskUserSettings.auto_advance_research_to_design,
				user_auto_advance_plan_to_worktree: taskUserSettings.auto_advance_plan_to_worktree,
				user_auto_advance_worktree_to_impl: taskUserSettings.auto_advance_worktree_to_implementation,
				user_auto_advance_impl_to_pr: taskUserSettings.auto_advance_implementation_to_pr,
				task_slug: tasks.slug,
				task_name: tasks.name,
				user_default_model: userSettings.default_model,
			})
			.from(sessions)
			.leftJoin(tasks, eq(sessions.task_id, tasks.id))
			.leftJoin(
				taskUserSettings,
				and(
					eq(taskUserSettings.task_id, sessions.task_id),
					eq(taskUserSettings.user_id, sessions.created_by),
					eq(taskUserSettings.organization_id, organizationId),
				),
			)
			.leftJoin(
				userSettings,
				and(eq(userSettings.user_id, sessions.created_by), eq(userSettings.organization_id, organizationId)),
			)
			.where(and(eq(sessions.id, sessionId), eq(sessions.organization_id, organizationId)))
			.limit(1)

		if (!session || !session.task_id) {
			logger.debug({ sessionId }, 'Auto-advance: skipped — no session or no task_id')
			return
		}

		// Drizzle double-serializes JSONB, so labels may come back as a JSON string
		const rawLabels = session.labels ?? []
		const labels = (typeof rawLabels === 'string' ? JSON.parse(rawLabels) : rawLabels) as Array<{
			name: string
			title: string
		}>

		// Resolve effective auto-advance flags owner-aware, mirroring the UI's
		// useTaskSettings semantics so the backend read can't drift from what the
		// owner's toggle displays:
		//   - owner (creator === resource owner) → read the task-level flag and
		//     ignore the creator's own (incidental) task_user_settings row. Owner
		//     TUS auto-advance values are seeded with schema defaults by the
		//     create-time workspace-materialization insert and must not shadow the
		//     owner's actual task-level choices (CORE-1489).
		//   - non-owner → per-user override ?? task-level flag, so collaborators'
		//     overrides still win. A missing TUS row LEFT JOINs to null and falls
		//     through to the task-level flag.
		const isOwner = session.created_by === session.resource_owner_user_id
		const resolveFlag = (userVal: boolean | null, taskVal: boolean | null) =>
			isOwner ? taskVal : (userVal ?? taskVal)

		const taskFlags: Record<AutoAdvanceTransition['taskFlag'], boolean | null> = {
			auto_advance_questions_to_research: resolveFlag(
				session.user_auto_advance_questions,
				session.task_auto_advance_questions,
			),
			auto_advance_research_to_design: resolveFlag(
				session.user_auto_advance_research,
				session.task_auto_advance_research,
			),
			auto_advance_plan_to_worktree: resolveFlag(
				session.user_auto_advance_plan_to_worktree,
				session.task_auto_advance_plan_to_worktree,
			),
			auto_advance_worktree_to_implementation: resolveFlag(
				session.user_auto_advance_worktree_to_impl,
				session.task_auto_advance_worktree_to_impl,
			),
			auto_advance_implementation_to_pr: resolveFlag(
				session.user_auto_advance_impl_to_pr,
				session.task_auto_advance_impl_to_pr,
			),
		}

		for (const baseTransition of transitions) {
			const workflowTransition = maybeOverrideAutoAdvanceTransitionFromTaskWorkflowType(
				baseTransition,
				session.task_workflow_type,
			)
			const transition = maybeOverrideAutoAdvanceTransitionFromTaskWorktreeTiming(
				workflowTransition,
				session.task_worktree_timing,
			)

			// Condition 1: Task has auto-advance flag enabled for this transition
			if (!taskFlags[transition.taskFlag]) {
				continue
			}

			// Condition 2: Session has the matching label
			if (!labels.some((l) => l.name === transition.label)) {
				continue
			}

			logger.debug(
				{ sessionId, taskId: session.task_id, transition: transition.taskFlag },
				'Auto-advance: matched transition, checking artifact and dedup',
			)

			// Condition 3: Completion detection — artifact-based or extraction-based
			let suggestedDirectory: string | undefined

			if (transition.artifactFrontmatterType) {
				// Artifact-based: Task has an artifact with matching frontmatter type
				// Drizzle double-serializes JSONB, so frontmatter is stored as a JSON string.
				// Unwrap with #>> '{}' to get the inner text, cast back to jsonb, then extract 'type'.
				const [artifact] = await db
					.select({ id: artifacts.id })
					.from(artifacts)
					.where(
						and(
							eq(artifacts.task_id, session.task_id),
							eq(
								sql`(${artifacts.frontmatter} #>> '{}')::jsonb ->> 'type'`,
								transition.artifactFrontmatterType,
							),
						),
					)
					.limit(1)

				if (!artifact) {
					logger.debug(
						{ sessionId, taskId: session.task_id, type: transition.artifactFrontmatterType },
						'Auto-advance: skipped — no artifact with matching frontmatter type',
					)
					continue
				}
			} else {
				// Extraction-based: Session has next_step_suggestions with a next_step_found entry
				const [currentSession] = await db
					.select({ next_step_suggestions: sessions.next_step_suggestions })
					.from(sessions)
					.where(eq(sessions.id, sessionId))
					.limit(1)

				const nextStepSuggestions = currentSession?.next_step_suggestions
				const rawSuggestions = (
					typeof nextStepSuggestions === 'string' ? JSON.parse(nextStepSuggestions) : nextStepSuggestions
				) as Array<{ extraction?: { type: string; suggestedDirectory?: string } }> | null

				const nextStepEntry = rawSuggestions?.find((s) => s.extraction?.type === 'next_step_found')

				if (!nextStepEntry) {
					logger.debug(
						{ sessionId, taskId: session.task_id },
						'Auto-advance: skipped — no next_step_found in extraction results',
					)
					continue
				}

				// Extract suggestedDirectory for cross-worktree handoff
				suggestedDirectory = nextStepEntry.extraction?.suggestedDirectory
			}

			// Condition 4: No session with the target label already exists (deduplication)
			// Drizzle double-serializes JSONB, so we fetch sessions and deserialize labels in JS.
			// Mirror the frontend's useExistingSessionForNextStep filter: only siblings created
			// *after* the source session and not archived count as blocking, so a rewound (newer)
			// source can still auto-advance past an older labeled sibling.
			const siblingRows = await db
				.select({ id: sessions.id, labels: sessions.labels })
				.from(sessions)
				.where(
					and(
						eq(sessions.task_id, session.task_id),
						eq(sessions.organization_id, organizationId),
						not(eq(sessions.archived, true)),
						gt(sessions.created_at, session.created_at),
					),
				)

			const hasDedupLabel = siblingRows.some((row) => {
				const rawLabels = row.labels ?? []
				const parsed = (typeof rawLabels === 'string' ? JSON.parse(rawLabels) : rawLabels) as Array<{
					name: string
				}>
				return parsed.some((l) => l.name === transition.dedupLabel)
			})

			if (hasDedupLabel) {
				logger.debug(
					{ sessionId, taskId: session.task_id, dedupLabel: transition.dedupLabel },
					'Auto-advance: skipped — session with dedup label already exists',
				)
				continue
			}

			// All conditions met — auto-launch next phase session
			const taskSlug = session.task_slug || session.task_name
			let prompt = `use the ${transition.skill} skill for .humanlayer/tasks/${taskSlug}`
			if (transition.promptSuffix) prompt += ` ${transition.promptSuffix}`

			logger.info(
				{ sessionId, taskId: session.task_id, taskSlug, transition: transition.taskFlag },
				`Auto-advancing: ${transition.label} → ${transition.launchTitle}`,
			)
			const currentTaskId = session.task_id

			const lockedSourceSession = await db.transaction(async (tx) => {
				await tx
					.select({ id: tasks.id })
					.from(tasks)
					.where(and(eq(tasks.id, currentTaskId), eq(tasks.organization_id, organizationId)))
					.limit(1)
					.for('no key update')

				const [currentSession] = await tx
					.select({
						task_id: sessions.task_id,
						resource_owner_user_id: sessions.resource_owner_user_id,
						created_by: sessions.created_by,
						working_directory: sessions.working_directory,
						host_id: sessions.host_id,
						coding_agent: sessions.coding_agent,
						provider: sessions.provider,
						model: sessions.model,
						effort: sessions.effort,
						fast_mode: sessions.fast_mode,
						permissions_mode: sessions.permissions_mode,
					})
					.from(sessions)
					.where(and(eq(sessions.id, sessionId), eq(sessions.organization_id, organizationId)))
					.limit(1)
					.for('no key update')

				if (!currentSession || currentSession.task_id !== currentTaskId) return null

				await createSessionForLaunch(tx, {
					taskId: currentSession.task_id,
					organizationId,
					resourceOwnerUserId: currentSession.resource_owner_user_id,
					createdBy: currentSession.created_by,
					title: session.task_name
						? `${transition.launchLabelTitle}: ${session.task_name}`
						: transition.launchLabelTitle,
					prompt,
					workingDirectory: suggestedDirectory || currentSession.working_directory,
					hostId: currentSession.host_id,
					codingAgent: currentSession.coding_agent ?? 'claude',
					provider: currentSession.provider ?? 'anthropic',
					model: currentSession.model ?? session.user_default_model ?? 'opus',
					effort: currentSession.effort ?? undefined,
					fastMode: currentSession.fast_mode ?? undefined,
					permissionsMode: currentSession.permissions_mode ?? 'default',
					labels: [{ name: transition.launchLabel, title: transition.launchLabelTitle }],
				})
				return currentSession
			})

			if (!lockedSourceSession) {
				logger.debug({ sessionId }, 'Auto-advance: skipped because the source session moved tasks')
				return
			}

			// Fire-and-forget onboarding "implementation started" milestone when
			// auto-advance launches an implementation session. The service no-ops for
			// any other label. effectRuntime is optional so existing callers/tests that
			// don't wire it keep working; failures are swallowed to Sentry.
			if (effectRuntime && transition.launchLabel === 'rpi:implementation') {
				const onboardingSource = 'daemon.sessions.check-auto-advance'
				effectRuntime.runFork(
					Effect.gen(function* () {
						const onboarding = yield* OnboardingService
						yield* onboarding.recordImplementationStarted({
							userId: lockedSourceSession.resource_owner_user_id,
							sessionId,
							taskId: session.task_id,
							label: { name: transition.launchLabel, title: transition.launchLabelTitle },
							source: 'auto_advance',
						})
					}).pipe(
						Effect.catch((err) =>
							Effect.sync(() => {
								Sentry.captureException(err, {
									tags: { error_type: 'onboarding_detached_failure', source: onboardingSource },
									extra: {
										userId: lockedSourceSession.resource_owner_user_id,
										sessionId,
										source: onboardingSource,
									},
								})
							}),
						),
					),
				)
			}

			// Update task default_working_directory to match the worktree path
			// so future manual sessions default to the new directory
			if (suggestedDirectory && session.task_id) {
				await db
					.update(tasks)
					.set({ default_working_directory: suggestedDirectory })
					.where(eq(tasks.id, session.task_id))
			}

			// Disable the auto-advance flag for this transition so it does not silently
			// re-fire on future rewinds and so the toggle visibly turns off for the creator.
			// Mirror the UI's owner-vs-override write semantics (useTaskSettings):
			//   - owner → flip the task-level flag
			//   - non-owner with an existing override row → flip that row's flag
			//   - non-owner without a row → insert an override copying the resolved flags
			// Best-effort: a failure here must never undo or mask the successful creation.
			try {
				if (isOwner) {
					await db
						.update(tasks)
						.set({ [transition.taskFlag]: false })
						.where(eq(tasks.id, session.task_id))
				} else {
					// A task_user_settings row exists for the creator iff the LEFT JOIN
					// returned a non-null per-user flag (all columns are NOT NULL).
					const hasUserSettingsRow =
						session.user_auto_advance_questions !== null ||
						session.user_auto_advance_research !== null ||
						session.user_auto_advance_plan_to_worktree !== null ||
						session.user_auto_advance_worktree_to_impl !== null ||
						session.user_auto_advance_impl_to_pr !== null

					if (hasUserSettingsRow) {
						await db
							.update(taskUserSettings)
							.set({ [transition.taskFlag]: false })
							.where(
								and(
									eq(taskUserSettings.task_id, session.task_id),
									eq(taskUserSettings.user_id, session.created_by),
									eq(taskUserSettings.organization_id, organizationId),
								),
							)
					} else {
						// Insert a new override copying the current resolved flags, with
						// this transition's flag forced to false.
						await db.insert(taskUserSettings).values({
							task_id: session.task_id,
							user_id: session.created_by,
							organization_id: organizationId,
							auto_advance_questions_to_research:
								transition.taskFlag === 'auto_advance_questions_to_research'
									? false
									: (taskFlags.auto_advance_questions_to_research ?? false),
							auto_advance_research_to_design:
								transition.taskFlag === 'auto_advance_research_to_design'
									? false
									: (taskFlags.auto_advance_research_to_design ?? false),
							auto_advance_plan_to_worktree:
								transition.taskFlag === 'auto_advance_plan_to_worktree'
									? false
									: (taskFlags.auto_advance_plan_to_worktree ?? false),
							auto_advance_worktree_to_implementation:
								transition.taskFlag === 'auto_advance_worktree_to_implementation'
									? false
									: (taskFlags.auto_advance_worktree_to_implementation ?? false),
							auto_advance_implementation_to_pr:
								transition.taskFlag === 'auto_advance_implementation_to_pr'
									? false
									: (taskFlags.auto_advance_implementation_to_pr ?? false),
						})
					}
				}
			} catch (err) {
				logger.warn(
					{ err, sessionId, taskFlag: transition.taskFlag },
					'Auto-advance: failed to disable flag after creation',
				)
				Sentry.captureException(err, {
					tags: { error_type: 'auto_advance_disable_flag' },
					extra: { sessionId, taskFlag: transition.taskFlag },
				})
			}

			logger.info(
				{ sessionId, taskId: session.task_id },
				`Auto-advance: ${transition.launchTitle} session created successfully`,
			)
			return // First match wins
		}

		logger.debug({ sessionId }, 'Auto-advance: no matching transition found')
	} catch (err) {
		logger.error({ err, sessionId }, 'Auto-advance check failed')
		Sentry.captureException(err, {
			tags: { error_type: 'auto_advance' },
			extra: { sessionId },
		})
	}
}
