import { ContactChannel, HumanLayer } from "humanlayer";
import OpenAI from "openai";
import { ChatCompletionTool } from "openai/src/resources/index.js";

const hl = new HumanLayer({ verbose: true });

const PROMPT = `

You are the linkedin inbox assistant. You check on
the CEO's linkedin inbox and decide if there are any messages
that seem interesting, then contact the human in slack with a summary.

don't provide detail on spam-looking messages, or messages
that appear to be selling a service or software

You can offer to perform  actions like schedule time.

Example slack dm to send:

Your inbox for today includes 4 spam messages,
and 1 message from Devin who seems interested in your
product - [here's the link](https://linkedin.com/in/devin).

Terri has still not responded to your question about scheduling an onboarding call.

Would you like me to respond to Devin with your availability?

`;

interface LinkedInMessage {
  from_name: string;
  date: string;
  message: string;
}

interface LinkedInThread {
  thread_id: string;
  thread_url: string;
  with_name: string;
  messages: LinkedInMessage[];
}

const getTime = () => {
  return new Date().toISOString();
};

const getLinkedinThreads = (): LinkedInThread[] => {
  return [
    {
      thread_id: "123",
      thread_url: "https://linkedin.com/_fake/in/msg/123",
      with_name: "Danny",
      messages: [
        {
          message: `Hello, i am wondering if you are interested to try our excellent offshore developer service`,
          from_name: "Danny",
          date: "2024-08-17",
        },
      ],
    },
    {
      thread_id: "124",
      thread_url: "https://linkedin.com/_fake/in/msg/124",
      with_name: "Sarah",
      messages: [
        {
          message: `Hello, I am interested in your product, what's the best way to get started`,
          from_name: "Sarah",
          date: "2024-08-16",
        },
      ],
    },
    {
      thread_id: "125",
      thread_url: "https://linkedin.com/_fake/in/msg/125",
      with_name: "Terri",
      messages: [
        {
          message: `Hello, I am interested in your product, what's the best way to get started`,
          from_name: "Terri",
          date: "2024-08-12",
        },
        {
          message: `I would be happy to give you a demo - please let me know when you're available, or you can book time at http://calendly.com/im-the-ceo`,
          from_name: "you",
          date: "2024-08-12",
        },
      ],
    },
  ];
};

const sendLinkedinMessage = ({
  to_name,
}: {
  thread_id: string;
  to_name: string;
  msg: string;
}) => {
  return `message successfully sent to ${to_name}`;
};

const dmWithCEO: ContactChannel = {
  slack: {
    channel_or_user_id: "C07HR5JL15F",
    context_about_channel_or_user: "a dm with the ceo",
  },
};

const tools_map = {
  sendLinkedinMessage: hl.requireApproval(dmWithCEO)(sendLinkedinMessage),
  getLinkedinThreads: getLinkedinThreads,
  getTime: getTime,
  contactHumanInADMWithTheCEO: hl.humanAsTool(dmWithCEO),
};

const openai_tools: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "sendLinkedinMessage",
      description: "send a message in a thread in LinkedIn",
      parameters: {
        type: "object",
        properties: {
          thread_id: {
            type: "string",
            description: "the id of the thread",
          },
          to_name: {
            type: "string",
            description: "the name of the person to send the message to",
          },
          msg: {
            type: "string",
            description: "the message to send",
          },
        },
        required: ["thread_id", "to_name", "msg"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getLinkedinThreads",
      description: "get the linkedin threads",
    },
  },
  {
    type: "function",
    function: {
      name: "getTime",
      description: "get the current time",
    },
  },
  {
    type: "function",
    function: {
      name: "contactHumanInADMWithTheCEO",
      description: "contact the human in a dm with the ceo",
      parameters: {
        type: "object",
        properties: {
          message: {
            type: "string",
            description: "the message to send",
          },
        },
        required: ["message"],
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
      let tool_result;
      try {
        tool_result = await tools_map[tool_name](tool_args);
      } catch (e) {
        console.error(`error calling tool ${tool_name}: ${e}`);
        throw e;
      }
      console.log(`result: ${JSON.stringify(tool_result)}`);
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
