import { electronRpcPortChannel, electronRpcPortMessage } from '@humanlayer/riptide-electron-rpc/protocol'
import { contextBridge, ipcRenderer } from 'electron'

import { isTrustedRenderer } from './preload-trust'

function rendererArgument(name: string): string | undefined {
	const prefix = `--${name}=`
	const argument = process.argv.find((value) => value.startsWith(prefix))
	return argument?.slice(prefix.length)
}

function rendererWindowRole(): 'main' | 'additional' {
	return rendererArgument('riptide-window-role') === 'additional' ? 'additional' : 'main'
}

if (isTrustedRenderer({ location: window.location, rendererUrl: rendererArgument('riptide-renderer-url') })) {
	contextBridge.exposeInMainWorld(
		'__RIPTIDE_ELECTRON__',
		Object.freeze({
			version: 1,
			// Passed by the window service so the bridge reports the mode the main
			// process actually resolved, instead of re-deriving it from env.
			daemonMode: rendererArgument('riptide-daemon-mode') ?? 'external',
			windowRole: rendererWindowRole(),
		}),
	)

	ipcRenderer.on(electronRpcPortChannel, (event) => {
		const port = event.ports[0]
		if (port === undefined) return
		window.postMessage(electronRpcPortMessage, '*', [port])
	})
}
