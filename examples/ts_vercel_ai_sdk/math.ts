import { tool, generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { humanlayer } from "humanlayer-vercel-ai-sdk";
import { z } from "zod";

const hl = humanlayer({
  verbose: true,
});

const prompt = `multiply 2 and 5, then add 32 to the result`;

const add = tool({
  parameters: z.object({
    a: z.number(),
    b: z.number(),
  }),
  execute: async (args) => {
    return args.a + args.b;
  },
});

const multiplyTool = tool({
  parameters: z.object({
    a: z.number(),
    b: z.number(),
  }),
  execute: async (args) => {
    return args.a * args.b;
  },
});

// todo fix "type instantiation is excessively deep and possibly infinite" because...sure
const multiply = hl.requireApproval({ multiplyTool: multiplyTool });

const openai = createOpenAI({
  compatibility: "strict",
});

const main = async () => {
  const { text, steps } = await generateText({
    model: openai("gpt-4o-mini"),
    tools: {
      add,
      multiply,
    },
    maxSteps: 5,
    prompt: prompt,
  });
  console.log(text);
};

main()
  .then((result) => {
    console.log(result);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
