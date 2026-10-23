import type { AgentCommand, AgentCommandScope, AgentSkill } from '@humanlayer/db/tables/agent-slash-commands'
import { Config, Effect, FileSystem, Option, Path, Predicate } from 'effect'
import matter from 'gray-matter'

type Frontmatter = Record<string, unknown> | undefined

// gray-matter throws on invalid YAML, which Claude Code does not load either; a file with no
// frontmatter parses to an empty record.
function parseFrontmatter(contents: string): Frontmatter {
	try {
		return matter(contents).data
	} catch {
		return undefined
	}
}

function frontmatterString(frontmatter: Frontmatter, field: string): string | undefined {
	const value = frontmatter?.[field]
	if (!Predicate.isString(value)) return undefined
	const trimmed = value.trim()
	return trimmed.length > 0 ? trimmed : undefined
}

function isUserInvocable(frontmatter: Frontmatter): boolean {
	return frontmatter?.['user-invocable'] !== false
}

const listDirectoryOrEmpty = Effect.fn('agent_commands.list_directory')(function* (input: {
	readonly directory: string
	readonly recursive: boolean
}) {
	const fs = yield* FileSystem.FileSystem
	return yield* fs.readDirectory(input.directory, { recursive: input.recursive }).pipe(
		Effect.tapError((error) =>
			Effect.logDebug('Agent command discovery root is not readable').pipe(
				Effect.annotateLogs({ directory: input.directory, reason: error.reason }),
			),
		),
		Effect.orElseSucceed((): string[] => []),
	)
})

// Claude Code loads skills from `<root>/<skill>/SKILL.md` and publishes each under its
// frontmatter `name`, falling back to the directory (observed on Claude Code 2.1.271, where a
// misspelled `name` is what the SDK reports). Malformed frontmatter does not load there either.
const discoverSkillsInRoot = Effect.fn('agent_commands.discover_skills')(function* (input: {
	readonly root: string
	readonly scope: AgentCommandScope
}) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const entries = yield* listDirectoryOrEmpty({ directory: input.root, recursive: false })
	const skills: AgentSkill[] = []

	for (const entry of entries) {
		const contents = yield* fs.readFileString(path.join(input.root, entry, 'SKILL.md')).pipe(Effect.option)
		if (Option.isNone(contents)) continue

		const frontmatter = parseFrontmatter(contents.value)
		if (frontmatter === undefined || !isUserInvocable(frontmatter)) continue

		const skill: AgentSkill = { name: frontmatterString(frontmatter, 'name') ?? entry, scope: input.scope }
		const description = frontmatterString(frontmatter, 'description')
		if (description) skill.description = description
		skills.push(skill)
	}

	return skills
})

// Claude Code maps `<root>/rpi/create-plan.md` to `/rpi:create-plan`: a subdirectory is a `:` namespace.
const discoverCommandsInRoot = Effect.fn('agent_commands.discover_commands')(function* (input: {
	readonly root: string
	readonly scope: AgentCommandScope
}) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const entries = yield* listDirectoryOrEmpty({ directory: input.root, recursive: true })
	const commands: AgentCommand[] = []

	for (const relativePath of entries) {
		if (!relativePath.endsWith('.md')) continue
		const contents = yield* fs.readFileString(path.join(input.root, relativePath)).pipe(Effect.option)
		if (Option.isNone(contents)) continue

		const frontmatter = parseFrontmatter(contents.value)
		if (frontmatter === undefined) continue

		const namespace = relativePath.slice(0, -'.md'.length).split(path.sep)
		const command: AgentCommand = { name: namespace.join(':'), scope: input.scope }
		const description = frontmatterString(frontmatter, 'description')
		const argumentHint = frontmatterString(frontmatter, 'argument-hint')
		if (description) command.description = description
		if (argumentHint) command.argumentHint = argumentHint
		commands.push(command)
	}

	return commands
})

// Roots are listed highest precedence first and the first hit for a name wins: with the same
// skill in both scopes, Claude Code runs the user copy.
function firstByName<T extends { name: string }>(entries: T[]): T[] {
	const byName = new Map<string, T>()
	for (const entry of entries) {
		const name = entry.name.trim()
		if (!name) continue
		const key = name.toLowerCase()
		if (!byName.has(key)) byName.set(key, { ...entry, name })
	}
	return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name))
}

// `CLAUDE_CONFIG_DIR` reaches the subprocess unexpanded, so a literal `~` must stay
// literal here to read the same directory the agent will.
const resolveClaudeConfigDirectory = Effect.gen(function* () {
	const path = yield* Path.Path
	const configured = yield* Config.String('CLAUDE_CONFIG_DIR').pipe(
		Config.map((value) => value.trim()),
		Config.withDefault(''),
	)
	if (configured.length > 0) return configured
	const home = yield* Config.String('HOME')
	return path.join(home, '.claude')
})

export interface DiscoveredAgentCommands {
	readonly commands: AgentCommand[]
	readonly skills: AgentSkill[]
}

export interface DiscoverAgentCommandsInput {
	readonly workspacePath?: string
}

export const discoverAgentCommands = Effect.fn('agent_commands.discover')(function* (
	input: DiscoverAgentCommandsInput,
) {
	const path = yield* Path.Path
	const configDirectory = yield* resolveClaudeConfigDirectory
	const projectRoot = input.workspacePath ? path.join(input.workspacePath, '.claude') : undefined

	const [userSkills, userCommands, projectSkills, projectCommands] = yield* Effect.all(
		[
			discoverSkillsInRoot({ root: path.join(configDirectory, 'skills'), scope: 'user' }),
			discoverCommandsInRoot({ root: path.join(configDirectory, 'commands'), scope: 'user' }),
			projectRoot
				? discoverSkillsInRoot({ root: path.join(projectRoot, 'skills'), scope: 'project' })
				: Effect.succeed([]),
			projectRoot
				? discoverCommandsInRoot({ root: path.join(projectRoot, 'commands'), scope: 'project' })
				: Effect.succeed([]),
		],
		{ concurrency: 4 },
	)

	const discovered: DiscoveredAgentCommands = {
		commands: firstByName([...userCommands, ...projectCommands]),
		skills: firstByName([...userSkills, ...projectSkills]),
	}

	yield* Effect.logDebug('Discovered agent commands').pipe(
		Effect.annotateLogs({
			workspacePath: input.workspacePath ?? null,
			commandCount: discovered.commands.length,
			skillCount: discovered.skills.length,
		}),
	)

	return discovered
})
