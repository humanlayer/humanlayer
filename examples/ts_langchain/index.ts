import { ChatOpenAI } from "@langchain/openai";
import type { ChatPromptTemplate } from "@langchain/core/prompts";
import { AIMessage, HumanMessage } from "@langchain/core/messages";

import { pull } from "langchain/hub";
import { AgentExecutor, createOpenAIFunctionsAgent } from "langchain/agents";
import { StructuredTool, Tool } from "@langchain/core/tools";
import { output, z } from "zod";
import { ZodObjectAny } from "@langchain/core/dist/types/zod";
import { CallbackManagerForToolRun } from "@langchain/core/dist/callbacks/manager";
import { RunnableConfig } from "@langchain/core/runnables";
import { TavilySearchResults } from "langchain/dist/util/testing/tools/tavily_search";

class AddTool extends Tool {
  name: string = "add";
  description: string = "add two numbers";
  // the schema is two args, a and b, both numbers
  schema = z.object({
    a: z.number(),
    b: z.number(),
  });

  _call(
    arg: output<ZodObjectAny>,
    runManager?: CallbackManagerForToolRun,
    parentConfig?: RunnableConfig,
  ): Promise<number> {
    return Promise.resolve(arg.a + arg.b);
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
    input: "what is LangChain?",
  });

  console.log(result);

  const result2 = await agentExecutor.invoke({
    input: "what's my name?",
    chat_history: [
      new HumanMessage("hi! my name is cob"),
      new AIMessage("Hello Cob! How can I assist you today?"),
    ],
  });

  console.log(result2);
}

main().then(console.log).catch(console.error);
