export function shouldShowLaunchDaemonAction({
	isHostOffline,
	canLaunchLocalDaemon,
	onLaunchDaemon,
}: {
	isHostOffline: boolean
	canLaunchLocalDaemon: boolean
	onLaunchDaemon?: () => void
}): boolean {
	return isHostOffline && canLaunchLocalDaemon && Boolean(onLaunchDaemon)
}

const composerInteractiveTargetSelector = [
	'button',
	'input',
	'select',
	'textarea',
	'a',
	'[role="button"]',
	'[role="menuitem"]',
	'[role="menuitemradio"]',
	'[role="menuitemcheckbox"]',
].join(', ')

export function shouldFocusComposerFromPointerTarget(target: EventTarget | null): boolean {
	return !(target instanceof Element && target.closest(composerInteractiveTargetSelector))
}
