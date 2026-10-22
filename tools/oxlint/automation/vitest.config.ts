import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		include: ['tools/oxlint/automation/**/*.test.ts'],
	},
})
