import type { RiptideApiOutputs } from '@humanlayer/riptide-api-contract/contract-router'
import { workspaceMaterializationIdentityKey } from '@humanlayer/schemas/effect/project-workspace'

type WorkspaceStatus = RiptideApiOutputs['projectWorkspaces']['getStatus']
type Repository = WorkspaceStatus['materializations'][number]['repositories'][number]

export const projectWorkspaceRepositoryKey = (repository: Repository) =>
	`${workspaceMaterializationIdentityKey(repository.status)}\0${repository.status.repositoryIdentity}`
