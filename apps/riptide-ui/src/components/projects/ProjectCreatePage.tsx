import { useNavigate } from '@tanstack/react-router'
import { useRef, useState } from 'react'

import { useSettingsStore } from '@/hooks/stores/settingsStore'

import { ProjectCreatorWired } from './ProjectCreatorWired'
import { useProjectCreateHotkeys } from './useProjectCreateHotkeys'

export function ProjectCreatePage({ onboarding = false }: { readonly onboarding?: boolean }) {
	const enabled = useSettingsStore((state) => state.projectsV2Enabled)
	const navigate = useNavigate()
	const formRef = useRef<HTMLFormElement>(null)
	const [submitting, setSubmitting] = useState(false)
	const goBack = () => {
		void navigate({ to: '/settings/projects', replace: true })
	}

	useProjectCreateHotkeys({
		enabled: !submitting,
		onBack: () => {
			goBack()
		},
		onSubmit: () => {
			if (enabled) formRef.current?.requestSubmit()
		},
	})

	if (!enabled) {
		return <p className="text-sm text-muted-foreground">Enable Projects V2 in Experiments to create projects.</p>
	}

	return (
		<div className="space-y-4">
			<p className="text-sm leading-relaxed text-muted-foreground">
				A project groups repositories and their setup instructions. Each task starts in its own workspace,
				created from this project.
			</p>
			<ProjectCreatorWired
				formRef={formRef}
				onCancel={goBack}
				onSubmittingChange={setSubmitting}
				onCreated={(project) => {
					if (onboarding) {
						void navigate({
							to: '/tasks/new',
							search: { workflow: 'freeform', projectId: project.id },
							replace: true,
						})
						return
					}
					goBack()
				}}
			/>
		</div>
	)
}
