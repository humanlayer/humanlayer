import { useSession } from '@/minimalist/lib/data'

import { MinimalistTaskPage } from './TaskPage'
import { ThreadView } from './ThreadView'

export function MinimalistSessionPage({ sessionId }: { sessionId: string }) {
	const session = useSession(sessionId)
	return session?.task_id ? (
		<MinimalistTaskPage key={session.task_id} taskId={session.task_id} sessionId={sessionId} />
	) : (
		<ThreadView key={sessionId} sessionId={sessionId} />
	)
}
