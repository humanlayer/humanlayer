import { RuleTester } from 'oxlint/plugins-dev'

import { noReprovideAmbientServiceRule } from './no-reprovide-ambient-service.ts'

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: 'ts' } } })
const error = {
	messageId: 'reprovideAmbientService',
	data: { service: 'HttpClient.HttpClient' },
}

tester.run('anti-slop/no-reprovide-ambient-service', noReprovideAmbientServiceRule, {
	valid: [
		{
			code: `
        import { Effect } from 'effect'
        import * as HttpClient from 'effect/http/HttpClient'
        const operation = Effect.gen(function* () {
          yield* HttpClient.HttpClient
        })
      `,
		},
		{
			code: `
        import { Effect } from 'effect'
        const operation = Effect.gen(function* () {
          const first = yield* FirstService
          return Effect.provideService(request, SecondService, first)
        })
      `,
		},
		{
			code: `
        import { Effect } from 'effect'
        import * as HttpClient from 'effect/http/HttpClient'
        const operation = Effect.gen(function* () {
          const baseClient = yield* HttpClient.HttpClient
          const tenantClient = configureForTenant(baseClient)
          return request.pipe(Effect.provideService(HttpClient.HttpClient, tenantClient))
        })
      `,
		},
		{
			code: `
        import { Effect } from 'effect'
        const operation = Effect.gen(function* () {
          const first = yield* FirstService
          return request.pipe(Effect.provideService(SecondService, first))
        })
      `,
		},
		{
			code: `
        import { Effect } from 'other-library'
        const operation = Effect.gen(function* () {
          const service = yield* Service
          return request.pipe(Effect.provideService(Service, service))
        })
      `,
		},
	],
	invalid: [
		{
			code: `
        import { Effect } from 'effect'
        import * as HttpClient from 'effect/http/HttpClient'
        const ServiceLive = Layer.effect(Service, Effect.gen(function* () {
          const httpClient = yield* HttpClient.HttpClient
          return Service.of({
            execute: () => request.pipe(
              Effect.provideService(HttpClient.HttpClient, httpClient),
            ),
          })
        }))
      `,
			errors: [error],
		},
		{
			code: `
        import * as Fx from 'effect/Effect'
        import * as HttpClient from 'effect/http/HttpClient'
        const operation = Fx.gen(function* () {
          const httpClient = yield* HttpClient.HttpClient
          return request.pipe(Fx.provideService(HttpClient.HttpClient, httpClient))
        })
      `,
			errors: [error],
		},
		{
			code: `
        import { Effect } from 'effect'
        import * as HttpClient from 'effect/http/HttpClient'
        const operation = Effect.gen(function* () {
          const httpClient = yield* HttpClient.HttpClient
          return Effect.provideService(request, HttpClient.HttpClient, httpClient)
        })
      `,
			errors: [error],
		},
	],
})
