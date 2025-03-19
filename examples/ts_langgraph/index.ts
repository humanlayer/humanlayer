import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { pull } from "langchain/hub";
import { AgentExecutor, createOpenAIFunctionsAgent } from "langchain/agents";
import { StructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { humanlayer } from "humanlayer";
import dotenv from 'dotenv';

dotenv.config();

const hl = humanlayer({
  apiKey: process.env.HUMANLAYER_API_KEY,
  runId: "research-assistant-demo",
  verbose: true
});

// Define research tools
class ResearchTool extends StructuredTool {
  name = "research";
  description = "Research a given query and determine complexity";
  schema = z.object({
    query: z.string(),
    complexity: z.string(),
    currentPath: z.string()
  });

  async __call(args: z.output<typeof this.schema>): Promise<string> {
    const llm = new ChatOpenAI({ modelName: "gpt-4-turbo-preview" });
    
    // Analyze complexity
    const complexityPrompt = `Analyze the complexity of this research query: '${args.query}'
    Respond with only one word: 'simple', 'medium', or 'complex'.`;
    const complexityResponse = await llm.invoke(complexityPrompt);
    const complexity = String(complexityResponse.content).toLowerCase();

    // Determine path
    let path = "quick_search";
    if (complexity === "medium") path = "deep_dive";
    if (complexity === "complex") path = "expert_consult";

    // Do research based on path
    let findings = [];
    if (path === "quick_search") {
      findings.push("Quick search result");
    } else if (path === "deep_dive") {
      findings.push("Deep dive analysis");
    } else {
      findings.push("Expert consultation needed");
    }

    // Synthesize results
    const synthesisPrompt = `Synthesize these findings for the query '${args.query}':
    Research path: ${path}
    Findings: ${JSON.stringify(findings)}`;
    const synthesisResponse = await llm.invoke(synthesisPrompt);

    return String(synthesisResponse.content);
  }

  _call(args: any) {
    const f = this.__call.bind(this);
    Object.defineProperty(f, "name", { value: this.name });
    return hl.requireApproval()(f)(args);
  }
}

async function main() {
  const tools = [new ResearchTool()];

  const prompt = await pull<ChatPromptTemplate>(
    "hwchase17/openai-functions-agent"
  );

  const llm = new ChatOpenAI({
    modelName: "gpt-4o-mini",
    temperature: 0
  });

  const agent = await createOpenAIFunctionsAgent({
    llm: llm as any,
    tools,
    prompt
  });

  const agentExecutor = new AgentExecutor({
    agent,
    tools
  });

  const queries = [
    "What's the capital of France?", // simple
    "Explain the impact of AI on modern healthcare", // medium
    "Analyze the quantum entanglement's role in consciousness theories" // complex
  ];

  for (const query of queries) {
    const result = await agentExecutor.invoke({
      input: query,
      chat_history: []
    });

    console.log("\nQuery:", query);
    console.log("Result:", result.output);
  }
}

main().catch(console.error);
