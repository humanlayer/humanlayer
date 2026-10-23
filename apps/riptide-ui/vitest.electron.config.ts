import { defineConfig } from 'vitest/config'

// Electron CDP checks use a real WebSocket, not the DOM test environment's
// browser WebSocket (which sends an Origin that Electron correctly rejects).
export default defineConfig({
	test: {
		environment: 'node',
		include: ['test/components/diffs/diff-card-geometry.electron.test.ts'],
	},
})
