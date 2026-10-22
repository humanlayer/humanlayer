import { discoverGrokPluginSkillRoots, makeGrokSkillSource as makeFoldGrokSkillSource } from '@humanlayer/fold-agent'
import { parse as parseToml } from '@iarna/toml'
import { Effect, FileSystem, Path, Predicate } from 'effect'

const projectSkillDirectories = ['.grok', '.agents', '.claude', '.cursor'] as const

export interface GrokSkillDiscoveryInput {
	readonly cwd: string
	readonly home: string
	readonly grokHome: string
	readonly projectRoot: string
	readonly configuredRepositoryRoots: ReadonlyArray<string>
	readonly bundledPaths: ReadonlyArray<{ readonly name: string; readonly path: string }>
}

interface GrokConfigPaths {
	readonly skills: ReadonlyArray<string>
	readonly plugins: ReadonlyArray<string>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

const stringPaths = (value: unknown): ReadonlyArray<string> =>
	Array.isArray(value) ? value.filter(Predicate.isString) : []

const loadConfiguredPaths = Effect.fn('fold.grok_skills.load_configured_paths')(function* (input: {
	readonly grokHome: string
}) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const configPath = path.join(input.grokHome, 'config.toml')
	const contents = yield* fs.readFileString(configPath).pipe(Effect.orElseSucceed(() => null))
	if (contents === null) return { skills: [], plugins: [] } satisfies GrokConfigPaths
	const parsed = yield* Effect.try((): unknown => parseToml(contents)).pipe(Effect.orElseSucceed(() => null))
	if (!isRecord(parsed)) return { skills: [], plugins: [] } satisfies GrokConfigPaths
	const skills = isRecord(parsed.skills) ? stringPaths(parsed.skills.paths) : []
	const plugins = isRecord(parsed.plugins) ? stringPaths(parsed.plugins.paths) : []
	return {
		skills: skills.map((configuredPath) => path.resolve(input.grokHome, configuredPath)),
		plugins: plugins.map((configuredPath) => path.resolve(input.grokHome, configuredPath)),
	} satisfies GrokConfigPaths
})

export const makeGrokSkillSource = Effect.fn('fold.grok_skills.make_source')(function* (
	input: GrokSkillDiscoveryInput,
) {
	const path = yield* Path.Path
	const configured = yield* loadConfiguredPaths({ grokHome: input.grokHome })
	const configuredPaths = [
		...input.configuredRepositoryRoots.flatMap((directory) =>
			projectSkillDirectories.map((vendor) => path.join(directory, vendor, 'skills')),
		),
		...configured.skills,
	]
	const plugins = yield* discoverGrokPluginSkillRoots({
		cwd: input.cwd,
		home: input.home,
		grokHome: input.grokHome,
		projectRoot: input.projectRoot,
		configuredPaths: configured.plugins,
	})
	for (const diagnostic of plugins.diagnostics) {
		yield* Effect.logWarning('Grok plugin skill discovery skipped invalid metadata').pipe(
			Effect.annotateLogs({ stage: diagnostic.stage, code: diagnostic.code }),
		)
	}
	return yield* makeFoldGrokSkillSource({
		cwd: input.cwd,
		home: input.home,
		grokHome: input.grokHome,
		projectRoot: input.projectRoot,
		configuredPaths,
		pluginPaths: [...input.bundledPaths, ...plugins.roots],
	})
})
