import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import { codebaseAnalyzer } from '../../riptide-daemon/src/agents/claudecode/agents/codebase-analyzer.ts'
import { codebaseLocator } from '../../riptide-daemon/src/agents/claudecode/agents/codebase-locator.ts'
import { codebasePatternFinder } from '../../riptide-daemon/src/agents/claudecode/agents/codebase-pattern-finder.ts'
import { implementationReviewer } from '../../riptide-daemon/src/agents/claudecode/agents/implementation-reviewer.ts'
import { implementerAgent } from '../../riptide-daemon/src/agents/claudecode/agents/implementer-agent.ts'
import { outlineImplementerAgent } from '../../riptide-daemon/src/agents/claudecode/agents/outline-implementer-agent.ts'
import { webSearchResearcher } from '../../riptide-daemon/src/agents/claudecode/agents/web-search-researcher.ts'

export const agents = {
	'codebase-analyzer': codebaseAnalyzer,
	'codebase-locator': codebaseLocator,
	'codebase-pattern-finder': codebasePatternFinder,
	'implementation-reviewer': implementationReviewer,
	'implementer-agent': implementerAgent,
	'outline-implementer-agent': outlineImplementerAgent,
	'web-search-researcher': webSearchResearcher,
}

export const agentsDir = new URL('../agents/', import.meta.url)
export const bodyMarker = '<!-- Canonical prompt (verbatim) -->\n'
export const toolMap: Record<string, string | null> = {
	Read: 'read',
	Grep: 'grep',
	Glob: 'find',
	Bash: 'bash',
	Edit: 'edit',
	Write: 'write',
	Skill: 'read',
	TodoWrite: null,
	WebSearch: 'web_search',
	WebFetch: 'fetch_content',
}

export function mappedTools(tools: readonly string[]) {
	return [
		...new Set(
			tools.flatMap((tool) => {
				if (!(tool in toolMap)) throw new Error(`Unsupported canonical tool: ${tool}`)
				return toolMap[tool] === null ? [] : [toolMap[tool]]
			}),
		),
	]
}

export function renderAgent(name: string, agent: { description: string; prompt: string; tools?: string[] }) {
	const web =
		name === 'web-search-researcher'
			? '\nWebSearch maps to web_search and WebFetch to fetch_content. These are conventional extension names, not Pi builtins; the host must load providers registering both in the child (via extensions/subagentOnlyExtensions, or ambient discovery for background children). Missing providers may fail launch before this prompt runs. Never broaden the allowlist or add mutation tools to obtain web access. Use only tools actually available in this session. If the capability is unavailable, report that limitation; never fabricate searches, sources, or results.\n'
			: ''
	return `---
name: ${name}
description: ${JSON.stringify(agent.description)}
tools: ${mappedTools(agent.tools ?? []).join(', ')}
---

## Pi compatibility

Read/Grep/Glob/Bash/Edit/Write mean read/grep/find/bash/edit/write respectively.
Skill means read the matching available SKILL.md. TodoWrite means maintain a plain-text plan, not a tool call.
${web}
---

${bodyMarker}${agent.prompt}`
}

export function generateAgents(check = false) {
	const expected = Object.keys(agents)
		.map((name) => `${name}.md`)
		.sort()
	if (!check) mkdirSync(agentsDir, { recursive: true })
	const actual = readdirSync(agentsDir)
		.filter((name) => name.endsWith('.md'))
		.sort()
	if (check && JSON.stringify(actual) !== JSON.stringify(expected))
		throw new Error('Generated agent file set is stale')
	for (const [name, agent] of Object.entries(agents)) {
		const file = new URL(`${name}.md`, agentsDir)
		const content = renderAgent(name, agent)
		if (check) {
			if (readFileSync(file, 'utf8') !== content) throw new Error(`Generated agent is stale: ${name}`)
		} else writeFileSync(file, content)
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	generateAgents(process.argv.includes('--check'))
}
