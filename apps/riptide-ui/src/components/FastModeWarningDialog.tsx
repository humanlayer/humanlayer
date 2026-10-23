import { useHotkeys } from '@humanlayer/react-hotkeys-hook'
import { useCallback, useState } from 'react'

import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'

import { FastModeWarningDialogPure, type FastModeWarningDialogPureProps } from './FastModeWarningDialogPure'

export type WiredFastModeWarningDialogProps = Omit<
	FastModeWarningDialogPureProps,
	'dontAskAgain' | 'onDontAskAgainChange'
>

export function WiredFastModeWarningDialog(props: WiredFastModeWarningDialogProps) {
	const { open, onOpenChange, onConfirm } = props
	const [dontAskAgain, setDontAskAgain] = useState(false)

	const handleConfirm = useCallback(() => {
		onConfirm(dontAskAgain)
		setDontAskAgain(false)
		onOpenChange(false)
	}, [dontAskAgain, onConfirm, onOpenChange])
	const handleEscape = useCallback(() => {
		setDontAskAgain(false)
		onOpenChange(false)
	}, [onOpenChange])

	useHotkeys(
		'mod+enter',
		(event) => {
			event.preventDefault()
			event.stopPropagation()
			handleConfirm()
		},
		{ enabled: open, enableOnFormTags: true, scopes: [HOTKEY_SCOPES.FAST_MODE_WARNING_DIALOG] },
		[open, handleConfirm],
	)
	useHotkeys(
		'escape',
		(event) => {
			event.preventDefault()
			event.stopPropagation()
			handleEscape()
		},
		{ enabled: open, enableOnFormTags: true, scopes: [HOTKEY_SCOPES.FAST_MODE_WARNING_DIALOG] },
		[open, handleEscape],
	)

	return (
		<HotkeyScopeBoundary
			scope={HOTKEY_SCOPES.FAST_MODE_WARNING_DIALOG}
			isActive={open}
			rootScopeDisabled
			componentName="FastModeWarningDialog"
		>
			<FastModeWarningDialogPure {...props} dontAskAgain={dontAskAgain} onDontAskAgainChange={setDontAskAgain} />
		</HotkeyScopeBoundary>
	)
}

export const FastModeWarningDialog = WiredFastModeWarningDialog
