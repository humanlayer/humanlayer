import { useIsMutating, useMutation } from '@tanstack/react-query'
import { useRef } from 'react'

import { useAgentConnectionsStore } from '@/hooks/stores/agentConnectionsStore'
import { useMountEffect } from '@/hooks/useMountEffect'
import { type CodingAgent, probeCodingAgent } from '@/integrations/desktop/diagnostics'

export function useAgentProbes(onAgentReady: () => void) {
	const connections = useAgentConnectionsStore((state) => state.agentConnections)
	const recordProbeResult = useAgentConnectionsStore((state) => state.recordProbeResult)
	const mountedProbeStarted = useRef(false)

	const claudeProbe = useMutation({
		mutationKey: ['coding-agent-probe', 'claude'] as const,
		mutationFn: (path: string | null) => probeCodingAgent({ agent: 'claude', preferredPath: path }),
		networkMode: 'always',
		retry: false,
		onSuccess: recordProbeResult,
	})
	const codexProbe = useMutation({
		mutationKey: ['coding-agent-probe', 'codex'] as const,
		mutationFn: (path: string | null) => probeCodingAgent({ agent: 'codex', preferredPath: path }),
		networkMode: 'always',
		retry: false,
		onSuccess: recordProbeResult,
	})

	const isClaudeChecking = useIsMutating({ mutationKey: ['coding-agent-probe', 'claude'] }) > 0
	const isCodexChecking = useIsMutating({ mutationKey: ['coding-agent-probe', 'codex'] }) > 0

	const checkAgent = (agent: CodingAgent, path: string | null) => {
		const probe = agent === 'claude' ? claudeProbe : codexProbe
		if (probe.isPending) return
		probe.mutate(path, {
			onSuccess: (result) => {
				if (result.status === 'ready') onAgentReady()
			},
		})
	}

	useMountEffect(() => {
		if (mountedProbeStarted.current) return
		mountedProbeStarted.current = true
		for (const entry of connections) {
			if (entry.status === 'not_checked') checkAgent(entry.agent, null)
		}
	})

	return { connections, claudeProbe, codexProbe, isClaudeChecking, isCodexChecking, checkAgent }
}
