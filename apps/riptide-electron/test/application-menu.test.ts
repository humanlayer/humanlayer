import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, test, vi } from 'vitest'

import { applicationMenuTemplate } from '../src/application-menu'

function submenu(items: MenuItemConstructorOptions[], label: string): MenuItemConstructorOptions[] {
	const item = items.find((candidate) => candidate.label === label)
	if (!item || !Array.isArray(item.submenu)) throw new Error(`Missing ${label} menu`)
	return item.submenu
}

function hasRole(items: MenuItemConstructorOptions[], role: MenuItemConstructorOptions['role']): boolean {
	return items.some((item) => item.role === role || (Array.isArray(item.submenu) && hasRole(item.submenu, role)))
}

describe('application menu', () => {
	test('leaves Command+W available for the renderer to close a workspace tab', () => {
		const onCloseWindow = vi.fn()
		const template = applicationMenuTemplate({
			appName: 'Riptide',
			isMac: true,
			onNewWindow: vi.fn(),
			onCloseWindow,
		})

		const fileMenu = submenu(template, 'File')
		const closeWindow = fileMenu.find((item) => item.label === 'Close Window')

		expect(hasRole(template, 'close')).toBe(false)
		expect(hasRole(template, 'windowMenu')).toBe(false)
		expect(closeWindow?.accelerator).toBe('Shift+CmdOrCtrl+W')
		closeWindow?.click?.({} as never, undefined, {} as never)
		expect(onCloseWindow).toHaveBeenCalledOnce()
	})
})
