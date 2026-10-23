import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'

import { EditorEnvironmentService } from '../src/editor/editor-environment-service'
import { FilesystemService } from '../src/filesystem/filesystem-service'
import { WorkspaceConfigService } from '../src/workspace/workspace-config-service'

export const workspaceFilesystemServicesTestLayer = Layer.mergeAll(
	Layer.succeed(EditorEnvironmentService, EditorEnvironmentService.of({ get: Effect.succeed(null) })),
	Layer.succeed(
		FilesystemService,
		FilesystemService.of({
			getHomeDirectory: Effect.succeed('/Users/test'),
			statPath: () => Effect.succeed({ exists: false, isDirectory: false, isFile: false }),
			readTextFile: () => Effect.succeed(''),
			readFile: () => Effect.succeed(new Uint8Array()),
			browseDirectories: () => Effect.succeed([]),
			listDirectory: () => Effect.succeed([]),
			fuzzySearchFiles: () => Effect.succeed([]),
		}),
	),
	Layer.succeed(
		WorkspaceConfigService,
		WorkspaceConfigService.of({
			read: () => Effect.succeed({ content: null, exists: false }),
			write: () => Effect.void,
			ensureIgnored: () => Effect.void,
			open: () => Effect.void,
		}),
	),
)
