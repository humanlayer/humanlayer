import { HumanLayer } from "humanlayer";
import OpenAI from "openai";
import { ChatCompletionTool } from "openai/src/resources/index.js";

const hl = new HumanLayer({
  verbose: true,
  // runId is optional -it can be used to identify the agent in approval history
  runId: "openai-imperative-fetch-04",
});

const PROMPT = "multiply 2 and 5, then add 32 to the result";

const add = ({ x, y }: { x: number; y: number }): number => {
  return x + y;
};

const multiply = ({ x, y }: { x: number; y: number }): number => {
  return x * y;
};

const math_tools_openai: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "add",
      description: "Add two numbers together.",
      parameters: {
        type: "object",
        properties: {
          x: { type: "number" },
          y: { type: "number" },
        },
        required: ["x", "y"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "multiply",
      description: "multiply two numbers",
      parameters: {
        type: "object",
        properties: {
          x: { type: "number" },
          y: { type: "number" },
        },
        required: ["x", "y"],
      },
    },
  },
];

const openAIHello = async (
  prompt: string,
  tools_openai: ChatCompletionTool[],
) => {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const messages: any[] = [{ role: "user", content: prompt }];

  let response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: messages,
    tools: tools_openai,
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

      let tool_result;
      if (tool_name === "multiply") {
        const call = await hl.backend?.functions().add({
          run_id: hl.runId,
          call_id: tool_call.id,
          spec: {
            fn: "multiply",
            kwargs: tool_args,
          },
        });

        while (true) {
          await new Promise((resolve) => setTimeout(resolve, 5000));
          const updatedCall = await hl.backend?.functions().get(tool_call.id);
          if (
            updatedCall?.status?.approved === null ||
            typeof updatedCall?.status?.approved === "undefined"
          ) {
            console.log(`self-approving call ${tool_call.id}`);
            await hl.backend?.functions().respond(tool_call.id, {
              requested_at: updatedCall?.status?.requested_at!,
              approved: true,
            });
            continue;
          }
          if (updatedCall?.status?.approved) {
            tool_result = multiply(tool_args);
            break;
          } else {
            tool_result = `call ${tool_name}(${JSON.stringify(
              tool_args,
            )}) not approved, comment was ${updatedCall?.status?.comment}`;
            break;
          }
        }
      } else if (tool_name === "add") {
        tool_result = add(tool_args);
      }

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
      tools: tools_openai,
    });
  }

  return response.choices[0].message.content;
};

const main = async (): Promise<any> => {
  const resp = await openAIHello(PROMPT, math_tools_openai);
  return resp;
};

main().then(console.log).catch(console.error);
