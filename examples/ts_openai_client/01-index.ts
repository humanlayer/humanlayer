import { HumanLayer } from "humanlayer";
import OpenAI from "openai";
import { ChatCompletionTool } from "openai/src/resources/index.js";

const hl = new HumanLayer({
  verbose: true,
  // runId is optional -it can be used to identify the agent in approval history
  runId: "ts-openai-client-math-example",
});

const PROMPT = `multiply 2 and 5, then add 32 to the result.

Do not do math yourself, you must use the tools provided.`;

const add = ({ a, b }: { a: number; b: number }) => a + b;

const multiply = ({ a, b }: { a: number; b: number }) => a * b;

const tools_map = {
  multiply: hl.requireApproval()(multiply),
  add: add,
};

const openai_tools: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "multiply",
      description: "multiply two numbers",
      parameters: {
        type: "object",
        properties: {
          a: { type: "number" },
          b: { type: "number" },
        },
        required: ["a", "b"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add",
      description: "add two numbers",
      parameters: {
        type: "object",
        properties: {
          a: { type: "number" },
          b: { type: "number" },
        },
        required: ["a", "b"],
      },
    },
  },
];

const openAIHello = async (
  prompt: string,
  tools_map: { [key: string]: any },
  openai_tools: ChatCompletionTool[],
) => {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const messages: any[] = [{ role: "user", content: prompt }];

  let response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: messages,
    tools: openai_tools,
    tool_choice: "auto",
  });

  while (response.choices[0].message.tool_calls) {
    messages.push(response.choices[0].message);
    const tool_calls = response.choices[0].message.tool_calls;
    for (const tool_call of tool_calls) {
      const tool_name = tool_call.function.name;
      const tool_args = JSON.parse(tool_call.function.arguments);
      console.log(
        `calling tools ${tool_name}(${tool_call.function.arguments})`,
      );
      const tool_result = await tools_map[tool_name](tool_args);
      console.log(`result: ${tool_result}`);
      messages.push({
        role: "tool",
        name: tool_name,
        content: JSON.stringify(tool_result),
        tool_call_id: tool_call.id,
      });
    }

    response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: messages,
      tools: openai_tools,
    });
  }

  return response.choices[0].message.content;
};

const main = async (): Promise<any> => {
  const resp = await openAIHello(PROMPT, tools_map, openai_tools);
  return resp;
};

main().then(console.log).catch(console.error);
