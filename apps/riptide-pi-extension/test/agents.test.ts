import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { test } from 'node:test'

import { agents, agentsDir, bodyMarker, generateAgents, renderAgent } from '../scripts/generate-agents.ts'

test('ships exactly the canonical seven agents without drift', () => {
	assert.deepEqual(
		Object.keys(agents).sort(),
		[
			'codebase-analyzer',
			'codebase-locator',
			'codebase-pattern-finder',
			'implementation-reviewer',
			'implementer-agent',
			'outline-implementer-agent',
			'web-search-researcher',
		].sort(),
	)
	generateAgents(true)
	for (const [name, agent] of Object.entries(agents)) {
		const text = readFileSync(new URL(`${name}.md`, agentsDir), 'utf8')
		assert.equal(text, renderAgent(name, agent))
		assert.equal(text.split(bodyMarker)[1], agent.prompt)
		const frontmatter = text.split('---')[1]
		assert.match(frontmatter, new RegExp(`\\nname: ${name}\\n`))
		assert.equal(JSON.parse(frontmatter.split('description: ')[1].split('\n')[0].trim()), agent.description)
		assert.doesNotMatch(frontmatter, /^model:/m)
	}
})

test('package exposes and ships agent paths', () => {
	const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
	assert.deepEqual(pkg['pi-subagents'].agents, ['./agents'])
	assert.ok(pkg.files.includes('agents'))
	for (const path of pkg['pi-subagents'].agents) assert.ok(existsSync(new URL(`../${path}`, import.meta.url)))
})

test('preserves canonical tool restrictions and web safeguards', () => {
	const expected = {
		'codebase-analyzer': 'read, grep, find, bash',
		'codebase-locator': 'grep, find, bash, read',
		'codebase-pattern-finder': 'grep, find, read, bash',
		'implementation-reviewer': 'read, grep, find, bash',
		'implementer-agent': 'read, edit, write, grep, find, bash',
		'outline-implementer-agent': 'read, edit, write, grep, find, bash',
		'web-search-researcher': 'web_search, fetch_content, read, grep, find, bash',
	}
	for (const [name, agent] of Object.entries(agents)) {
		assert.equal(renderAgent(name, agent).match(/^tools: (.*)$/m)?.[1], expected[name as keyof typeof expected])
	}
	const web = renderAgent('web-search-researcher', agents['web-search-researcher'])
	assert.match(web, /host must load providers/)
	assert.match(web, /Never broaden the allowlist or add mutation tools/)
	assert.match(web, /never fabricate searches, sources, or results/)
})
