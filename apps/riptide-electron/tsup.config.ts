import { defineConfig } from 'tsup'

export default defineConfig({
	entry: ['src/main.ts', 'src/preload.ts'],
	format: ['cjs'],
	platform: 'node',
	external: ['electron', 'node-pty', 'electron-updater'],
	noExternal: ['@humanlayer/riptide-electron-rpc', '@humanlayer/schemas'],
	outDir: 'dist',
	sourcemap: true,
	clean: true,
	// Baked in so packaged apps don't read it from the user's shell. Unset means Sentry stays off.
	env: { RIPTIDE_ELECTRON_SENTRY_DSN: process.env.RIPTIDE_ELECTRON_SENTRY_DSN ?? '' },
})
