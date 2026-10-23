import type {
	Editor,
	WorkspaceConfigError,
	WorkspaceConfigReadResult,
	WorkspaceConfigTarget,
} from '@humanlayer/riptide-electron-rpc'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import type * as FileSystem from 'effect/FileSystem'
import type * as Path from 'effect/Path'
import type { ChildProcessSpawner } from 'effect/process'

type WorkspaceConfigReadRequirements = FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner

export interface WorkspaceConfigServiceShape {
	readonly read: (input: {
		readonly directory: string
		readonly target: WorkspaceConfigTarget
	}) => Effect.Effect<WorkspaceConfigReadResult, WorkspaceConfigError, WorkspaceConfigReadRequirements>
	readonly write: (input: {
		readonly directory: string
		readonly target: WorkspaceConfigTarget
		readonly content: string
	}) => Effect.Effect<void, WorkspaceConfigError>
	readonly ensureIgnored: (directory: string) => Effect.Effect<void, WorkspaceConfigError>
	readonly open: (input: {
		readonly directory: string
		readonly target: WorkspaceConfigTarget
		readonly previewContent: string
		readonly editor?: Editor
	}) => Effect.Effect<void, WorkspaceConfigError, WorkspaceConfigReadRequirements>
}

export class WorkspaceConfigService extends Context.Service<WorkspaceConfigService, WorkspaceConfigServiceShape>()(
	'WorkspaceConfigService',
) {}
