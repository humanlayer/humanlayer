import { useAuth } from '@workos-inc/authkit-react'
import { useState } from 'react'

import { useMountEffect } from '@/hooks/useMountEffect'
import {
	identifyPostHogUser,
	initPostHog,
	isPostHogEnabled,
	onProjectsV2Flag,
	resetPostHogIdentity,
} from '@/integrations/posthog/posthog'
import {
	enableProjectsV2ForScope,
	subscribeToProjectsV2Assignment,
} from '@/integrations/posthog/projects-v2-assignment'
import { subscribeToWorkflowSelectorAssignment } from '@/integrations/posthog/workflow-selector-assignment'
import { useRiptideApi } from '@/orpc/client'

/**
 * Initializes PostHog once and identifies the authenticated WorkOS user.
 * Renders nothing.
 */
export function PostHogHandler() {
	const { user } = useAuth()

	if (!isPostHogEnabled() || !user) return null

	// Keyed by user ID so a different signed-in user re-identifies.
	return <PostHogIdentifiedSession key={user.id} userId={user.id} />
}

function PostHogIdentifiedSession({ userId }: { userId: string }) {
	const { organizationId } = useAuth()
	// Children mount their effects before this one runs, so the Projects V2 subscription waits
	// until the WorkOS identity is installed rather than reading flags for an anonymous person.
	const [identified, setIdentified] = useState(false)

	useMountEffect(() => {
		initPostHog()
		identifyPostHogUser(userId)
		setIdentified(true)

		const stopWorkflowSelector = subscribeToWorkflowSelectorAssignment(userId)
		return () => {
			stopWorkflowSelector()
		}
	})

	useMountEffect(() => () => resetPostHogIdentity())

	if (!identified || !organizationId) return null

	// Keyed like SettingsSyncHandler: the group is saved per organization, and switching
	// organizations does not remount this identified session.
	const scope = `${userId}:${organizationId}`
	return <ProjectsV2AssignmentSync key={scope} userId={userId} scope={scope} />
}

function ProjectsV2AssignmentSync({ userId, scope }: { userId: string; scope: string }) {
	const { client } = useRiptideApi()

	useMountEffect(() =>
		subscribeToProjectsV2Assignment({
			subscribe: (callback) => onProjectsV2Flag(userId, callback),
			save: (variant) => client.auth.user.settings.update({ projectsV2AssignedVariant: variant }),
			enable: () => enableProjectsV2ForScope(scope),
		}),
	)

	return null
}
