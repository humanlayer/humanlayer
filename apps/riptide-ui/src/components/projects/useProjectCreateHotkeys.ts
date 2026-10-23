import { useHotkeys } from '@humanlayer/react-hotkeys-hook'

import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'

export function useProjectCreateHotkeys({
	enabled,
	onBack,
	onSubmit,
}: {
	enabled: boolean
	onBack: () => void
	onSubmit: () => void
}) {
	useHotkeys(
		'Escape',
		onBack,
		{
			scopes: [HOTKEY_SCOPES.PROJECT_CREATE_PAGE],
			enabled,
			enableOnFormTags: false,
			enableOnContentEditable: false,
			preventDefault: true,
		},
		[onBack],
	)
	useHotkeys(
		'mod+enter',
		(event) => {
			event.preventDefault()
			event.stopPropagation()
			onSubmit()
		},
		{
			scopes: [HOTKEY_SCOPES.PROJECT_CREATE_PAGE],
			enabled,
			enableOnFormTags: true,
			enableOnContentEditable: true,
		},
		[onSubmit],
	)
}
