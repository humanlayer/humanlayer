import { describe, expect, it } from 'vitest'

import { renderSessionInformation } from '@/lib/session-information'

const session = {
	id: 'session-1',
	host_id: 'host-1',
	coding_agent: 'claude' as const,
	provider: 'anthropic',
	model: 'opus',
	effort: 'high',
	permissions_mode: 'bypass' as const,
}

describe('renderSessionInformation', () => {
	it('renders session, task, workspace, host, and agent settings', () => {
		expect(renderSessionInformation(session, { id: 'task-1', slug: 'my-task', workspace_id: 'workspace-1' }))
			.toBe(`<humanlayer_session>
Session ID: session-1
Task ID: task-1
Task slug: my-task
Workspace ID: workspace-1
Host ID: host-1
Coding agent: claude
Provider: anthropic
Model: opus
Effort: high
Permissions mode: bypass
</humanlayer_session>`)
	})

	it('marks missing task values as none', () => {
		const block = renderSessionInformation({ ...session, effort: null }, undefined)
		expect(block).toContain('Task ID: none\nTask slug: none\nWorkspace ID: none')
		expect(block).toContain('Effort: none')
	})
})
