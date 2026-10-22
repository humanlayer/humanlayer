import { Effect, Layer } from 'effect'

import { SessionRunRegistryLive } from '../../src/effects/services/session-runs/session-run-registry'
import { WorkspaceSessionLaunchActors } from '../../src/effects/services/workspace-session-launch/workspace-session-launch-actors.service'
import { WorkspaceSessionRunner } from '../../src/effects/services/workspace-session-launch/workspace-session-runner.service'
import { makeMockDaemonApiLayer } from '../mocks/daemon-api.mock'

/**
 * Satisfies the subscription program's launch requirements for tests that never route a V2
 * session. The run registry is real, because legacy launches register through it too; every V2
 * call dies loudly so a test that unexpectedly reaches V2 routing fails by name.
 */
export const UnusedWorkspaceSessionLaunchActorsLive = Layer.mergeAll(
	SessionRunRegistryLive,
	makeMockDaemonApiLayer(),
	Layer.succeed(WorkspaceSessionRunner, {
		handOffReadySession: () => Effect.die('unused WorkspaceSessionRunner.handOffReadySession'),
	}),
	Layer.succeed(WorkspaceSessionLaunchActors, {
		ensureLaunchActor: () => Effect.die('unused WorkspaceSessionLaunchActors.ensureLaunchActor'),
		waitForLaunchActorExit: () => Effect.die('unused WorkspaceSessionLaunchActors.waitForLaunchActorExit'),
		waitForLaunchActorState: () => Effect.die('unused WorkspaceSessionLaunchActors.waitForLaunchActorState'),
	}),
)
