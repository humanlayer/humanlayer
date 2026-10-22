import {
	WorkspaceRepositoryActorSnapshot,
	WorkspaceRepositorySetupError,
} from '@humanlayer/schemas/effect/project-workspace'
import * as Schema from 'effect/Schema'

export class ProjectsV2Disabled extends Schema.TaggedError<ProjectsV2Disabled>()('ProjectsV2Disabled', {}) {}
export class ProjectNotFound extends Schema.TaggedError<ProjectNotFound>()('ProjectNotFound', {
	projectId: Schema.String,
}) {}
export class ProjectMutationForbidden extends Schema.TaggedError<ProjectMutationForbidden>()(
	'ProjectMutationForbidden',
	{ projectId: Schema.String },
) {}
export class ProjectLocationInvalid extends Schema.TaggedError<ProjectLocationInvalid>()('ProjectLocationInvalid', {
	message: Schema.String,
}) {}
export class ProjectPersistenceUnavailable extends Schema.TaggedError<ProjectPersistenceUnavailable>()(
	'ProjectPersistenceUnavailable',
	{ operation: Schema.String },
) {}
export class RepositorySourcesRequired extends Schema.TaggedError<RepositorySourcesRequired>()(
	'RepositorySourcesRequired',
	{
		projectId: Schema.String,
		workspaceId: Schema.String,
		hostId: Schema.String,
		missingRepositoryIdentities: Schema.Array(Schema.String),
	},
) {}
export class RepositorySourcesInvalid extends Schema.TaggedError<RepositorySourcesInvalid>()(
	'RepositorySourcesInvalid',
	{ message: Schema.String },
) {}
export class WorkspaceRepositoryStatusChanged extends Schema.TaggedError<WorkspaceRepositoryStatusChanged>()(
	'WorkspaceRepositoryStatusChanged',
	{ snapshot: WorkspaceRepositoryActorSnapshot },
) {}
export class WorkspaceRepositoryStageFailed extends Schema.TaggedError<WorkspaceRepositoryStageFailed>()(
	'WorkspaceRepositoryStageFailed',
	{ error: WorkspaceRepositorySetupError },
) {}
export class WorkspaceRepositoryProgressInvalid extends Schema.TaggedError<WorkspaceRepositoryProgressInvalid>()(
	'WorkspaceRepositoryProgressInvalid',
	{ message: Schema.String },
) {}
export class UnsupportedRecipeProfile extends Schema.TaggedError<UnsupportedRecipeProfile>()(
	'UnsupportedRecipeProfile',
	{ message: Schema.String },
) {}
export class WorkspaceRepositorySkipNotAllowed extends Schema.TaggedError<WorkspaceRepositorySkipNotAllowed>()(
	'WorkspaceRepositorySkipNotAllowed',
	{ message: Schema.String },
) {}
export class WorkspaceRepositoryNothingToRetry extends Schema.TaggedError<WorkspaceRepositoryNothingToRetry>()(
	'WorkspaceRepositoryNothingToRetry',
	{ snapshot: WorkspaceRepositoryActorSnapshot },
) {}
export class WorkspaceRepositorySourceRecoveryNotAllowed extends Schema.TaggedError<WorkspaceRepositorySourceRecoveryNotAllowed>()(
	'WorkspaceRepositorySourceRecoveryNotAllowed',
	{ message: Schema.String },
) {}
