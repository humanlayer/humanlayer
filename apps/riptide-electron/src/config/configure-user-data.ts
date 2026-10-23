import { homedir } from 'node:os'
import { basename, join } from 'node:path'

import { app } from 'electron'

import { resolveChannel } from './electron-channel'

// Chromium binds the default storage partition to userData during startup, before
// the async config layer runs. Setting the path any later splits storage: getPath
// reports the configured profile while DOM storage reads and writes the default
// one. This module must stay the first import of the main process.
const channel = resolveChannel({
	isPackaged: app.isPackaged,
	productName: app.isPackaged ? basename(process.execPath) : app.getName(),
	environmentChannel: process.env.ELECTRON_CHANNEL,
})
const devstackId = process.env.DEVSTACK_ID
const profileDir = devstackId ? `${channel}-${devstackId}` : channel
const userDataPath =
	process.env.RIPTIDE_ELECTRON_USER_DATA_DIR ?? join(homedir(), '.humanlayer', 'electrondata', profileDir, 'userdata')
app.setPath('userData', userDataPath)

// Channel resolved synchronously at startup, for decisions that cannot wait for
// the async config layer: the renderer scheme registration below must run
// before Electron's ready event.
export const startupChannel = channel
