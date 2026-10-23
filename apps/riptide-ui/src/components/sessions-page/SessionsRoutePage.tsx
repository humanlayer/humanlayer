import { useIsMobile } from '@humanlayer/ui/hooks/use-mobile'

import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { SessionsPage } from '@/components/sessions-page/SessionsPage'
import type { SessionsRouteTab, SessionsRouteTo } from '@/components/sessions-page/sessionsRoute'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { WiredMobileTasksListPage } from '@/mobile/pages/wired/WiredMobileTasksListPage'

export function SessionsRoutePage({ tab, routeTo }: { tab: SessionsRouteTab; routeTo: SessionsRouteTo }) {
	const isMobile = useIsMobile()
	if (isMobile) return <WiredMobileTasksListPage tab={tab} routeTo={routeTo} />
	return (
		<HotkeyScopeBoundary scope={HOTKEY_SCOPES.SESSIONS_LIST} componentName="SessionsListPage">
			<div className="flex flex-col h-full overflow-hidden">
				<SessionsPage tab={tab} routeTo={routeTo} />
			</div>
		</HotkeyScopeBoundary>
	)
}
