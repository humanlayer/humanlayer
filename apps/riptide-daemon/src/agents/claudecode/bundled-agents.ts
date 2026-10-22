/**
 * Bundled sub-agents for Claude Code sessions.
 * Agents are passed directly to the SDK's `options.agents` configuration.
 */
import { codebaseAnalyzer } from './agents/codebase-analyzer'
import { codebaseLocator } from './agents/codebase-locator'
import { codebasePatternFinder } from './agents/codebase-pattern-finder'
import { implementationReviewer } from './agents/implementation-reviewer'
import { implementerAgent } from './agents/implementer-agent'
import { outlineImplementerAgent } from './agents/outline-implementer-agent'
import { webSearchResearcher } from './agents/web-search-researcher'
import type { EffectiveSettings } from './effective-settings'

export type { AgentDefinition } from './agents/types'

/**
 * Bundled agents keyed by their subagent_type name.
 */
export const bundledAgents = {
	'rpi:codebase-analyzer': codebaseAnalyzer,
	'rpi:codebase-locator': codebaseLocator,
	'rpi:codebase-pattern-finder': codebasePatternFinder,
	'rpi:implementation-reviewer': implementationReviewer,
	'rpi:implementer-agent': implementerAgent,
	'rpi:outline-implementer-agent': outlineImplementerAgent,
	'rpi:web-search-researcher': webSearchResearcher,
}

/**
 * Returns the bundled agents registry with research agent model overridden
 * based on effective user settings. When haikuResearchSubagentsEnabled is true,
 * codebase-analyzer, codebase-locator, and codebase-pattern-finder use 'haiku'
 * instead of 'sonnet'.
 */
export function getBundledAgents(settings: EffectiveSettings) {
	const researchModel = settings.haikuResearchSubagentsEnabled ? 'haiku' : 'sonnet'
	return {
		...bundledAgents,
		'rpi:codebase-analyzer': { ...codebaseAnalyzer, model: researchModel },
		'rpi:codebase-locator': { ...codebaseLocator, model: researchModel },
		'rpi:codebase-pattern-finder': { ...codebasePatternFinder, model: researchModel },
	}
}
