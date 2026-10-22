import type { MenuItemConstructorOptions } from 'electron'

type ApplicationMenuOptions = {
	appName: string
	isMac: boolean
	onNewWindow: () => void
	onCloseWindow: () => void
}

export function applicationMenuTemplate({
	appName,
	isMac,
	onNewWindow,
	onCloseWindow,
}: ApplicationMenuOptions): MenuItemConstructorOptions[] {
	const windowMenu: MenuItemConstructorOptions[] = [{ role: 'minimize' }, { role: 'zoom' }]
	if (isMac) windowMenu.push({ type: 'separator' }, { role: 'front' })

	return [
		{
			label: appName,
			submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }],
		},
		{
			label: 'File',
			submenu: [
				{
					label: 'New Window',
					accelerator: 'CmdOrCtrl+N',
					click: onNewWindow,
				},
				{ type: 'separator' },
				{
					label: 'Close Window',
					accelerator: 'Shift+CmdOrCtrl+W',
					click: onCloseWindow,
				},
			],
		},
		{ role: 'editMenu' },
		{ role: 'viewMenu' },
		{ label: 'Window', submenu: windowMenu },
	]
}
