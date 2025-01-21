import { FunctionCall, HumanLayer, ResponseOption } from "humanlayer";
import { config } from "dotenv";
import express, { Request, Response } from "express";
import {
  Classification,
  classificationValues,
  ClassifiedEmail,
  classifyEmail,
  twoEmailsShuffled,
  logEmails,
} from "./common";

config(); // Load environment variables

const classifiedEmails: Record<string, ClassifiedEmail> = {};

const hl = new HumanLayer({
  verbose: true,
  runId: "email-classifier",
  contactChannel: {
    slack: {
      channel_or_user_id: "", // default to DM from app
      experimental_slack_blocks: true,
    },
  },
});

async function main() {
  try {
    console.log("\nClassifying emails...\n");

    for (const email of twoEmailsShuffled) {
      const classification = await classifyEmail(email);
      classifiedEmails[email.id] = {
        ...email,
        classification,
      };
    }
    logEmails(Object.values(classifiedEmails));

    Object.values(classifiedEmails).forEach((email) => {
      const remainingOptions = classificationValues.filter(
        (c) => c !== email.classification
      );

      const responseOptions: ResponseOption[] = remainingOptions.map((c) => ({
        name: c,
        title: c,
        description: `Classify as ${c}`,
        prompt_fill: `manual classify: ${c}`,
        interactive: false,
      }));

      hl.createFunctionCall({
        spec: {
          fn: "classifyEmail",
          kwargs: {
            to: email.to,
            from: email.from,
            subject: email.subject,
            body: email.body,
            classification: email.classification,
          },
          reject_options: responseOptions,
          state: {
            emailId: email.id,
          },
        },
      });
      console.log(`sent email ${email.subject} to human for review`);
    });
  } catch (error) {
    console.error("Error:", error);
  }
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get("/healthz", (req: Request, res: Response) => {
  res.json({
    status: "ok",
  });
});

app.post("/webhook/human-response", (req: Request, res: Response) => {
  const response: FunctionCall = req.body.event;
  console.log(
    "human response received for",
    `"${response.spec.kwargs.subject}"`,
    response.status?.reject_option_name || "approved"
  );
  const email = classifiedEmails[response.spec.state?.emailId];
  if (!email) {
    console.error("email not found for", response.spec.kwargs.subject);
    console.log(response);
    res.status(404).json({ error: "Email not found" });
    return;
  }
  if (!response.status?.approved) {
    console.log(
      `${email.id}: ${email.subject} was overriden by human as ${response.status?.reject_option_name}`
    );
    email.humanClassification = response.status
      ?.reject_option_name as Classification;
    email.hasHumanReview = true;
    email.humanComment = response.status?.comment;
  } else {
    console.log(
      `${email.id}: ${email.subject} was approved by human as ${email.classification}`
    );
    email.humanClassification = email.classification;
    email.hasHumanReview = true;
    email.humanComment = response.status?.comment;
  }

  logEmails(Object.values(classifiedEmails));

  res.json({
    status: "ok",
  });
});

app.get("/emails", (req: Request, res: Response) => {
  res.json(Object.values(classifiedEmails));
});

// Start the server before running the main logic
const server = app.listen(PORT, async () => {
  console.log(`Server is running on port ${PORT}`);

  console.log(
    `fetching project from ${process.env.HUMANLAYER_API_BASE}/project`
  );
  const project = await fetch(`${process.env.HUMANLAYER_API_BASE}/project`, {
    headers: {
      Authorization: `Bearer ${process.env.HUMANLAYER_API_KEY}`,
    },
  });
  console.log(await project.json());

  // Run the main application logic after server starts
  main()
    .then(console.log)
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
});

server.on("error", (error) => {
  console.error("Server error:", error);
  process.exit(1);
});
