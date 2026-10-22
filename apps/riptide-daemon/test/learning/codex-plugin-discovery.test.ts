import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, sep } from 'node:path'
import { promisify } from 'node:util'

import { createSkillTool, startState, userMessage, type AgentEvent } from '@humanlayer/agentlayer-core'
import { createMemoryAuthStore, readAuth, type AuthInfo } from '@humanlayer/agentlayer-provider-auth'
import { createCodexSseVendorProvider } from '@humanlayer/agentlayer-provider-openai-codex'
import { createCodelayerAgent, DEFAULT_MODELS } from '@humanlayer/codelayer'
import { describe, expect, test } from 'vitest'

import { discoverCodexSkills, type CodexSkillDiscoveryResult } from '../../src/agents/codelayer/codex-skill-discovery'

const execFileAsync = promisify(execFile)
const TEST_MODEL = process.env.CODEX_TEST_MODEL || DEFAULT_MODELS.codex
const FIXTURE_PREFIX = 'riptide-codex-plugin-'
const AMBIENT_PREFIX = 'riptide-codex-ambient-'
const PLUGIN_NAME = 'rpi'
const MARKETPLACE_NAME = 'riptide-learning'
const INSTALLED_SKILL_NAME = 'rpi:installed-proof'
const ACTIVATION_MARKER = 'LIVE_CODEX_PLUGIN_ACTIVATED_7f31'
const FORCED_FAILURE = 'FORCED_FIXTURE_FAILURE_8c42'
const TOUCHED_ENV = [
	'HOME',
	'CODEX_HOME',
	'XDG_CONFIG_HOME',
	'XDG_DATA_HOME',
	'GIT_CONFIG_GLOBAL',
	'GIT_CONFIG_SYSTEM',
] as const

const PRECEDENCE_MARKERS = {
	bundledWinner: 'BUNDLED_RPI_WINNER_44b1',
	pluginLoser: 'PLUGIN_RPI_LOSER_87a2',
	cwd: 'CWD_CODEX_WINNER_051c',
	root: 'ROOT_CODEX_WINNER_9a3d',
	configured: 'CONFIGURED_CODEX_WINNER_d880',
	user: 'USER_CODEX_WINNER_0f5e',
	agentsWinner: 'ROOT_AGENTS_WINNER_b619',
	claudeCollisionLoser: 'ROOT_CLAUDE_COLLISION_LOSER_5d27',
	claudeFallback: 'CONFIGURED_CLAUDE_FALLBACK_f3c8',
} as const

interface AmbientSentinels {
	root: string
	paths: string[]
	hashes: Map<string, string>
}

interface IsolatedFixture {
	root: string
	home: string
	codexHome: string
	projectRoot: string
	cwd: string
	configuredRoot: string
	bundledRoot: string
	marketplaceRoot: string
	pluginRoot: string
	subprocessEnv: NodeJS.ProcessEnv
}

const ambientCodexAuth: AuthInfo | undefined = await readAuth('codex').catch(() => undefined)

function isPathWithin(parent: string, candidate: string): boolean {
	const pathFromParent = relative(parent, candidate)
	return (
		pathFromParent === '' ||
		(!pathFromParent.startsWith(`..${sep}`) && pathFromParent !== '..' && !pathFromParent.startsWith(sep))
	)
}

async function assertOwnedTemporaryRoot(path: string, prefix: string): Promise<void> {
	const canonicalParent = await realpath(tmpdir())
	const canonicalPath = await realpath(path)
	if (
		!isPathWithin(canonicalParent, canonicalPath) ||
		basename(canonicalPath) === prefix ||
		!basename(canonicalPath).startsWith(prefix)
	) {
		throw new Error('Refusing to remove a path outside the test-owned temporary root')
	}
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path)
		return true
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
		throw error
	}
}

async function hashFile(path: string): Promise<string> {
	return createHash('sha256')
		.update(await readFile(path))
		.digest('hex')
}

async function snapshotHashes(paths: string[]): Promise<Map<string, string>> {
	return new Map(await Promise.all(paths.map(async (path) => [path, await hashFile(path)] as const)))
}

async function createAmbientSentinels(): Promise<AmbientSentinels> {
	const root = await mkdtemp(join(tmpdir(), AMBIENT_PREFIX))
	const paths = [
		join(root, 'home', 'AGENTS.md'),
		join(root, 'codex', 'config.toml'),
		join(root, 'codex', 'plugins', 'cache', 'sentinel'),
		join(root, 'git', 'config'),
	]
	for (const [index, path] of paths.entries()) {
		await mkdir(dirname(path), { recursive: true })
		await writeFile(path, `ambient-sentinel-${index}\n`, 'utf8')
	}
	return { root, paths, hashes: await snapshotHashes(paths) }
}

async function removeOwnedRoot(path: string, prefix: string): Promise<void> {
	await assertOwnedTemporaryRoot(path, prefix)
	await rm(path, { recursive: true, force: true })
}

async function withAmbientSentinels<T>(run: (ambient: AmbientSentinels) => Promise<T>): Promise<T> {
	const ambient = await createAmbientSentinels()
	try {
		return await run(ambient)
	} finally {
		await removeOwnedRoot(ambient.root, AMBIENT_PREFIX)
	}
}

function snapshotEnvironment(): Map<(typeof TOUCHED_ENV)[number], string | undefined> {
	return new Map(TOUCHED_ENV.map((key) => [key, process.env[key]]))
}

function restoreEnvironment(snapshot: Map<(typeof TOUCHED_ENV)[number], string | undefined>): void {
	for (const key of TOUCHED_ENV) {
		const original = snapshot.get(key)
		if (original === undefined) delete process.env[key]
		else process.env[key] = original
	}
}

async function assertEnvironment(snapshot: Map<(typeof TOUCHED_ENV)[number], string | undefined>): Promise<void> {
	for (const key of TOUCHED_ENV) expect(process.env[key]).toBe(snapshot.get(key))
}

async function withIsolatedFixture<T>(
	ambient: AmbientSentinels,
	run: (fixture: IsolatedFixture) => Promise<T>,
): Promise<T> {
	const environment = snapshotEnvironment()
	const root = await mkdtemp(join(tmpdir(), FIXTURE_PREFIX))
	const fixture: IsolatedFixture = {
		root,
		home: join(root, 'home'),
		codexHome: join(root, 'codex-home'),
		projectRoot: join(root, 'project'),
		cwd: join(root, 'project', 'apps', 'api'),
		configuredRoot: join(root, 'configured'),
		bundledRoot: join(root, 'bundled-rpi', 'skills'),
		marketplaceRoot: join(root, 'marketplace'),
		pluginRoot: join(root, 'marketplace', 'plugins', PLUGIN_NAME),
		subprocessEnv: {},
	}
	const isolatedEnvironment = {
		HOME: fixture.home,
		CODEX_HOME: fixture.codexHome,
		XDG_CONFIG_HOME: join(root, 'xdg-config'),
		XDG_DATA_HOME: join(root, 'xdg-data'),
		GIT_CONFIG_GLOBAL: join(root, 'git', 'global.config'),
		GIT_CONFIG_SYSTEM: join(root, 'git', 'system.config'),
	} satisfies Record<(typeof TOUCHED_ENV)[number], string>

	try {
		await Promise.all([
			mkdir(fixture.home, { recursive: true }),
			mkdir(fixture.codexHome, { recursive: true }),
			mkdir(fixture.cwd, { recursive: true }),
			mkdir(fixture.configuredRoot, { recursive: true }),
			mkdir(fixture.bundledRoot, { recursive: true }),
			mkdir(fixture.pluginRoot, { recursive: true }),
			mkdir(isolatedEnvironment.XDG_CONFIG_HOME, { recursive: true }),
			mkdir(isolatedEnvironment.XDG_DATA_HOME, { recursive: true }),
			mkdir(dirname(isolatedEnvironment.GIT_CONFIG_GLOBAL), { recursive: true }),
		])
		await Promise.all([
			writeFile(isolatedEnvironment.GIT_CONFIG_GLOBAL, '', 'utf8'),
			writeFile(isolatedEnvironment.GIT_CONFIG_SYSTEM, '', 'utf8'),
		])
		for (const key of TOUCHED_ENV) process.env[key] = isolatedEnvironment[key]
		fixture.subprocessEnv = { ...process.env }
		return await run(fixture)
	} finally {
		restoreEnvironment(environment)
		await removeOwnedRoot(root, FIXTURE_PREFIX)
		expect(await pathExists(root)).toBe(false)
		await assertEnvironment(environment)
		expect(await snapshotHashes(ambient.paths)).toEqual(ambient.hashes)
	}
}

async function writeSkill(
	root: string,
	directory: string,
	name: string,
	marker: string,
	instructions?: string,
): Promise<void> {
	const skillDirectory = join(root, directory)
	await mkdir(skillDirectory, { recursive: true })
	await writeFile(
		join(skillDirectory, 'SKILL.md'),
		`---\nname: ${name}\ndescription: Learning fixture ${name}\n---\n\n${marker}\n${instructions ?? ''}\n`,
		'utf8',
	)
}

async function materializeDiscoveryFixture(fixture: IsolatedFixture): Promise<void> {
	await Promise.all([
		execFileAsync('git', ['init', '--quiet'], { cwd: fixture.projectRoot, env: fixture.subprocessEnv }),
		execFileAsync('git', ['init', '--quiet'], { cwd: fixture.marketplaceRoot, env: fixture.subprocessEnv }),
	])
	await Promise.all([
		writeSkill(fixture.bundledRoot, 'collision', 'collision', PRECEDENCE_MARKERS.bundledWinner),
		writeSkill(join(fixture.cwd, '.codex', 'skills'), 'cwd-marker', 'cwd-marker', PRECEDENCE_MARKERS.cwd),
		writeSkill(
			join(fixture.projectRoot, '.codex', 'skills'),
			'root-marker',
			'root-marker',
			PRECEDENCE_MARKERS.root,
		),
		writeSkill(
			join(fixture.projectRoot, '.agents', 'skills'),
			'agents-collision',
			'agents-collision',
			PRECEDENCE_MARKERS.agentsWinner,
		),
		writeSkill(
			join(fixture.projectRoot, '.claude', 'skills'),
			'agents-collision',
			'agents-collision',
			PRECEDENCE_MARKERS.claudeCollisionLoser,
		),
		writeSkill(
			join(fixture.configuredRoot, '.codex', 'skills'),
			'configured-marker',
			'configured-marker',
			PRECEDENCE_MARKERS.configured,
		),
		writeSkill(
			join(fixture.configuredRoot, '.claude', 'skills'),
			'claude-fallback',
			'claude-fallback',
			PRECEDENCE_MARKERS.claudeFallback,
		),
		writeSkill(join(fixture.codexHome, 'skills'), 'user-marker', 'user-marker', PRECEDENCE_MARKERS.user),
		writeSkill(join(fixture.pluginRoot, 'skills'), 'collision', 'collision', PRECEDENCE_MARKERS.pluginLoser),
		writeSkill(
			join(fixture.pluginRoot, 'skills'),
			'installed-proof',
			'installed-proof',
			ACTIVATION_MARKER,
			`When activated, reply with exactly ${ACTIVATION_MARKER}.`,
		),
	])

	await mkdir(join(fixture.marketplaceRoot, '.agents', 'plugins'), { recursive: true })
	await mkdir(join(fixture.pluginRoot, '.codex-plugin'), { recursive: true })
	await Promise.all([
		writeFile(
			join(fixture.marketplaceRoot, '.agents', 'plugins', 'marketplace.json'),
			`${JSON.stringify(
				{
					name: MARKETPLACE_NAME,
					plugins: [
						{
							name: PLUGIN_NAME,
							version: '1.0.0',
							source: { source: 'local', path: `./plugins/${PLUGIN_NAME}` },
						},
					],
				},
				null,
				2,
			)}\n`,
			'utf8',
		),
		writeFile(
			join(fixture.pluginRoot, '.codex-plugin', 'plugin.json'),
			`${JSON.stringify({ name: PLUGIN_NAME, version: '1.0.0', skills: ['./skills'] }, null, 2)}\n`,
			'utf8',
		),
	])
}

async function installPlugin(fixture: IsolatedFixture): Promise<void> {
	await execFileAsync('codex', ['plugin', 'marketplace', 'add', fixture.marketplaceRoot, '--json'], {
		env: { ...fixture.subprocessEnv },
	})
	await execFileAsync('codex', ['plugin', 'add', `${PLUGIN_NAME}@${MARKETPLACE_NAME}`, '--json'], {
		env: { ...fixture.subprocessEnv },
	})

	const configPath = join(fixture.codexHome, 'config.toml')
	const config = await readFile(configPath, 'utf8')
	expect(config).toContain(`[plugins."${PLUGIN_NAME}@${MARKETPLACE_NAME}"]`)
	expect(config).toContain('enabled = true')
	const cacheRoot = join(fixture.codexHome, 'plugins', 'cache', MARKETPLACE_NAME, PLUGIN_NAME)
	const versions = await readdir(cacheRoot)
	expect(versions).toEqual(['1.0.0'])
	expect(await pathExists(join(cacheRoot, '1.0.0', '.codex-plugin', 'plugin.json'))).toBe(true)
	expect(await pathExists(join(cacheRoot, '1.0.0', 'skills', 'installed-proof', 'SKILL.md'))).toBe(true)
}

function expectSkillMarker(discovery: CodexSkillDiscoveryResult, name: string, marker: string): void {
	const skill = discovery.skills.find((candidate) => candidate.name === name)
	expect(skill, `Expected discovered skill ${name}`).toBeDefined()
	expect(skill?.content).toContain(marker)
}

function assertDiscoveryPrecedence(discovery: CodexSkillDiscoveryResult): void {
	expect(discovery.diagnostics).toEqual([])
	expect(discovery.skills.map((skill) => skill.name)).toEqual([
		'rpi:collision',
		'cwd-marker',
		'root-marker',
		'agents-collision',
		'configured-marker',
		'claude-fallback',
		'user-marker',
		INSTALLED_SKILL_NAME,
	])
	expectSkillMarker(discovery, 'rpi:collision', PRECEDENCE_MARKERS.bundledWinner)
	expectSkillMarker(discovery, 'cwd-marker', PRECEDENCE_MARKERS.cwd)
	expectSkillMarker(discovery, 'root-marker', PRECEDENCE_MARKERS.root)
	expectSkillMarker(discovery, 'configured-marker', PRECEDENCE_MARKERS.configured)
	expectSkillMarker(discovery, 'user-marker', PRECEDENCE_MARKERS.user)
	expectSkillMarker(discovery, 'agents-collision', PRECEDENCE_MARKERS.agentsWinner)
	expectSkillMarker(discovery, 'claude-fallback', PRECEDENCE_MARKERS.claudeFallback)
	expectSkillMarker(discovery, INSTALLED_SKILL_NAME, ACTIVATION_MARKER)
	const allContent = discovery.skills.map((skill) => skill.content).join('\n')
	expect(allContent).not.toContain(PRECEDENCE_MARKERS.pluginLoser)
	expect(allContent).not.toContain(PRECEDENCE_MARKERS.claudeCollisionLoser)
	expect(discovery.skills.find((skill) => skill.name === INSTALLED_SKILL_NAME)?.source.kind).toBe('plugin')
}

function messageText(message: unknown): string {
	if (!message || typeof message !== 'object' || !('content' in message)) return ''
	const content = message.content
	if (typeof content === 'string') return content
	if (!Array.isArray(content)) return ''
	return content
		.map((part) => {
			if (!part || typeof part !== 'object') return ''
			if ('text' in part && typeof part.text === 'string') return part.text
			if ('output' in part && typeof part.output === 'string') return part.output
			return ''
		})
		.join('')
}

async function runLiveActivation(
	fixture: IsolatedFixture,
	discovery: CodexSkillDiscoveryResult,
	auth: AuthInfo,
): Promise<void> {
	const model = createCodexSseVendorProvider({
		authStore: createMemoryAuthStore({ codex: auth }),
		version: 'riptide-learning-test',
		fastMode: true,
	}).languageModel(TEST_MODEL)
	const agent = await createCodelayerAgent({
		model,
		cwd: fixture.cwd,
		environment: { include: false },
		skillTool: createSkillTool({ skills: discovery.skills }),
		tools: {
			bash: false,
			read: false,
			write: false,
			edit: false,
			applyPatch: false,
			list: false,
			grep: false,
			glob: false,
			webFetch: false,
		},
	})
	const run = agent.run({
		state: startState([
			userMessage(
				`Call the skill tool with name "${INSTALLED_SKILL_NAME}" before answering. Do not call any other tool. After activation, follow the skill and return only its required marker.`,
			),
		]),
		stream: true,
	})
	const events: AgentEvent[] = []
	for await (const event of run) events.push(event)
	const result = await run.result
	expect(result.finishReason).not.toBe('error')

	const stepStartIndex = events.findIndex((event) => event.type === 'stepStart')
	const toolStartIndex = events.findIndex((event) => event.type === 'toolInputStart' && event.toolName === 'skill')
	const toolEndIndex = events.findIndex((event) => event.type === 'toolInputEnd')
	const finalTextIndex = events.findIndex((event, index) => event.type === 'textDelta' && index > toolEndIndex)
	expect(stepStartIndex).toBeGreaterThanOrEqual(0)
	expect(toolStartIndex).toBeGreaterThan(stepStartIndex)
	expect(toolEndIndex).toBeGreaterThan(toolStartIndex)
	expect(finalTextIndex).toBeGreaterThan(toolEndIndex)
	expect(
		events
			.filter((event) => event.type === 'textDelta')
			.map((event) => event.text)
			.join(''),
	).toContain(ACTIVATION_MARKER)

	const toolInput = events
		.filter((event) => event.type === 'toolInputDelta')
		.map((event) => event.delta)
		.join('')
	expect(JSON.parse(toolInput)).toMatchObject({ name: INSTALLED_SKILL_NAME })
	const eventMessages = events.filter((event) => event.type === 'message').map((event) => event.message)
	const serializedEventMessages = JSON.stringify(eventMessages)
	expect(serializedEventMessages.includes('"toolName":"skill"')).toBe(true)
	expect(serializedEventMessages.includes(`Skill \\"${INSTALLED_SKILL_NAME}\\" activated successfully`)).toBe(true)
	expect(
		eventMessages.some((message) => messageText(message).includes(`<skill name="${INSTALLED_SKILL_NAME}"`)),
	).toBe(true)
	expect(eventMessages.some((message) => messageText(message).includes(ACTIVATION_MARKER))).toBe(true)
	expect(result.state.messages.some((message) => messageText(message).includes(ACTIVATION_MARKER))).toBe(true)
}

describe('live Codex plugin discovery', { concurrent: false }, () => {
	test('removes successful fixtures and restores environment without touching ambient sentinels', async () => {
		let fixtureRoot = ''
		await withAmbientSentinels(async (ambient) => {
			await withIsolatedFixture(ambient, async (fixture) => {
				fixtureRoot = fixture.root
				expect(await pathExists(fixture.root)).toBe(true)
			})
			expect(await pathExists(fixtureRoot)).toBe(false)
		})
	})

	test('removes failed fixtures and restores environment without touching ambient sentinels', async () => {
		let fixtureRoot = ''
		await withAmbientSentinels(async (ambient) => {
			await expect(
				withIsolatedFixture(ambient, async (fixture) => {
					fixtureRoot = fixture.root
					throw new Error(FORCED_FAILURE)
				}),
			).rejects.toThrow(FORCED_FAILURE)
			expect(await pathExists(fixtureRoot)).toBe(false)
		})
	})

	test.skipIf(!ambientCodexAuth)(
		'installs through Codex CLI, discovers production skills, and activates the installed skill with CodeLayer',
		async () => {
			await withAmbientSentinels(async (ambient) => {
				await withIsolatedFixture(ambient, async (fixture) => {
					await materializeDiscoveryFixture(fixture)
					await installPlugin(fixture)
					const discovery = await discoverCodexSkills({
						cwd: fixture.cwd,
						home: fixture.home,
						codexHome: fixture.codexHome,
						bundledRpiRoot: fixture.bundledRoot,
						configuredRepoRoots: [fixture.configuredRoot],
					})
					assertDiscoveryPrecedence(discovery)
					await runLiveActivation(fixture, discovery, ambientCodexAuth!)
				})
			})
		},
		180_000,
	)
})
