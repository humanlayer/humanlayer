import * as BunServices from '@effect/platform-bun/BunServices'
import { describe, it } from '@effect/vitest'
import { ConfigProvider, Effect, FileSystem, Layer, Path, type Scope } from 'effect'
import { expect } from 'vitest'

import { DaemonApi } from '../../../src/effects/services/daemon-api/daemon-api.service'
import { reportDiscoveredWorkspaceCommands } from '../../../src/lib/agent-commands/report'
import { makeMockDaemonApi } from '../../mocks/daemon-api.mock'

type ReportInput = Parameters<(typeof DaemonApi)['Service']['reportAgentCommands']>[0]

const makeTempDirectory = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem
	return yield* fs.makeTempDirectoryScoped({ prefix: 'agent-commands-requested-' })
})

const writeSkill = Effect.fn(function* (claudeRoot: string, name: string) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	yield* fs.makeDirectory(path.join(claudeRoot, 'skills', name), { recursive: true })
	yield* fs.writeFileString(
		path.join(claudeRoot, 'skills', name, 'SKILL.md'),
		`---\nname: ${name}\ndescription: ${name} rules\n---\n`,
	)
})

const reportRequested = (input: { configDirectory: string; workspacePath: string; reports: ReportInput[] }) =>
	reportDiscoveredWorkspaceCommands({ hostId: 'host-1', workspacePath: input.workspacePath }).pipe(
		Effect.provide(
			Layer.mergeAll(
				Layer.succeed(
					DaemonApi,
					makeMockDaemonApi({
						reportAgentCommands: (report) =>
							Effect.sync(() => {
								input.reports.push(report)
								return { updated: true }
							}),
					}),
				),
				Layer.succeed(
					ConfigProvider.ConfigProvider,
					ConfigProvider.fromUnknown({ CLAUDE_CONFIG_DIR: input.configDirectory }),
				),
			),
		),
	)

const withPlatform = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path | Scope.Scope>) =>
	effect.pipe(Effect.scoped, Effect.provide(BunServices.layer))

describe('reportDiscoveredWorkspaceCommands', () => {
	it.effect('reports a directory that has its own skills and keeps the stored commands', () =>
		withPlatform(
			Effect.gen(function* () {
				const path = yield* Path.Path
				const configDirectory = yield* makeTempDirectory
				const workspacePath = yield* makeTempDirectory
				yield* writeSkill(configDirectory, 'user-skill')
				yield* writeSkill(path.join(workspacePath, '.claude'), 'repo-skill')
				const reports: ReportInput[] = []

				yield* reportRequested({ configDirectory, workspacePath, reports })

				expect(reports).toEqual([
					{
						hostId: 'host-1',
						agent: 'claude',
						workspacePath,
						commands: [],
						skills: [
							{ name: 'repo-skill', description: 'repo-skill rules', scope: 'project' },
							{ name: 'user-skill', description: 'user-skill rules', scope: 'user' },
						],
						keepExistingCommands: true,
					},
				])
			}),
		),
	)

	it.effect('skips a directory with no skills or commands of its own', () =>
		withPlatform(
			Effect.gen(function* () {
				const configDirectory = yield* makeTempDirectory
				const workspacePath = yield* makeTempDirectory
				yield* writeSkill(configDirectory, 'user-skill')
				const reports: ReportInput[] = []

				yield* reportRequested({ configDirectory, workspacePath, reports })

				expect(reports).toEqual([])
			}),
		),
	)
})
