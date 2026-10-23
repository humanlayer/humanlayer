import { Context, Effect, Layer, Ref } from 'effect'

export interface InterruptStateSnapshot {
	wasInterrupted: boolean
	resumeWithPrompt: string | null
}

export interface InterruptStateService {
	get: Effect.Effect<InterruptStateSnapshot>
	wasInterrupted: Effect.Effect<boolean>
	resumeWithPrompt: Effect.Effect<string | null>
	markInterrupted: (resumeWithPrompt: string | null) => Effect.Effect<void>
}

export class InterruptState extends Context.Service<InterruptState, InterruptStateService>()('InterruptState') {}

export const makeInterruptState = Effect.gen(function* () {
	const ref = yield* Ref.make<InterruptStateSnapshot>({ wasInterrupted: false, resumeWithPrompt: null })

	return {
		get: Ref.get(ref),
		wasInterrupted: Ref.get(ref).pipe(Effect.map((state) => state.wasInterrupted)),
		resumeWithPrompt: Ref.get(ref).pipe(Effect.map((state) => state.resumeWithPrompt)),
		markInterrupted: (resumeWithPrompt) => Ref.set(ref, { wasInterrupted: true, resumeWithPrompt }),
	} satisfies InterruptStateService
})

export const InterruptStateLive = Layer.effect(InterruptState, makeInterruptState)

export const createInterruptState = () => Effect.runPromise(InterruptState.pipe(Effect.provide(InterruptStateLive)))
