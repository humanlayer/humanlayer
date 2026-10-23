import { sessions } from '@humanlayer/db/tables/sessions'
import { tasks } from '@humanlayer/db/tables/tasks'
import { workspaceLocationsForUserForHost } from '@humanlayer/db/tables/workspace-locations-for-user-for-host'
import {
	workspaceRepositoryStatusForUserForHost,
	workspaceRepositoryStatusSelectSchema,
} from '@humanlayer/db/tables/workspace-repository-status-for-user-for-host'
import { workspaces, workspaceSelectSchema } from '@humanlayer/db/tables/workspaces'
import { and, eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { PostgresDb } from '../../../effects/services/postgres/postgres-db.service'
import { Sentry } from '../../../instrument'
import { effectOrpcDaemonBase } from '../../effect-base'

const readSessionWorkspaceSetup = Effect.fn('project_workspace.read_session_workspace_setup')(function* (input: {
	readonly sessionId: string
	readonly workspaceId: string
	readonly organizationId: string
	readonly userId: string
	readonly hostId: string
}) {
	const postgres = yield* PostgresDb
	// One statement keeps the snapshot, setup generation, and progress mutually consistent.
	return yield* postgres.query(
		postgres.client
			.select({
				sessionStatus: sessions.status,
				workspace: workspaces,
				location: workspaceLocationsForUserForHost,
				status: workspaceRepositoryStatusForUserForHost,
			})
			.from(sessions)
			.innerJoin(tasks, and(eq(tasks.id, sessions.task_id), eq(tasks.organization_id, sessions.organization_id)))
			.innerJoin(
				workspaces,
				and(eq(workspaces.id, tasks.workspace_id), eq(workspaces.organization_id, tasks.organization_id)),
			)
			.innerJoin(
				workspaceLocationsForUserForHost,
				and(
					eq(workspaceLocationsForUserForHost.organization_id, workspaces.organization_id),
					eq(workspaceLocationsForUserForHost.project_id, workspaces.project_id),
					eq(workspaceLocationsForUserForHost.workspace_id, workspaces.id),
					eq(workspaceLocationsForUserForHost.user_id, input.userId),
					eq(workspaceLocationsForUserForHost.host_id, input.hostId),
				),
			)
			.leftJoin(
				workspaceRepositoryStatusForUserForHost,
				and(
					eq(workspaceRepositoryStatusForUserForHost.organization_id, workspaces.organization_id),
					eq(workspaceRepositoryStatusForUserForHost.project_id, workspaces.project_id),
					eq(workspaceRepositoryStatusForUserForHost.workspace_id, workspaces.id),
					eq(workspaceRepositoryStatusForUserForHost.user_id, input.userId),
					eq(workspaceRepositoryStatusForUserForHost.host_id, input.hostId),
				),
			)
			.where(
				and(
					eq(sessions.id, input.sessionId),
					eq(sessions.organization_id, input.organizationId),
					// The daemon tuple that owns the launch is the session creator on this host. Task and
					// workspace owners may be other collaborators; the location join above already scopes
					// materialization to the calling user and host, so their ownership is not required.
					eq(sessions.created_by, input.userId),
					eq(sessions.host_id, input.hostId),
					eq(workspaces.id, input.workspaceId),
				),
			),
	)
})

export const getSessionWorkspaceSetupProcedure = effectOrpcDaemonBase.projectWorkspaces.getSessionWorkspaceSetup.effect(
	function* ({ input, context, errors }) {
		const rows = yield* readSessionWorkspaceSetup({
			...input,
			organizationId: context.auth.organizationId,
			userId: context.auth.userId,
			hostId: context.auth.hostId,
		}).pipe(
			Effect.tapError(Effect.logError),
			Effect.tapError((error) => Effect.sync(() => Sentry.captureException(error))),
			Effect.catchTag('PostgresDbQueryError', () => Effect.fail(errors.INTERNAL_SERVER_ERROR())),
		)
		const first = rows[0]
		if (!first) return yield* Effect.fail(errors.NOT_FOUND())

		const parsed = workspaceSelectSchema.safeParse(first.workspace)
		if (!parsed.success) {
			yield* Effect.logError(parsed.error)
			yield* Effect.sync(() => Sentry.captureException(parsed.error))
			return yield* Effect.fail(errors.INTERNAL_SERVER_ERROR())
		}
		const workspace = parsed.data
		const statuses = yield* Effect.forEach(
			rows.flatMap((row) => (row.status === null ? [] : [row.status])),
			(row) =>
				Effect.gen(function* () {
					const parsedStatus = workspaceRepositoryStatusSelectSchema.safeParse(row)
					if (!parsedStatus.success) {
						yield* Effect.logError(parsedStatus.error)
						yield* Effect.sync(() => Sentry.captureException(parsedStatus.error))
						return yield* Effect.fail(errors.INTERNAL_SERVER_ERROR())
					}
					return parsedStatus.data
				}),
		)
		const location = first.location
		const currentStatuses = statuses.filter((status) => status.generation === location.setup_generation)
		const statusesByIdentity = new Map(currentStatuses.map((status) => [status.repository_identity, status]))
		const defaultRepository = workspace.repositories.find((repository) => repository.default)
		const defaultMaterialization =
			defaultRepository === undefined
				? null
				: statusesByIdentity.get(defaultRepository.repositoryIdentity)?.materialization
		const defaultWorkingDirectory = defaultMaterialization?.path ?? location.file_path
		if (defaultWorkingDirectory.trim().length === 0) {
			const error = new Error('Session workspace setup has an empty default working directory')
			yield* Effect.logError(error)
			yield* Effect.sync(() => Sentry.captureException(error))
			return yield* Effect.fail(errors.INTERNAL_SERVER_ERROR())
		}

		return {
			workspaceId: input.workspaceId,
			sessionStatus: first.sessionStatus,
			defaultWorkingDirectory,
			ready:
				!workspace.archived &&
				location.setup_generation > 0n &&
				statuses.length === workspace.repositories.length &&
				statusesByIdentity.size === workspace.repositories.length &&
				workspace.repositories.every((repository) => {
					const status = statusesByIdentity.get(repository.repositoryIdentity)
					return (
						status !== undefined &&
						// Post-materialization work and its failures must not delay session launch.
						(status.error === null ||
							status.error.stage === 'publishing_branch' ||
							status.error.stage === 'copying_files' ||
							status.error.stage === 'running_setup_command' ||
							status.error.stage === 'done') &&
						status.materialization !== null &&
						status.materialization.path.trim().length > 0
					)
				}),
			repositories: workspace.repositories.map((repository) => {
				const status = statusesByIdentity.get(repository.repositoryIdentity)
				return {
					repositoryIdentity: repository.repositoryIdentity,
					status: status?.status ?? 'setup_requested',
					default: repository.default,
					worktreePath: status?.materialization?.path ?? null,
				}
			}),
		}
	},
)
