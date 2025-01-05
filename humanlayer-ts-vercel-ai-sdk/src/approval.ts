import { HumanLayer as HumanLayerBase, ContactChannel, HumanLayerParams } from 'humanlayer'
import { CoreTool, tool, ToolExecutionOptions } from 'ai'
import { z } from 'zod'

export const humanlayer = (params: HumanLayerParams) => {
  return new HumanLayer(params)
}

export class HumanLayer {
  internal: HumanLayerBase
  constructor(params: HumanLayerParams) {
    this.internal = new HumanLayerBase(params)
  }

  _requireApproval(...args: any[]) {
    return this.internal.requireApproval(...args)
  }

  requireApproval(toolInput: { [key: string]: CoreTool }) {
    const toolName = Object.keys(toolInput)[0]
    const toolObject = toolInput[toolName]
    const execute = async (args: any, options: ToolExecutionOptions) => {
      const approvalResult = await this.internal.fetchHumanApproval({
        spec: {
          fn: toolName,
          kwargs: args,
        },
      })
      if (approvalResult.approved) {
        return toolObject.execute!(args, options)
      } else {
        return `User denied tool ${toolName} with comment: ${approvalResult.comment}`
      }
    }

    return tool({
      ...toolObject,
      execute,
    })
  }

  humanAsTool(contactChannel?: ContactChannel) {
    return tool({
      parameters: z.object({
        message: z.string(),
      }),
      description: 'contact a human', // todo read the human's details off the contact channel
      execute: async args => {
        return this.internal.humanAsTool(contactChannel)(args)
      },
    })
  }
}
