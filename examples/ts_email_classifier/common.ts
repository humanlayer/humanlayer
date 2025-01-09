import OpenAI from "openai";
import { ChatCompletionTool } from "openai/resources";

export const prompt = (
  email: Email,
) => `Classify this email into one of these categories:

- read: not directly actionable, but should be read soon
- action: emails requiring specific tasks or responses
- archive: legitimate emails that don't need action or reading
- spam: unsolicited commercial emails, scams, or suspicious messages

Here is the email to classify:

${JSON.stringify(email)}
`; // json is not token-efficient but it will do for now

export type Email = {
  id: string;
  subject: string;
  from: string;
  to: string;
  body: string;
};

export const logEmails = (emails: ClassifiedEmail[]) => {
  console.log("\nResults:\n");
  const tableData = emails.map((email) => ({
    ID: email.id,
    Subject: email.subject,
    Classification: email.classification,
    "Human Review": email.hasHumanReview ? "✓" : "✗",
    "Human Classification": email.humanClassification || "-",
    "Human Comment": email.humanComment || "-",
  }));
  console.table(tableData);
};

export type Classification = "read" | "action" | "archive" | "spam";
export const classificationValues: string[] = [
  "read",
  "action",
  "archive",
  "spam",
];

export type ClassifiedEmail = Email & {
  classification: Classification;
  hasHumanReview?: boolean;
  humanComment?: string | null;
  humanClassification?: Classification | null;
};

export const emails: Email[] = [
  {
    id: "email_25b7f8a9d3e4c2_1704836718",
    subject: "Exclusive Partnership Opportunity",
    from: "marketing@techvendor.com",
    to: "me@company.com",
    body: `Hi there,

I hope this email finds you well. I wanted to reach out about an exciting opportunity to partner with TechVendor. We're offering exclusive deals on our enterprise software solutions.

Would love to schedule a quick 15-minute call to discuss how we can help optimize your operations.

Best regards,
Marketing Team`,
  },
  {
    id: "email_7c4f9b2e5d8a1_1704836718",
    subject: "Team Sync Notes - Product Launch",
    from: "sarah@company.com",
    to: "team@company.com",
    body: `Hey team,

Here are the key points from today's sync:
- Launch date set for March 15th
- Marketing materials due by March 1st
- Beta testing starts next week
- Need volunteers for user interviews

Please review and let me know if I missed anything.

Best,
Sarah`,
  },
  {
    id: "email_3a6d9c4b8e2f5_1704836718",
    subject: "Your Account Security",
    from: "security@legitbank.com",
    to: "me@company.com",
    body: `URGENT: Your account requires immediate verification. Click here to confirm your details within 24 hours to avoid service interruption.

If you did not request this verification, please disregard this message.`,
  },
  {
    id: "email_9f2e5d8a1b7c4_1704836718",
    subject: "Quick question about API docs",
    from: "dev@customer.com",
    to: "support@company.com",
    body: `Hi there,

I'm trying to implement the authentication flow described in your docs, but I'm getting a 401 error when using the refresh token. Am I missing something?

Here's what I've tried so far:
1. Generated new access token
2. Added Bearer prefix
3. Checked token expiration

Any help would be appreciated!

Thanks`,
  },
  {
    id: "email_4b8e2f5a7d9c3_1704836718",
    subject: "Weekly Newsletter - Tech Industry Updates",
    from: "newsletter@techdigest.com",
    to: "subscribers@techdigest.com",
    body: `This Week in Tech:
- AI breakthroughs in medical imaging
- New programming language trends
- Top 10 startup funding rounds
- Industry job openings

Click to read more...`,
  },
  {
    id: "email_1704836718_9f2e5d8a1b7c4",
    subject: "Happy New Year!",
    from: "newsletter@devpost.com",
    to: "subscribers@devpost.com",
    body: `Make 2025 your year to shine. Happy New Year!  It's time to turn those resolutions into reality. We're here to help you make this year your best hackathon year yet! Maybe you're aiming to master a new programming language, network with amazing developers from around the world, or finally snag that grand prize. Ambitious! We love it. No matter your goals, these hackathons are your ticket to achieving them. We can't wait to see all the incredible software you build this year. We'll be bringing you exciting hackathons all year long. Cheers to a great 2025 together! -Devpost Team `,
  },
];

export const classifierToolsOpenai: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "action",
      description: "emails requiring specific tasks or responses",
    },
  },
  {
    type: "function",
    function: {
      name: "read",
      description: "not directly actionable, but should be read soon",
    },
  },
  {
    type: "function",
    function: {
      name: "archive",
      description:
        "a task that is not worth reading and should be sent straight to the archive",
    },
  },
  {
    type: "function",
    function: {
      name: "spam",
      description:
        "unsolicited commercial emails, scams, or suspicious messages",
    },
  },
];

export const twoEmailsShuffled = emails
  .sort(() => Math.random() - 0.5)
  .slice(0, 2);

// this should really be written in baml
export async function classifyEmail(email: Email): Promise<Classification> {
  const client = new OpenAI();
  const messages: Array<OpenAI.Chat.ChatCompletionMessageParam> = [
    { role: "user", content: prompt(email) },
  ];

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
    tools: classifierToolsOpenai,
    tool_choice: "required",
  });

  const toolCalls = response.choices[0].message.tool_calls;
  if (!toolCalls || toolCalls.length === 0) {
    console.log(
      `No classification received for email ${email}, response: ${JSON.stringify(
        response,
      )}`,
    );
    throw new Error("No classification received");
  }

  if (!classificationValues.includes(toolCalls[0].function.name)) {
    console.log("unknown classification received", toolCalls[0].function.name);
    throw new Error("Unknown classification received");
  }
  return toolCalls[0].function.name as Classification;
}
