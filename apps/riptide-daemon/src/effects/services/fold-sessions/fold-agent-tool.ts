import type { FoldModel, FoldTool, HookConfig } from '@humanlayer/fold-core'
import { defineForkAgent, defineSubagent, subagentTool } from '@humanlayer/fold-core'

import { codebaseAnalyzer } from '../../../agents/claudecode/agents/codebase-analyzer'
import { codebaseLocator } from '../../../agents/claudecode/agents/codebase-locator'
import { codebasePatternFinder } from '../../../agents/claudecode/agents/codebase-pattern-finder'
import { implementerAgent } from '../../../agents/claudecode/agents/implementer-agent'
import { outlineImplementerAgent } from '../../../agents/claudecode/agents/outline-implementer-agent'
import { webSearchResearcher } from '../../../agents/claudecode/agents/web-search-researcher'
import type { FoldHostServices } from './fold-host-services'

type MakeFoldAgentDelegationOptions = {
	readonly model: FoldModel<FoldHostServices>
	readonly subagentModel?: FoldModel<FoldHostServices>
	readonly codingTools: ReadonlyArray<FoldTool<FoldHostServices>>
	readonly sharedSkillTool: FoldTool<FoldHostServices>
	readonly productTools: ReadonlyArray<FoldTool<FoldHostServices>>
	readonly hooks: HookConfig
	readonly systemPrompt: string
}

export const makeFoldAgentDelegation = ({
	model,
	subagentModel = model,
	codingTools,
	sharedSkillTool,
	productTools,
	hooks,
	systemPrompt,
}: MakeFoldAgentDelegationOptions) => {
	const toolsNamed = (...names: ReadonlyArray<string>) => codingTools.filter((tool) => names.includes(tool.name))
	const productCapabilities = (tools: ReadonlyArray<FoldTool<FoldHostServices>>) => [
		...tools,
		sharedSkillTool,
		...productTools,
	]
	const specialist = (
		name: string,
		description: string,
		prompt: string,
		tools: ReadonlyArray<FoldTool<FoldHostServices>>,
		specialistModel: FoldModel<FoldHostServices> = subagentModel,
	) =>
		defineSubagent({
			name,
			description,
			model: specialistModel,
			systemPrompt: [systemPrompt, prompt],
			tools: productCapabilities(tools),
			hooks,
		})
	const specialists = [
		defineSubagent({
			name: 'general-purpose',
			description:
				'A general-purpose coding agent with broad capabilities that can handle most tasks, including coding, debugging, and research.',
			model: subagentModel,
			systemPrompt,
			tools: productCapabilities(codingTools),
			hooks,
		}),
		defineSubagent({
			name: 'bash',
			description: 'A specialized sub-agent for bash command execution. Delegate shell-heavy tasks here.',
			model: subagentModel,
			systemPrompt,
			tools: productCapabilities(toolsNamed('bash', 'read')),
			hooks,
		}),
		specialist('rpi:implementer-agent', implementerAgent.description, implementerAgent.prompt, codingTools),
		specialist(
			'rpi:outline-implementer-agent',
			outlineImplementerAgent.description,
			outlineImplementerAgent.prompt,
			codingTools,
			model,
		),
		specialist(
			'rpi:codebase-locator',
			codebaseLocator.description,
			codebaseLocator.prompt,
			toolsNamed('bash', 'read'),
		),
		specialist(
			'rpi:codebase-analyzer',
			codebaseAnalyzer.description,
			codebaseAnalyzer.prompt,
			toolsNamed('bash', 'read'),
		),
		specialist(
			'rpi:codebase-pattern-finder',
			codebasePatternFinder.description,
			codebasePatternFinder.prompt,
			toolsNamed('bash', 'read'),
		),
		specialist(
			'web-search-researcher',
			webSearchResearcher.description,
			webSearchResearcher.prompt,
			toolsNamed('bash', 'read', 'web_fetch', 'web_search'),
		),
	]
	const leafFork = defineForkAgent({ id: 'humanlayer-fork-leaf', tools: productCapabilities(codingTools) })
	const childAgentTool = subagentTool(specialists, { forkAgent: leafFork })
	const delegatingFork = defineForkAgent({
		id: 'humanlayer-fork-delegating',
		tools: [...productCapabilities(codingTools), childAgentTool],
	})
	return {
		rootAgentTool: subagentTool(specialists, { forkAgent: delegatingFork }),
		specialists,
		leafFork,
		delegatingFork,
	}
}
