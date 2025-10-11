import {
	isChangeMessage,
	isControlMessage,
	type Message,
	type Offset,
	ShapeStream,
} from '@electric-sql/client'
import { toBase64 } from 'lib0/buffer'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import * as env from 'lib0/environment'
import { ObservableV2 } from 'lib0/observable'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as syncProtocol from 'y-protocols/sync'
import * as Y from 'yjs'
import { parseToDecoder, parseToDecoderLazy, paserToTimestamptz } from './utils'

type OperationMessage = {
	op: decoding.Decoder
}

type AwarenessMessage = {
	op: () => decoding.Decoder
	clientId: string
	room: string
	updated: Date
}

type ObservableProvider = {
	sync: (state: boolean) => void
	synced: (state: boolean) => void
	status: (status: {
		status: `connecting` | `connected` | `disconnected`
	}) => void

	'connection-close': () => void
}

// from yjs docs, need to check if is configurable
const awarenessPingPeriod = 30000 //ms

const messageSync = 0

export class ElectricProvider extends ObservableV2<ObservableProvider> {
	private baseUrl: string
	private roomName: string
	public doc: Y.Doc
	public awareness?: awarenessProtocol.Awareness

	private operationsStream?: ShapeStream<OperationMessage>
	private awarenessStream?: ShapeStream<AwarenessMessage>

	private shouldConnect: boolean
	private connected: boolean
	private _synced: boolean

	private modifiedWhileOffline: boolean
	private lastSyncedStateVector?: Uint8Array

	private updateHandler: (update: Uint8Array, origin: unknown) => void
	private awarenessUpdateHandler?: (
		changed: { added: number[]; updated: number[]; removed: number[] },
		origin: string,
	) => void
	private disconnectShapeHandler?: () => void
	private exitHandler?: () => void

	private awarenessState: Record<string, number | string> | null = null

	private resume: {
		operations?: { offset: Offset; handle: string }
		awareness?: { offset: Offset; handle: string }
	} = {}

	constructor(
		baseUrl: string,
		roomName: string,
		doc: Y.Doc,
		options: {
			awareness?: awarenessProtocol.Awareness
			connect?: boolean
		},
	) {
		super()

		this.baseUrl = baseUrl
		this.roomName = roomName

		this.doc = doc
		this.awareness = options.awareness

		this.connected = false
		this._synced = false
		this.shouldConnect = options.connect ?? false

		this.modifiedWhileOffline = false

		this.updateHandler = (update: Uint8Array, origin: unknown) => {
			if (origin !== this) {
				this.sendOperation(update)
			}
		}
		this.doc.on(`update`, this.updateHandler)

		if (this.awareness) {
			this.awarenessUpdateHandler = (
				{ added, updated, removed },
				origin,
			) => {
				if (origin === `local`) {
					const changedClients = added.concat(updated).concat(removed)
					this.sendAwareness(changedClients)
				}
			}
			this.awareness.on(`update`, this.awarenessUpdateHandler)
		}

		if (env.isNode && typeof process !== `undefined`) {
			this.exitHandler = () => {
				process.on(`exit`, () => this.destroy())
			}
		}

		if (options.connect) {
			this.connect()
		}
	}

	get synced() {
		return this._synced
	}

	set synced(state) {
		if (this._synced !== state) {
			this._synced = state
			this.emit(`synced`, [state])
			this.emit(`sync`, [state])
		}
	}

	destroy() {
		this.disconnect()
		this.doc.off(`update`, this.updateHandler)
		this.awareness?.off(`update`, this.awarenessUpdateHandler!)
		if (env.isNode && typeof process !== `undefined`) {
			process.off(`exit`, this.exitHandler!)
		}
		super.destroy()
	}

	disconnect() {
		this.shouldConnect = false

		if (this.awareness && this.connected) {
			this.awarenessState = this.awareness.getLocalState()

			awarenessProtocol.removeAwarenessStates(
				this.awareness,
				Array.from(this.awareness.getStates().keys()).filter(
					(client) => client !== this.doc.clientID,
				),
				this,
			)

			// try to notify other clients that we are disconnected
			awarenessProtocol.removeAwarenessStates(
				this.awareness,
				[this.doc.clientID],
				`local`,
			)
		}

		if (this.disconnectShapeHandler) {
			this.disconnectShapeHandler()
		}
	}

	connect() {
		this.shouldConnect = true
		if (!this.connected && !this.operationsStream) {
			this.setupShapeStream()
		}

		if (this.awareness && this.awarenessState !== null) {
			this.awareness.setLocalState(this.awarenessState)
			this.awarenessState = null
		}
	}

	private sendOperation(update: Uint8Array) {
		if (!this.connected) {
			this.modifiedWhileOffline = true
			return Promise.resolve()
		}

		const encoder = encoding.createEncoder()
		syncProtocol.writeUpdate(encoder, update)
		const op = toBase64(encoding.toUint8Array(encoder))
		const room = this.roomName

		// console.log(`sending operation to room ${room}`)
		return fetch(
			new URL('/v1/thoughts-document-operations', this.baseUrl),
			{
				method: `POST`,
				headers: {
					'content-type': `application/json`,
				},
				body: JSON.stringify({ thoughtsDocumentId: room, op }),
			},
		)
	}

	private sendAwareness(changedClients: number[]) {
		const encoder = encoding.createEncoder()
		encoding.writeVarUint8Array(
			encoder,
			awarenessProtocol.encodeAwarenessUpdate(
				this.awareness!,
				changedClients,
			),
		)
		const op = toBase64(encoding.toUint8Array(encoder))

		if (this.connected) {
			const room = this.roomName
			const clientId = `${this.doc.clientID}`
			console.log(
				`sending awareness to room ${room} with client ID ${clientId}`,
			)

			return fetch(
				new URL('/v1/thoughts-document-operations', this.baseUrl),
				{
					method: `POST`,
					headers: {
						'content-type': `application/json`,
					},
					body: JSON.stringify({
						clientId,
						thoughtsDocumentId: room,
						op,
					}),
				},
			)
		}
	}

	private setupShapeStream() {
		if (this.shouldConnect && !this.operationsStream) {
			this.connected = false
			this.synced = false

			console.log(`Setting up shape stream for room: ${this.roomName}`)

			try {
				const operationsUrl = this.baseUrl + `/thoughts-document-operations`
				const awarenessUrl = this.baseUrl + `/awareness`

				console.log(`Creating operations stream:`, operationsUrl, `where thoughts_document_id = '${this.roomName}'`)
				console.log(`Creating awareness stream:`, awarenessUrl, `where thoughts_document_id = '${this.roomName}'`)

				this.operationsStream = new ShapeStream<OperationMessage>({
					url: operationsUrl,
					params: {
						where: `thoughts_document_id = '${this.roomName}'`,
					},
					parser: parseToDecoder,
					subscribe: true,
					...this.resume.operations,
				})

				this.awarenessStream = new ShapeStream({
					url: awarenessUrl,
					params: {
						where: `thoughts_document_id = '${this.roomName}'`,
					},
					parser: { ...parseToDecoderLazy, ...paserToTimestamptz },
					...this.resume.awareness,
				})

				console.log(`Shape streams created successfully`)
			} catch (error) {
				console.error(`Error setting up shape streams:`, error)
				this.operationsStream = undefined
				this.awarenessStream = undefined
				return
			}

			const updateShapeState = (
				name: `operations` | `awareness`,
				offset: Offset,
				handle: string,
			) => {
				this.resume[name] = { offset, handle }
				// TODO: persist to IndexedDB for offline support
			}

			const handleSyncMessage = (
				messages: Message<OperationMessage>[],
			) => {
				try {
					messages.forEach((message) => {
						if (isChangeMessage(message) && message.value.op) {
							const decoder = message.value.op
							const encoder = encoding.createEncoder()
							encoding.writeVarUint(encoder, messageSync)
							syncProtocol.readSyncMessage(
								decoder,
								encoder,
								this.doc,
								this,
							)
						} else if (
							isControlMessage(message) &&
							message.headers.control === `up-to-date`
						) {
							this.synced = true
						}
					})
				} catch (error) {
					console.error(`Error handling sync message:`, error)
				}
			}

			const unsubscribeSyncHandler =
				this.operationsStream.subscribe(handleSyncMessage)

			// TODO: Re-enable awareness when resume state is implemented
			// const handleAwarenessMessage = (
			// 	messages: Message<AwarenessMessage>[],
			// ) => {
			// 	try {
			// 		const minTime = new Date(Date.now() - awarenessPingPeriod)
			// 		messages.forEach((message) => {
			// 			if (isChangeMessage(message) && message.value.op) {
			// 				if (message.value.updated < minTime) {
			// 					return
			// 				}

			// 				const decoder = message.value.op()
			// 				awarenessProtocol.applyAwarenessUpdate(
			// 					this.awareness!,
			// 					decoding.readVarUint8Array(decoder),
			// 					this,
			// 				)
			// 			}
			// 		})
			// 	} catch (error) {
			// 		console.error(`Error handling awareness message:`, error)
			// 	}
			// }

			// const unsubscribeAwarenessHandler = this.awarenessStream.subscribe(
			// 	handleAwarenessMessage,
			// )

			this.disconnectShapeHandler = () => {
				this.operationsStream = undefined
				this.awarenessStream = undefined

				if (this.connected) {
					this.lastSyncedStateVector = Y.encodeStateVector(this.doc)

					this.connected = false
					this.synced = false
					this.emit(`status`, [{ status: `disconnected` }])
				}

				unsubscribeSyncHandler()
				// unsubscribeAwarenessHandler()
				this.disconnectShapeHandler = undefined
				this.emit(`connection-close`, [])
			}

			const pushLocalChangesUnsubscribe =
				this.operationsStream!.subscribe(() => {
					this.connected = true

					if (this.modifiedWhileOffline) {
						const pendingUpdates = Y.encodeStateAsUpdate(
							this.doc,
							this.lastSyncedStateVector,
						)
						const encoderState = encoding.createEncoder()
						syncProtocol.writeUpdate(encoderState, pendingUpdates)

						this.sendOperation(pendingUpdates).then(() => {
							this.lastSyncedStateVector = undefined
							this.modifiedWhileOffline = false
							this.emit(`status`, [{ status: `connected` }])
						})
					}
					pushLocalChangesUnsubscribe()
				})

			this.emit(`status`, [{ status: `connecting` }])
		}
	}
}
