import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { NodeServices } from '@effect/platform-node'
import { it } from '@effect/vitest'
import { Effect } from 'effect'
import { describe, expect } from 'vitest'

import { makeFoldSkillTool } from '@/effects/services/fold-sessions/fold-skills'

const writeSkill = async (root: string, directory: string, name: string, description: string) => {
	const baseDir = join(root, directory)
	await mkdir(baseDir, { recursive: true })
	await writeFile(
		join(baseDir, 'SKILL.md'),
		`---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`,
		'utf8',
	)
}

describe('Fold skills', () => {
	it.effect('composes Codex roots and namespaces bundled HumanLayer and RPI skills', () =>
		Effect.acquireUseRelease(
			Effect.tryPromise(() => mkdtemp(join(tmpdir(), 'fold-riptide-skills-'))),
			(root) =>
				Effect.gen(function* () {
					const home = join(root, 'home')
					const cwd = join(root, 'repo')
					const configured = join(root, 'configured')
					const rpiPlugin = join(root, 'rpi-plugin')
					const humanlayerPlugin = join(root, 'humanlayer-plugin')
					yield* Effect.tryPromise(() =>
						Promise.all([
							writeSkill(
								join(home, '.claude', 'skills'),
								'claude-home-proof',
								'claude-home-proof',
								'Claude home proof',
							),
							writeSkill(
								join(home, '.fold', 'skills'),
								'default-proof',
								'default-proof',
								'Default proof',
							),
							writeSkill(
								join(cwd, '.claude', 'skills'),
								'claude-cwd-proof',
								'claude-cwd-proof',
								'Cwd proof',
							),
							writeSkill(
								join(cwd, '.agents', 'skills'),
								'agents-cwd-proof',
								'agents-cwd-proof',
								'Cwd proof',
							),
							writeSkill(join(home, '.fold', 'skills'), 'collision', 'collision', 'Lower precedence'),
							writeSkill(
								join(configured, '.agents', 'skills'),
								'collision',
								'collision',
								'Higher precedence',
							),
							writeSkill(
								join(configured, '.agents', 'skills'),
								'configured-proof',
								'configured-proof',
								'Configured proof',
							),
							writeSkill(join(rpiPlugin, 'skills'), 'create-plan', 'create-plan', 'Create a plan'),
							writeSkill(
								join(humanlayerPlugin, 'skills'),
								'humanlayer-proof',
								'humanlayer-proof',
								'HumanLayer proof',
							),
						]),
					)

					const tool = yield* makeFoldSkillTool({
						sessionId: 'session-1',
						provider: 'codex',
						workingDirectory: cwd,
						projectRoot: cwd,
						configuredRepositoryRoots: [join(root, 'missing-root'), configured],
						homeDirectory: home,
						rpiPluginPath: rpiPlugin,
						humanlayerPluginPath: humanlayerPlugin,
					})
					const contribution = yield* tool.init
					const source = contribution.skillSource
					if (source === undefined) return yield* Effect.die('Expected skill source contribution')
					const names = (yield* source.list).map((skill) => skill.name)

					expect(names).toContain('claude-home-proof')
					expect(names).toContain('claude-cwd-proof')
					expect(names).toContain('agents-cwd-proof')
					expect(names).toContain('configured-proof')
					expect(names).toContain('hl:humanlayer-proof')
					expect(names).toContain('rpi:create-plan')
					expect(names).not.toContain('create-plan')
					const rpiSkill = yield* source.load('rpi:create-plan')
					expect(rpiSkill.baseDir).toBe(
						yield* Effect.tryPromise(() => realpath(join(rpiPlugin, 'skills', 'create-plan'))),
					)
					const collision = yield* source.load('collision')
					expect(collision.baseDir?.replace(/^\/private/, '')).toBe(
						(yield* Effect.tryPromise(() =>
							realpath(join(configured, '.agents', 'skills', 'collision')),
						)).replace(/^\/private/, ''),
					)
				}),
			(root) => Effect.tryPromise(() => rm(root, { recursive: true, force: true })).pipe(Effect.orDie),
		).pipe(Effect.provide(NodeServices.layer)),
	)

	it.effect('loads Grok-native and compatible skills without loading Codex-only roots', () =>
		Effect.acquireUseRelease(
			Effect.tryPromise(() => mkdtemp(join(tmpdir(), 'fold-riptide-grok-skills-'))),
			(root) =>
				Effect.gen(function* () {
					const home = join(root, 'home')
					const grokHome = join(home, '.grok')
					const cwd = join(root, 'repo', 'apps')
					const projectRoot = join(root, 'repo')
					const configured = join(root, 'configured')
					const configuredSkills = join(grokHome, 'configured-skills')
					const configuredPlugin = join(grokHome, 'configured-plugins', 'configured-plugin')
					const rpiPlugin = join(root, 'rpi-plugin')
					const humanlayerPlugin = join(root, 'humanlayer-plugin')
					yield* Effect.tryPromise(() =>
						Promise.all([
							writeSkill(join(cwd, '.grok', 'skills'), 'local', 'local', 'Local Grok skill'),
							writeSkill(join(projectRoot, '.agents', 'skills'), 'agents', 'agents', 'Agents skill'),
							writeSkill(join(home, '.claude', 'skills'), 'claude', 'claude', 'Claude skill'),
							writeSkill(join(configured, '.cursor', 'skills'), 'cursor', 'cursor', 'Cursor skill'),
							writeSkill(join(home, '.codex', 'skills'), 'codex-only', 'codex-only', 'Codex only'),
							writeSkill(
								configuredSkills,
								'configured-native',
								'configured-native',
								'Configured native skill',
							),
							writeSkill(
								join(configuredPlugin, 'skills'),
								'configured-plugin-skill',
								'configured-plugin-skill',
								'Configured plugin skill',
							),
							writeSkill(
								join(projectRoot, '.grok', 'plugins', 'acme', 'skills'),
								'deploy',
								'deploy',
								'Plugin deploy',
							),
							writeSkill(join(rpiPlugin, 'skills'), 'create-plan', 'create-plan', 'Create a plan'),
							writeSkill(join(humanlayerPlugin, 'skills'), 'review', 'review', 'Review task'),
							writeSkill(
								join(projectRoot, '.grok', 'plugins', 'broken', 'skills'),
								'must-not-load',
								'must-not-load',
								'Malformed plugin skill',
							),
							mkdir(join(projectRoot, '.grok', 'plugins', 'acme'), { recursive: true }).then(() =>
								writeFile(
									join(projectRoot, '.grok', 'plugins', 'acme', 'plugin.json'),
									JSON.stringify({ name: 'acme' }),
								),
							),
							mkdir(join(projectRoot, '.grok', 'plugins', 'broken'), { recursive: true }).then(() =>
								writeFile(join(projectRoot, '.grok', 'plugins', 'broken', 'plugin.json'), '{not-json'),
							),
							mkdir(grokHome, { recursive: true }).then(() =>
								writeFile(
									join(grokHome, 'config.toml'),
									'[skills]\npaths = ["configured-skills"]\n\n[plugins]\npaths = ["configured-plugins/configured-plugin"]\n',
								),
							),
							mkdir(configuredPlugin, { recursive: true }).then(() =>
								writeFile(
									join(configuredPlugin, 'plugin.json'),
									JSON.stringify({ name: 'configured-plugin' }),
								),
							),
						]),
					)

					const tool = yield* makeFoldSkillTool({
						sessionId: 'session-grok',
						provider: 'xai',
						workingDirectory: cwd,
						projectRoot,
						configuredRepositoryRoots: [configured],
						homeDirectory: home,
						grokHome,
						rpiPluginPath: rpiPlugin,
						humanlayerPluginPath: humanlayerPlugin,
					})
					const contribution = yield* tool.init
					const source = contribution.skillSource
					if (source === undefined) return yield* Effect.die('Expected skill source contribution')
					const names = (yield* source.list).map(({ name }) => name)

					expect(names).toContain('local')
					expect(names).toContain('agents')
					expect(names).toContain('claude')
					expect(names).toContain('cursor')
					expect(names).toContain('configured-native')
					expect(names).toContain('configured-plugin:configured-plugin-skill')
					expect(names).toContain('acme:deploy')
					expect(names).toContain('rpi:create-plan')
					expect(names).toContain('hl:review')
					expect(names).not.toContain('codex-only')
					expect(names).not.toContain('broken:must-not-load')
				}),
			(root) => Effect.tryPromise(() => rm(root, { recursive: true, force: true })).pipe(Effect.orDie),
		).pipe(Effect.provide(NodeServices.layer)),
	)
})
