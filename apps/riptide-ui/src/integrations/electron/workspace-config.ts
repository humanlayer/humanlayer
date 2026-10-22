import type { Editor, WorkspaceConfigReadResult, WorkspaceConfigTarget } from '@humanlayer/riptide-electron-rpc'

import { electronClientRuntime } from '@/effects/electron-rpc/electron-client-runtime'
import { ElectronRpcClient } from '@/effects/electron-rpc/electron-rpc-client.service'

export const readWorkspaceConfig = (
	directory: string,
	target: WorkspaceConfigTarget,
): Promise<WorkspaceConfigReadResult> =>
	electronClientRuntime.runPromise(
		ElectronRpcClient.use((client) => client.ReadWorkspaceConfig({ directory, target })),
	)

export const writeWorkspaceConfig = (input: {
	readonly directory: string
	readonly target: WorkspaceConfigTarget
	readonly content: string
}): Promise<void> =>
	electronClientRuntime.runPromise(ElectronRpcClient.use((client) => client.WriteWorkspaceConfig(input)))

export const ensureWorkspaceConfigIgnored = (directory: string): Promise<void> =>
	electronClientRuntime.runPromise(
		ElectronRpcClient.use((client) => client.EnsureWorkspaceConfigIgnored({ directory })),
	)

export const openWorkspaceConfig = (input: {
	readonly directory: string
	readonly target: WorkspaceConfigTarget
	readonly previewContent: string
	readonly editor?: Editor
}): Promise<void> =>
	electronClientRuntime.runPromise(ElectronRpcClient.use((client) => client.OpenWorkspaceConfig(input)))

export const getEditorEnvironment = (): Promise<string | null> =>
	electronClientRuntime.runPromise(ElectronRpcClient.use((client) => client.GetEditorEnvironment()))
