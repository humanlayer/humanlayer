import { daemonServer } from './server'

// implement the sessions.list method on the router and export it
export const listSessions = daemonServer.sessions.list.handler(({ input }) => {
	return { count: 0, sessions: [] }
})
