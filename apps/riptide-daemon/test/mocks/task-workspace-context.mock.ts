import { Effect, Layer } from 'effect'

import {
	TaskWorkspaceContext,
	type TaskWorkspaceContextService,
} from '@/effects/services/task-workspace-context/task-workspace-context.service'

function unused(method: keyof TaskWorkspaceContextService) {
	return () => Effect.die(`unused TaskWorkspaceContext method: ${method}`)
}

/**
 * A task context service whose reads die unless overridden, so a legacy-task test that
 * unexpectedly reaches the project-workspace path fails loudly instead of silently seeing null.
 */
export function makeMockTaskWorkspaceContext(
	overrides: Partial<TaskWorkspaceContextService> = {},
): TaskWorkspaceContextService {
	return {
		loadTaskWorkspaceContext: unused('loadTaskWorkspaceContext'),
		recentTaskWorkspaceContext: unused('recentTaskWorkspaceContext'),
		...overrides,
	}
}

export function makeMockTaskWorkspaceContextLayer(overrides: Partial<TaskWorkspaceContextService> = {}) {
	return Layer.succeed(TaskWorkspaceContext, makeMockTaskWorkspaceContext(overrides))
}
