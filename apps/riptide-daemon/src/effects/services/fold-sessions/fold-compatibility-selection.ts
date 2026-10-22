import {
	loadCodexInstructions,
	loadGrokInstructions,
	renderCodexInstructions,
	renderGrokInstructions,
} from '@humanlayer/fold-agent'
import { Config, Effect, FileSystem, Path, Schema } from 'effect'

const FoldCompatibilityInput = Schema.Struct({
	provider: Schema.String,
	model: Schema.String,
	workingDirectory: Schema.String,
	homeDirectory: Schema.optional(Schema.String),
	codexHome: Schema.optional(Schema.String),
	grokHome: Schema.optional(Schema.String),
})
type FoldCompatibilityInput = typeof FoldCompatibilityInput.Type

export const loadFoldCompatibility = Effect.fn('fold.compatibility.load')(function* (input: FoldCompatibilityInput) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const canonicalCwd = yield* fs
		.realPath(input.workingDirectory)
		.pipe(Effect.orElseSucceed(() => path.resolve(input.workingDirectory)))
	const configuredHome =
		input.homeDirectory ??
		(yield* Config.String('HOME').pipe(
			Config.withDefault(canonicalCwd),
			Effect.orElseSucceed(() => canonicalCwd),
		))
	const home = path.resolve(configuredHome.length === 0 ? canonicalCwd : configuredHome)
	const projectRoot = yield* Effect.gen(function* () {
		let current = canonicalCwd
		while (true) {
			if (yield* fs.exists(path.join(current, '.git')).pipe(Effect.orElseSucceed(() => false))) return current
			const parent = path.dirname(current)
			if (parent === current) return canonicalCwd
			current = parent
		}
	})

	if (input.provider === 'xai') {
		const configuredGrokHome =
			input.grokHome ??
			(yield* Config.String('GROK_HOME').pipe(
				Config.withDefault(''),
				Effect.orElseSucceed(() => ''),
			))
		const grokHome = path.resolve(configuredGrokHome.length > 0 ? configuredGrokHome : path.join(home, '.grok'))
		const sources = yield* loadGrokInstructions({
			cwd: canonicalCwd,
			home,
			grokHome,
			projectRoot,
		})
		return {
			instructionBlock: renderGrokInstructions(sources),
			projectRoot,
			home,
			grokHome,
		}
	}

	if (input.provider !== 'codex') {
		return { instructionBlock: null, projectRoot, home, grokHome: null }
	}

	const configuredCodexHome =
		input.codexHome ??
		(yield* Config.String('CODEX_HOME').pipe(
			Config.withDefault(''),
			Effect.orElseSucceed(() => ''),
		))
	const codexHome = path.resolve(configuredCodexHome.length > 0 ? configuredCodexHome : path.join(home, '.codex'))
	const sources = yield* loadCodexInstructions({ cwd: canonicalCwd, home, codexHome })
	return {
		instructionBlock: renderCodexInstructions(sources),
		projectRoot,
		home,
		grokHome: null,
	}
})
