import { Context, Data, Effect, Layer } from 'effect'

export class ProcessRunnerError extends Data.TaggedError('ProcessRunnerError')<{
	readonly command: string
	readonly exitCode?: number
	readonly stderr?: string
	readonly cause?: unknown
}> {}

export type ProcessOutput = {
	readonly stdout: string
	readonly stderr: string
}

export interface ProcessRunnerShape {
	readonly run: (input: {
		readonly command: string
		readonly args: readonly string[]
		readonly cwd: string
		readonly env?: Readonly<Record<string, string>>
		readonly inheritOutput?: boolean
	}) => Effect.Effect<ProcessOutput, ProcessRunnerError>
}

export class ProcessRunner extends Context.Service<ProcessRunner, ProcessRunnerShape>()('devstack/ProcessRunner') {}

export const ProcessRunnerLive = Layer.succeed(ProcessRunner, {
	run: (input) =>
		Effect.tryPromise({
			try: async () => {
				const child = Bun.spawn([input.command, ...input.args], {
					cwd: input.cwd,
					env: input.env ? { ...process.env, ...input.env } : process.env,
					stdout: input.inheritOutput ? 'inherit' : 'pipe',
					stderr: input.inheritOutput ? 'inherit' : 'pipe',
				})
				const [exitCode, stdout, stderr] = await Promise.all([
					child.exited,
					input.inheritOutput ? Promise.resolve('') : new Response(child.stdout).text(),
					input.inheritOutput ? Promise.resolve('') : new Response(child.stderr).text(),
				])
				if (exitCode !== 0) throw new Error(stderr.trim() || `${input.command} exited with code ${exitCode}`)
				return { stdout, stderr }
			},
			catch: (cause) => new ProcessRunnerError({ command: input.command, cause }),
		}),
} satisfies ProcessRunnerShape)
