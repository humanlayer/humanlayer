// Skills. The plugin adds HumanLayer's own skills to opencode (the pi extension's copy, written for
// agents other than Claude Code), and tells the web composer which skills and commands a session
// has, so a web message can start with `/create-research` as one typed in opencode can.

import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { frontmatter } from '@humanlayer/session-sdk-artifacts'
import type { DaemonRequest } from '@humanlayer/session-sdk-base'

export interface BundledSkill {
	id: string
	name: string
	description?: string
	path: string
	content: string
}

/** Every `<dir>/<name>/SKILL.md`, as opencode's skill info. A skill that fails to read is left out. */
export async function loadSkills(dir: string): Promise<BundledSkill[]> {
	const names = await readdir(dir).catch(() => [])
	const skills = await Promise.all(
		names.map(async (folder) => {
			const path = join(dir, folder, 'SKILL.md')
			const content = await readFile(path, 'utf8').catch(() => undefined)
			if (!content) return []
			const meta = frontmatter(content)
			const name = typeof meta.name === 'string' && meta.name ? meta.name : folder
			const skill: BundledSkill = { id: name, name, path, content }
			if (typeof meta.description === 'string') skill.description = meta.description
			return [skill]
		}),
	)
	return skills.flat().sort((a, b) => a.name.localeCompare(b.name))
}

type Report = DaemonRequest<'agentCommands/report'>
type AgentSkill = Report['skills'][number]
type AgentCommand = Report['commands'][number]

/** The composer's scope for a skill file: the project's, the user's, else a plugin's. */
function scopeOf(path: string, workspace: string): NonNullable<AgentSkill['scope']> {
	if (path.startsWith(`${workspace}/`)) return 'project'
	if (path.startsWith(`${homedir()}/`) && !path.includes('/node_modules/')) return 'user'
	return 'plugin'
}

/** The agentCommands/report body for one workspace. */
export function skillsReport(o: {
	hostId: string
	workspace: string
	skills: readonly { name: string; description?: string; path: string }[]
	commands: readonly { name: string; description?: string }[]
	/** Skill paths the plugin added itself. */
	bundled: ReadonlySet<string>
}): Report {
	const skills = o.skills.map((s): AgentSkill => {
		const skill: AgentSkill = {
			name: s.name,
			scope: o.bundled.has(s.path) ? 'plugin' : scopeOf(s.path, o.workspace),
		}
		if (s.description) skill.description = s.description
		return skill
	})
	const commands = o.commands.map((c): AgentCommand => {
		const command: AgentCommand = { name: c.name }
		if (c.description) command.description = c.description
		return command
	})
	return { hostId: o.hostId, agent: 'opencode', workspacePath: o.workspace, commands, skills }
}

/** A web message's leading `/name`, split from the rest. */
export function slashCommand(text: string): { name: string; args: string } | undefined {
	const m = /^\/([^\s/]+)(?:\s+([\s\S]*))?$/.exec(text.trim())
	return m?.[1] ? { name: m[1], args: m[2]?.trim() ?? '' } : undefined
}
