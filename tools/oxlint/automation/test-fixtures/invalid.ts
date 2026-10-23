declare const Effect: {
	catch: (handler: (error: { _tag: string; reason: { _tag: string } }) => unknown) => unknown
	catchTag: (tag: string, handler: (error: { reason: { _tag: string } }) => unknown) => unknown
}
declare const value: { _tag: string }

if (value._tag === 'Ready') console.log('ready')

switch (value._tag) {
	case 'Ready':
		break
}

Effect.catch((error) => (error._tag === 'NotFoundError' ? undefined : error))
Effect.catch((error) => (error.reason._tag === 'NotFound' ? undefined : error))
Effect.catchTag('PlatformError', (error) => (error.reason._tag === 'NotFound' ? undefined : error))

const event = { _tag: 'Ready', value: 1 }

void event
