import {
  Escalation,
  FunctionCall,
  FunctionCallStatus,
  HumanContact,
  HumanContactStatus,
} from './models'

export type AgentStore<T_Call, T_Status> = {
  add: (item: T_Call) => Promise<T_Call>
  get: (call_id: string) => Promise<T_Call>
  respond: (call_id: string, status: T_Status) => Promise<T_Call>
  escalateEmail: (call_id: string, escalation: Escalation) => Promise<T_Call>
}

export type AdminStore<T_Call, T_Status> = {
  respond: (call_id: string, status: T_Status) => Promise<void>
  list: (call_id: string) => Promise<Iterable<T_Call>>
}

export class HumanLayerException extends Error {}

export type AgentBackend = {
  functions(): AgentStore<FunctionCall, FunctionCallStatus>
  contacts(): AgentStore<HumanContact, HumanContactStatus>
}

export type AdminBackend = {
  functions(): AdminStore<FunctionCall, FunctionCallStatus>
  contacts(): AdminStore<HumanContact, HumanContactStatus>
}
