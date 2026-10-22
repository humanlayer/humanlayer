import {
	skillSource,
	skillTool,
	SkillNotFoundError,
	type Skill,
	type SkillMeta,
	type SkillSourceService,
} from '@humanlayer/fold-core'
import { Effect, Path } from 'effect'

import { discoverCodexSkills } from '@/agents/codelayer/codex-skill-discovery'

import {
	materializeHumanlayerPlugin,
	materializeRpiPlugin,
} from '../claude-sessions/claude-session-preparation-adapters'
import { makeGrokSkillSource } from './fold-grok-skill-discovery'
import type { FoldSessionProvider } from './fold-sessions.schemas'

const skillSourceFromCatalog = (skills: ReadonlyArray<Skill>): SkillSourceService => {
	const byName = new Map(skills.map((skill) => [skill.name, skill]))
	return {
		list: Effect.succeed([...byName.values()].map(({ name, description }): SkillMeta => ({ name, description }))),
		load: (name) => {
			const skill = byName.get(name)
			return skill === undefined
				? Effect.fail(new SkillNotFoundError({ name, availableSkills: [...byName.keys()] }))
				: Effect.succeed(skill)
		},
	}
}

export const makeFoldSkillTool = Effect.fn('fold.skills.compose')(function* (input: {
	readonly sessionId: string
	readonly provider: FoldSessionProvider
	readonly workingDirectory: string
	readonly projectRoot: string
	readonly configuredRepositoryRoots: ReadonlyArray<string>
	readonly homeDirectory: string
	readonly codexHome?: string
	readonly grokHome?: string
	readonly rpiPluginPath?: string
	readonly humanlayerPluginPath?: string
}) {
	const path = yield* Path.Path
	const rpiPluginPath = input.rpiPluginPath ?? (yield* materializeRpiPlugin())
	const humanlayerPluginPath = input.humanlayerPluginPath ?? (yield* materializeHumanlayerPlugin())
	if (input.provider === 'xai') {
		const grokHome = input.grokHome ?? path.join(input.homeDirectory, '.grok')
		const source = yield* makeGrokSkillSource({
			cwd: input.workingDirectory,
			home: input.homeDirectory,
			grokHome,
			projectRoot: input.projectRoot,
			configuredRepositoryRoots: input.configuredRepositoryRoots,
			bundledPaths: [
				{ name: 'rpi', path: path.join(rpiPluginPath, 'skills') },
				{ name: 'hl', path: path.join(humanlayerPluginPath, 'skills') },
			],
		})
		const skills = yield* source.list
		yield* Effect.logInfo('Fold Grok skill catalog composed').pipe(
			Effect.annotateLogs({
				sessionId: input.sessionId,
				configuredRepositoryCount: input.configuredRepositoryRoots.length,
				skillCount: skills.length,
			}),
		)
		return skillTool(skillSource(Effect.succeed(source)))
	}
	const discoveryOptions: Parameters<typeof discoverCodexSkills>[0] = {
		cwd: input.workingDirectory,
		bundledRpiRoot: path.join(rpiPluginPath, 'skills'),
		bundledHumanlayerRoot: path.join(humanlayerPluginPath, 'skills'),
		configuredRepoRoots: [...input.configuredRepositoryRoots],
	}
	discoveryOptions.home = input.homeDirectory
	if (input.codexHome !== undefined) discoveryOptions.codexHome = input.codexHome
	const discovered = yield* Effect.tryPromise(() => discoverCodexSkills(discoveryOptions))
	const skills: ReadonlyArray<Skill> = discovered.skills.map((skill) => ({
		name: skill.name,
		description: skill.description,
		content: skill.content,
		baseDir: skill.baseDir ?? null,
	}))

	yield* Effect.logInfo('Fold skill catalog composed').pipe(
		Effect.annotateLogs({
			sessionId: input.sessionId,
			configuredRepositoryCount: input.configuredRepositoryRoots.length,
			skillCount: skills.length,
			diagnosticCount: discovered.diagnostics.length,
		}),
	)

	return skillTool(skillSource(Effect.succeed(skillSourceFromCatalog(skills))))
})
