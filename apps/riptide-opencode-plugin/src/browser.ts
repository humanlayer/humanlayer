// The TUI half's own helpers. The TUI half ships as source, beside the bundled server half, so it
// imports nothing from the workspace packages at run time.

import { spawn } from 'node:child_process'

/** Opens a URL in the default browser. Best effort. */
export function openBrowser(url: string): void {
	const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'linux' ? 'xdg-open' : undefined
	if (!cmd) return
	try {
		const child = spawn(cmd, [url], { detached: true, stdio: 'ignore' })
		child.on('error', () => {})
		child.unref()
	} catch {
		// best effort only
	}
}

/** Puts text on the system clipboard. Best effort: false when no clipboard tool ran. */
export function copy(text: string): Promise<boolean> {
	const cmd =
		process.platform === 'darwin'
			? ['pbcopy']
			: process.env.WAYLAND_DISPLAY
				? ['wl-copy']
				: ['xclip', '-selection', 'clipboard']
	return new Promise((resolve) => {
		const [bin = '', ...args] = cmd
		const child = spawn(bin, args, { stdio: ['pipe', 'ignore', 'ignore'] })
		child.on('error', () => resolve(false))
		child.on('close', (code) => resolve(code === 0))
		child.stdin.end(text)
	})
}

export function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err)
}
