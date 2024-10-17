import { ChatOpenAI } from "@langchain/openai";
import type { ChatPromptTemplate } from "@langchain/core/prompts";
import { AIMessage, HumanMessage } from "@langchain/core/messages";

import { pull } from "langchain/hub";
import { AgentExecutor, createOpenAIFunctionsAgent } from "langchain/agents";
import { StructuredTool, Tool } from "@langchain/core/tools";
import { output, z } from "zod";
import { ZodObjectAny } from "@langchain/core/dist/types/zod";
import { HumanLayer } from "humanlayer";

const hl = new HumanLayer({
  verbose: true,
  // runId is optional -it can be used to identify the agent in approval history
  runId: "ts-langchain-math-example",
});

class AddTool extends StructuredTool {
  name: string = "add";
  description: string = "add two numbers";
  schema = z.object({
    a: z.number(),
    b: z.number(),
  });

  __call(arg: output<ZodObjectAny>): Promise<string> {
    return Promise.resolve(`${arg.a + arg.b}`);
  }
  _call(arg: any) {
    const f = this.__call.bind(this);
    Object.defineProperty(f, "name", { value: this.name });
    return hl.requireApproval()(f)(arg);
  }
}

async function main() {
  // Define the tools the agent will have access to.
  const tools = [new AddTool()];

  // Get the prompt to use - you can modify this!
  // If you want to see the prompt in full, you can at:
  // https://smith.langchain.com/hub/hwchase17/openai-functions-agent
  const prompt = await pull<ChatPromptTemplate>(
    "hwchase17/openai-functions-agent",
  );

  const llm = new ChatOpenAI({
    model: "gpt-3.5-turbo-1106",
    temperature: 0,
  });

  const agent = await createOpenAIFunctionsAgent({
    llm,
    tools,
    prompt,
  });

  const agentExecutor = new AgentExecutor({
    agent,
    tools,
  });

  const result = await agentExecutor.invoke({
    input: "what's 6 + 7?",
    chat_history: [
      new HumanMessage("hi i love math"),
      new AIMessage("hi i love math too"),
    ],
  });

  console.log(result);
}

main().then(console.log).catch(console.error);
