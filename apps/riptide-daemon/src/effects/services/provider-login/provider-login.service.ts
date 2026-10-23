import { Context, type Effect } from 'effect'

export interface ProviderLoginService {
	/** Consume the host-scoped provider login request stream until the enclosing scope closes. */
	readonly run: Effect.Effect<void>
}

export class ProviderLogin extends Context.Service<ProviderLogin, ProviderLoginService>()('ProviderLogin') {}
