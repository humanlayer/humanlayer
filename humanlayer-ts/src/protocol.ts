import { FunctionCall, FunctionCallStatus, HumanContact, HumanContactStatus } from './models'

export type AgentStore<T_Call> = {
  add: (item: T_Call) => Promise<void>
  get: (call_id: string) => Promise<T_Call>
}

export type AdminStore<T_Call, T_Status> = {
  respond: (call_id: string, status: T_Status) => Promise<void>
  list: (call_id: string) => Promise<Iterable<T_Call>>
}

export class HumanLayerException extends Error {}

export type AgentBackend = {
  functions(): AgentStore<FunctionCall>
  contacts(): AgentStore<HumanContact>
}

export type AdminBackend = {
  functions(): AdminStore<FunctionCall, FunctionCallStatus>
  contacts(): AdminStore<HumanContact, HumanContactStatus>
}
