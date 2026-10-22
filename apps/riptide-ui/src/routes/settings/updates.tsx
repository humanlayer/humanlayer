import { createFileRoute } from '@tanstack/react-router'
import { useEffect } from 'react'

import { UpdatesSettingsSection } from '@/components/settings/UpdatesSettingsSection'
import { useUpdate } from '@/hooks/use-update'

export const Route = createFileRoute('/settings/updates')({
	// `?updateCheck=true` (from the "Check for updates" command) checks once on arrival.
	validateSearch: (search: Record<string, unknown>): { updateCheck?: true } =>
		search.updateCheck === true || search.updateCheck === 'true' ? { updateCheck: true } : {},
	component: UpdatesSettingsRoute,
})

/** Both interfaces render this route, so the check request is consumed here once for each. */
function UpdatesSettingsRoute() {
	useRequestedUpdateCheck()
	return <UpdatesSettingsSection />
}

/** Runs the check `?updateCheck=true` asks for, then drops the param so a reload or Back doesn't check again. */
function useRequestedUpdateCheck() {
	const { updateCheck } = Route.useSearch()
	const navigate = Route.useNavigate()
	const { checkNow } = useUpdate()
	useEffect(() => {
		if (!updateCheck) return
		void checkNow()
		void navigate({ search: ({ updateCheck: _consumed, ...rest }) => rest, replace: true })
	}, [updateCheck, checkNow, navigate])
}
