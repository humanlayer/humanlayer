import { RuleTester } from 'oxlint/plugins-dev'

import { noCascadingLayerProvideRule } from './rules/no-cascading-layer-provide.ts'
import { noNestedLayerProvideRule } from './rules/no-nested-layer-provide.ts'

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: 'ts' } } })

tester.run('automation/no-cascading-layer-provide', noCascadingLayerProvideRule, {
	valid: [
		'import { Layer } from "effect"; ServiceLive.pipe(Layer.provide(Layer.mergeAll(RepositoryLive, ClientLive)));',
		'import { Layer } from "effect"; const ConfiguredRuntime = RuntimeLive.pipe(Layer.provide(ConfigLive)); AppLive.pipe(Layer.provide(ConfiguredRuntime));',
		'import { Layer as EffectLayer } from "effect"; ServiceLive.pipe(EffectLayer.provide(Layer.mergeAll(RepositoryLive, ClientLive)));',
		'const Layer = { provide: (layer: unknown) => layer }; ServiceLive.pipe(Layer.provide(RepositoryLive), Layer.provide(ClientLive));',
	],
	invalid: [
		{
			code: 'import { Layer } from "effect"; ServiceLive.pipe(Layer.provide(RepositoryLive), Layer.provide(ClientLive));',
			errors: [{ messageId: 'cascadingProvide' }],
		},
		{
			code: 'import { Layer } from "effect"; ServiceLive.pipe(Layer.provide(RepositoryLive), Layer.provideMerge(ClientLive));',
			errors: [{ messageId: 'cascadingProvide' }],
		},
		{
			code: 'import * as EffectLayer from "effect/Layer"; ServiceLive.pipe(EffectLayer.provide(RepositoryLive), EffectLayer.provide(ClientLive));',
			errors: [{ messageId: 'cascadingProvide' }],
		},
		{
			code: 'import EffectLayer from "effect/Layer"; ServiceLive.pipe(EffectLayer.provide(RepositoryLive), EffectLayer.provide(ClientLive));',
			errors: [{ messageId: 'cascadingProvide' }],
		},
	],
})

tester.run('automation/no-nested-layer-provide', noNestedLayerProvideRule, {
	valid: [
		'import { Layer } from "effect"; Layer.provide(AppLive, DependenciesLive);',
		'import { Layer } from "effect"; Layer.provideMerge(AppLive, DependenciesLive);',
		'import { Layer } from "effect"; const ConfiguredServiceLive = ServiceLive.pipe(Layer.provide(DependenciesLive)); Layer.provide(AppLive, ConfiguredServiceLive);',
		'import { Layer } from "effect"; Layer.provide(AppLive, ServiceLive.pipe(Layer.orDie));',
		'import { Effect, Layer } from "effect"; Layer.provide(AppLive, Layer.mergeAll(DependenciesLive, Layer.unwrap(Effect.sync(() => Layer.provide(IsolatedLive, IsolatedDependenciesLive)))));',
		'const Layer = { provide: (layer: unknown) => layer }; Layer.provide(AppLive, Layer.provide(ServiceLive, DependenciesLive));',
	],
	invalid: [
		{
			code: 'import { Layer } from "effect"; Layer.provide(AppLive, Layer.provide(ServiceLive, DependenciesLive));',
			errors: [{ messageId: 'nestedProvide' }],
		},
		{
			code: 'import { Layer } from "effect"; AppLive.pipe(Layer.provide(ServiceLive.pipe(Layer.provide(DependenciesLive))));',
			errors: [{ messageId: 'nestedProvide' }],
		},
		{
			code: 'import { Layer } from "effect"; AppLive.pipe(Layer.provideMerge(ServiceLive.pipe(Layer.provideMerge(DependenciesLive))));',
			errors: [{ messageId: 'nestedProvide' }],
		},
		{
			code: 'import { Layer } from "effect"; Layer.provideMerge(AppLive, ServiceLive.pipe(Layer.provide(DependenciesLive)));',
			errors: [{ messageId: 'nestedProvide' }],
		},
		{
			code: 'import { Layer } from "effect"; Layer.provide(AppLive, Layer.merge(ServiceLive.pipe(Layer.provide(ServiceDependenciesLive)), RepositoryLive));',
			errors: [{ messageId: 'nestedProvide' }],
		},
		{
			code: 'import { Layer } from "effect"; Layer.provide(AppLive, Layer.mergeAll(RepositoryLive, Layer.merge(CacheLive, ClientLive.pipe(Layer.provideMerge(ClientDependenciesLive)))));',
			errors: [{ messageId: 'nestedProvide' }],
		},
		{
			code: 'import * as EffectLayer from "effect/Layer"; EffectLayer.provide(AppLive, EffectLayer.provide(ServiceLive, DependenciesLive));',
			errors: [{ messageId: 'nestedProvide' }],
		},
		{
			code: 'import EffectLayer from "effect/Layer"; EffectLayer.provide(AppLive, EffectLayer.provide(ServiceLive, DependenciesLive));',
			errors: [{ messageId: 'nestedProvide' }],
		},
	],
})
