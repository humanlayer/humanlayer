// Skills. Codex loads HumanLayer's skills from the plugin's skills/ folder (the pi extension's
// copy). The plugin tells the web composer which skills a session has, and a web message that
// starts with `/name` becomes Codex's `$name` mention, as one typed in Codex would be.

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { frontmatter } from '@humanlayer/session-sdk-artifacts'
import type { DaemonRequest } from '@humanlayer/session-sdk-base'

export interface Skill {
	name: string
	description?: string
}

/** Every `<dir>/<name>/SKILL.md`'s name and description. A skill that fails to read is left out. */
export async function loadSkills(dir: string): Promise<Skill[]> {
	const names = await readdir(dir).catch(() => [])
	const skills = await Promise.all(
		names.map(async (folder) => {
			const content = await readFile(join(dir, folder, 'SKILL.md'), 'utf8').catch(() => undefined)
			if (!content) return []
			const meta = frontmatter(content)
			const skill: Skill = { name: typeof meta.name === 'string' && meta.name ? meta.name : folder }
			if (typeof meta.description === 'string') skill.description = meta.description
			return [skill]
		}),
	)
	return skills.flat().sort((a, b) => a.name.localeCompare(b.name))
}

type Report = DaemonRequest<'agentCommands/report'>

/**
 * The agentCommands/report body: the plugin's skills. A host-level report, with no workspace: the
 * plugin's skills are the same in every folder, and the web composer falls back to it.
 */
export function skillsReport(hostId: string, skills: readonly Skill[]): Report {
	return {
		hostId,
		agent: 'codex',
		commands: [],
		skills: skills.map((s) => {
			const skill: Report['skills'][number] = { name: s.name, scope: 'plugin' }
			if (s.description) skill.description = s.description
			return skill
		}),
	}
}

/**
 * A web message as Codex takes it: `/name args` for a known skill becomes `$name args`, Codex's
 * skill mention. Anything else goes in as typed.
 */
export function codexPrompt(text: string, skills: readonly Skill[]): string {
	const m = /^\/([^\s/]+)(?:\s+([\s\S]*))?$/.exec(text.trim())
	const name = m?.[1]
	if (!name || !skills.some((s) => s.name === name)) return text
	const args = m[2]?.trim()
	return args ? `$${name} ${args}` : `$${name}`
}
