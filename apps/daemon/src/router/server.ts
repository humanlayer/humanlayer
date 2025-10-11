import { daemonRouterContract } from '@codelayer/contracts/daemon'
import { implement } from '@orpc/server'

export const daemonServer = implement(daemonRouterContract)
