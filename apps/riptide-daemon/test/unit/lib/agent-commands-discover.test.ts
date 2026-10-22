import * as BunServices from '@effect/platform-bun/BunServices'
import { describe, it } from '@effect/vitest'
import { ConfigProvider, Effect, FileSystem, Layer, Path, type Scope } from 'effect'
import { expect } from 'vitest'

import { discoverAgentCommands, type DiscoverAgentCommandsInput } from '../../../src/lib/agent-commands/discover'

const makeTempDirectory = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem
	return yield* fs.makeTempDirectoryScoped({ prefix: 'agent-commands-' })
})

const writeSkill = Effect.fn(function* (root: string, name: string, contents: string) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	yield* fs.makeDirectory(path.join(root, 'skills', name), { recursive: true })
	yield* fs.writeFileString(path.join(root, 'skills', name, 'SKILL.md'), contents)
})

const writeCommand = Effect.fn(function* (root: string, relativePath: string, contents: string) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const fullPath = path.join(root, 'commands', relativePath)
	yield* fs.makeDirectory(path.dirname(fullPath), { recursive: true })
	yield* fs.writeFileString(fullPath, contents)
})

const discoverWithConfigDirectory = (configDirectory: string, input: DiscoverAgentCommandsInput = {}) =>
	discoverAgentCommands(input).pipe(
		Effect.provide(
			Layer.succeed(
				ConfigProvider.ConfigProvider,
				ConfigProvider.fromUnknown({ CLAUDE_CONFIG_DIR: configDirectory }),
			),
		),
	)

const withPlatform = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path | Scope.Scope>) =>
	effect.pipe(Effect.scoped, Effect.provide(BunServices.layer))

describe('discoverAgentCommands', () => {
	it.effect('names a skill after its frontmatter name', () =>
		withPlatform(
			Effect.gen(function* () {
				const configDir = yield* makeTempDirectory
				yield* writeSkill(
					configDir,
					'my-skill',
					'---\nname: renamed-skill\ndescription: Does a thing\n---\n\nBody',
				)

				const { skills } = yield* discoverWithConfigDirectory(configDir)

				expect(skills).toEqual([{ name: 'renamed-skill', description: 'Does a thing', scope: 'user' }])
			}),
		),
	)

	it.effect('reads a block-scalar description', () =>
		withPlatform(
			Effect.gen(function* () {
				const configDir = yield* makeTempDirectory
				yield* writeSkill(
					configDir,
					'folded',
					'---\ndescription: |\n  First line of the rules.\n  Second line of the rules.\n---\n',
				)

				const { skills } = yield* discoverWithConfigDirectory(configDir)

				expect(skills[0]?.description).toBe('First line of the rules.\nSecond line of the rules.')
			}),
		),
	)

	it.effect('lists a skill with no frontmatter under its directory name', () =>
		withPlatform(
			Effect.gen(function* () {
				const configDir = yield* makeTempDirectory
				yield* writeSkill(configDir, 'bare', 'Just a body, no frontmatter')

				const { skills } = yield* discoverWithConfigDirectory(configDir)

				expect(skills).toEqual([{ name: 'bare', scope: 'user' }])
			}),
		),
	)

	it.effect('skips a skill whose frontmatter is not valid YAML', () =>
		withPlatform(
			Effect.gen(function* () {
				const configDir = yield* makeTempDirectory
				yield* writeSkill(configDir, 'broken', '---\ndescription: [unclosed\n---\n')

				const { skills } = yield* discoverWithConfigDirectory(configDir)

				expect(skills).toEqual([])
			}),
		),
	)

	it.effect('skips a skill marked user-invocable: false', () =>
		withPlatform(
			Effect.gen(function* () {
				const configDir = yield* makeTempDirectory
				yield* writeSkill(configDir, 'hidden', '---\ndescription: Model only\nuser-invocable: false\n---\n')
				yield* writeSkill(configDir, 'shown', '---\ndescription: Visible\nuser-invocable: true\n---\n')

				const { skills } = yield* discoverWithConfigDirectory(configDir)

				expect(skills.map((skill) => skill.name)).toEqual(['shown'])
			}),
		),
	)

	it.effect('maps a command subdirectory onto a : namespace', () =>
		withPlatform(
			Effect.gen(function* () {
				const path = yield* Path.Path
				const configDir = yield* makeTempDirectory
				yield* writeCommand(
					configDir,
					path.join('rpi', 'create-plan.md'),
					'---\ndescription: Write a plan\nargument-hint: <ticket>\n---\n',
				)

				const { commands } = yield* discoverWithConfigDirectory(configDir)

				expect(commands).toEqual([
					{ name: 'rpi:create-plan', description: 'Write a plan', argumentHint: '<ticket>', scope: 'user' },
				])
			}),
		),
	)

	it.effect('lets a user skill win over a same-named project skill', () =>
		withPlatform(
			Effect.gen(function* () {
				const path = yield* Path.Path
				const configDir = yield* makeTempDirectory
				const workspace = yield* makeTempDirectory
				yield* writeSkill(configDir, 'shared', '---\ndescription: From user scope\n---\n')
				yield* writeSkill(path.join(workspace, '.claude'), 'shared', '---\ndescription: From project\n---\n')

				const { skills } = yield* discoverWithConfigDirectory(configDir, { workspacePath: workspace })

				expect(skills).toEqual([{ name: 'shared', description: 'From user scope', scope: 'user' }])
			}),
		),
	)

	it.effect('includes a project skill the user scope does not have', () =>
		withPlatform(
			Effect.gen(function* () {
				const path = yield* Path.Path
				const configDir = yield* makeTempDirectory
				const workspace = yield* makeTempDirectory
				yield* writeSkill(
					path.join(workspace, '.claude'),
					'project-only',
					'---\ndescription: From project\n---\n',
				)

				const { skills } = yield* discoverWithConfigDirectory(configDir, { workspacePath: workspace })

				expect(skills).toEqual([{ name: 'project-only', description: 'From project', scope: 'project' }])
			}),
		),
	)

	it.effect('ignores project scope when no workspace is given', () =>
		withPlatform(
			Effect.gen(function* () {
				const path = yield* Path.Path
				const configDir = yield* makeTempDirectory
				const workspace = yield* makeTempDirectory
				yield* writeSkill(path.join(workspace, '.claude'), 'project-only', '---\ndescription: x\n---\n')

				const { skills } = yield* discoverWithConfigDirectory(configDir)

				expect(skills).toEqual([])
			}),
		),
	)

	it.effect('survives a missing config directory', () =>
		withPlatform(
			Effect.gen(function* () {
				const path = yield* Path.Path
				const missing = path.join(yield* makeTempDirectory, 'does-not-exist')

				const { commands, skills } = yield* discoverWithConfigDirectory(missing)

				expect(skills).toEqual([])
				expect(commands).toEqual([])
			}),
		),
	)

	it.effect('skips a skill directory with no SKILL.md', () =>
		withPlatform(
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem
				const path = yield* Path.Path
				const configDir = yield* makeTempDirectory
				yield* fs.makeDirectory(path.join(configDir, 'skills', 'empty'), { recursive: true })

				const { skills } = yield* discoverWithConfigDirectory(configDir)

				expect(skills).toEqual([])
			}),
		),
	)

	it.effect('falls back to ~/.claude under HOME when CLAUDE_CONFIG_DIR is unset', () =>
		withPlatform(
			Effect.gen(function* () {
				const path = yield* Path.Path
				const home = yield* makeTempDirectory
				yield* writeSkill(path.join(home, '.claude'), 'home-skill', '---\ndescription: At home\n---\n')

				const { skills } = yield* discoverAgentCommands({}).pipe(
					Effect.provide(
						Layer.succeed(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown({ HOME: home })),
					),
				)

				expect(skills.map((skill) => skill.name)).toEqual(['home-skill'])
			}),
		),
	)
})
