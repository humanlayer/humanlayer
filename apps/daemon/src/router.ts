import { daemonRouterContract } from '@codelayer/contracts/daemon'
import { implement } from '@orpc/server'

export const daemonRpcServer = implement(daemonRouterContract)

// Example of implementing a contract defined in @codelayer/contracts/daemon (packages/contracts/src/daemon)
daemonRpcServer.sessions.listSessionContract.handler(({ input }) => {
	return { count: 0, sessions: [] }
})
