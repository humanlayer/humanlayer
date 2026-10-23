import process from 'node:process'

import { query } from '@anthropic-ai/claude-agent-sdk'
import z from 'zod/v4'

console.log('querying...')

const { $schema: _, ...schema } = z.toJSONSchema(
	z.object({
		funding: z.string().describe('Amount and sources of company funding'),
		executives: z.array(z.string()).describe('Executives of the company'),
		briefDescription: z.string().describe('A brief description of what the company does'),
	}),
)
const result = query({
	prompt: 'can you research humanlayer and tell me what you can find about it? ',
	options: {
		model: 'sonnet',
		allowDangerouslySkipPermissions: true,
		permissionMode: 'bypassPermissions',
		env: {
			...process.env,
			ANTHROPIC_BASE_URL: 'https://gateway.ai.cloudflare.com/v1/de6f5660d148605859f2db08488ed418/kyle/anthropic',
		},
		systemPrompt: {
			type: 'preset',
			preset: 'claude_code',
			append: `When you launch one or more sub-agents with the Task tool, you MUST NOT launch it in the background. 
            You MUST NOT specify the 'run_in_background' option, or the 'resume' option. 
            You MUST NOT specify the 'model' unless the user explicitly asks you to.  
            Obeying these instructions is CRITICAL to ensure that the task tool performs properly.
            `,
		},
		disallowedTools: ['AskUserQuestion', 'ExitPlanMode', 'EnterPlanMode', 'SlashCommand', 'Skill', 'TaskOutput'],
		outputFormat: {
			type: 'json_schema',
			schema: schema,
		},
	},
})

for await (const message of result) {
	if (message.type === 'result') {
		console.log('\n====================================================')

		if (message.subtype === 'success') {
			console.log(message)
			console.log('\n\n', message.structured_output ?? 'no structured output')
		} else {
			console.error(message)
		}
	} else {
		console.log(message)
	}
}
