import { daemonServer } from './server'
import { listSessions } from './sessions'

// This builds the final router based onthe imported server, and the implementations that we added
export const router = daemonServer.router({
	sessions: {
		list: listSessions,
	},
})
