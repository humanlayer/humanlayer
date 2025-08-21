import { defineConfig } from 'tsup'
import { readFileSync } from 'fs'
import { join } from 'path'

// Read version from package.json at build time
const packageJson = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf-8'))

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'es2020',
  clean: true,
  env: {
    PACKAGE_VERSION: packageJson.version,
  },
})
