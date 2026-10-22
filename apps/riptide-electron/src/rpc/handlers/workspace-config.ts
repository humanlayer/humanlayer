import type { Editor, WorkspaceConfigTarget } from '@humanlayer/riptide-electron-rpc'
import * as Effect from 'effect/Effect'

import { WorkspaceConfigService } from '../../workspace/workspace-config-service'

export const readWorkspaceConfigHandler = Effect.fn('rpc.read_workspace_config')(function* (input: {
	readonly directory: string
	readonly target: WorkspaceConfigTarget
}) {
	return yield* (yield* WorkspaceConfigService).read(input)
})

export const writeWorkspaceConfigHandler = Effect.fn('rpc.write_workspace_config')(function* (input: {
	readonly directory: string
	readonly target: WorkspaceConfigTarget
	readonly content: string
}) {
	return yield* (yield* WorkspaceConfigService).write(input)
})

export const ensureWorkspaceConfigIgnoredHandler = Effect.fn('rpc.ensure_workspace_config_ignored')(function* (input: {
	readonly directory: string
}) {
	return yield* (yield* WorkspaceConfigService).ensureIgnored(input.directory)
})

export const openWorkspaceConfigHandler = Effect.fn('rpc.open_workspace_config')(function* (input: {
	readonly directory: string
	readonly target: WorkspaceConfigTarget
	readonly previewContent: string
	readonly editor?: Editor
}) {
	return yield* (yield* WorkspaceConfigService).open(input)
})
