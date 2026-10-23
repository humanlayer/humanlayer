import { dom } from '@humanlayer/vitest-config'
import { configDefaults, defineConfig, mergeConfig } from 'vitest/config'

export default mergeConfig(
	dom,
	defineConfig({
		test: {
			exclude: [...configDefaults.exclude, 'src/vscode-themes/themeClones/**'],
		},
	}),
)
