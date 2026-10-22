import type { AutomationDaemonResult } from '@/lifecycle/automation-lifecycle'

// Shared shutdown exit code - isolated in its own module to avoid circular dependencies
// between daemon.ts and orpc/client.ts
let shutdownExitCode = 0

export function setShutdownExitCode(code: number) {
	shutdownExitCode = code
}

export function getShutdownExitCode(): number {
	return shutdownExitCode
}

export function getAutomationResultExitCode(result: AutomationDaemonResult): number {
	if (result.completionReason === 'interrupted') return 1
	return result.finalStatus === 'ready_for_input' ? 0 : 1
}
