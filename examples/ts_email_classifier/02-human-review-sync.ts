import { HumanLayer, ResponseOption } from "humanlayer-sdk";
import { config } from "dotenv";
import {
  Classification,
  classificationValues,
  ClassifiedEmail,
  classifyEmail,
  logEmails,
  twoEmailsShuffled,
} from "./common";

config(); // Load environment variables

const hl = new HumanLayer({
  verbose: true,
  runId: "email-classifier",
  contactChannel: {
    slack: {
      channel_or_user_id: "",
      context_about_channel_or_user: "",
      experimental_slack_blocks: true,
    },
  },
});

async function main() {
  try {
    console.log("\nClassifying emails...\n");
    const results: ClassifiedEmail[] = [];

    for (const email of twoEmailsShuffled) {
      const classification = await classifyEmail(email);
      console.log(
        `Classification for "${email.subject}" was ${classification}, checking with human`,
      );
      const { subject, body, to, from } = email;
      const remainingOptions = classificationValues.filter(
        (c) => c !== classification,
      );
      const responseOptions: ResponseOption[] = remainingOptions.map((c) => ({
        name: c,
        title: c,
        description: `Classify as ${c}`,
        prompt_fill: `manual classify: ${c}`,
        interactive: false,
      }));

      // fetch human review as labels are processing
      const humanReview = await hl.fetchHumanApproval({
        spec: {
          fn: "classifyEmail",
          kwargs: { to, from, subject, body, classification },
          reject_options: responseOptions,
        },
      });

      const humanClassification = humanReview.approved
        ? classification
        : (humanReview.reject_option_name as Classification | null | undefined);

      results.push({
        ...email,
        classification,
        hasHumanReview: true,
        humanComment: humanReview.comment,
        humanClassification,
      });
    }

    logEmails(results);
  } catch (error) {
    console.error("Error:", error);
  }
}
main()
  .then(console.log)
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
