import { join } from 'node:path'

import { layerCodingToolServices, toolOutputRootFor, type OutputStore, type Photon } from '@humanlayer/fold-agent'
import type { FileSystem, Path } from 'effect'
import type { HttpClient } from 'effect/http'
import type { ChildProcessSpawner } from 'effect/process'

/** Host services Fold models and coding tools require; the opener provides them once per session. */
export type FoldHostServices =
	| FileSystem.FileSystem
	| Path.Path
	| ChildProcessSpawner.ChildProcessSpawner
	| OutputStore
	| Photon
	| HttpClient.HttpClient

/** Fold's Node host services, spilling tool output under Fold's output root in one directory per session. */
export const layerFoldHostServices = (sessionId: string) =>
	layerCodingToolServices({ outputDirectory: join(toolOutputRootFor(), sessionId) })
