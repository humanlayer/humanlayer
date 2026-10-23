import { Context, Effect } from 'effect'

import type { PostgresDb } from '../postgres/postgres-db.service'
import type { SessionTitleGeneration } from '../session-title-generation/session-title-generation.service'
import type { TaskIntentClassifier } from '../task-intent-classifier/task-intent-classifier.service'
import type { TaskLaunchConflict, TaskLaunchForbidden, TaskLaunchUnavailable } from './task-launch.errors'
import type { LaunchTaskDraftInput, LaunchTaskDraftResult } from './task-launch.types'

export interface TaskLaunchServiceShape {
	readonly launchTaskDraft: (
		input: LaunchTaskDraftInput,
	) => Effect.Effect<
		LaunchTaskDraftResult,
		TaskLaunchConflict | TaskLaunchForbidden | TaskLaunchUnavailable,
		PostgresDb | TaskIntentClassifier | SessionTitleGeneration
	>
}

export class TaskLaunchService extends Context.Service<TaskLaunchService, TaskLaunchServiceShape>()(
	'TaskLaunchService',
) {}
