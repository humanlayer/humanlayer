import { config } from "dotenv";
import { HumanLayer } from "humanlayer";
import {
  ClassifiedEmail,
  classifyEmail,
  logEmails,
  twoEmailsShuffled,
} from "./common";

config(); // Load environment variables

const hl = new HumanLayer({
  verbose: true,
  runId: "email-classifier",
});

async function main() {
  try {
    console.log("\nClassifying emails...\n");
    const results: ClassifiedEmail[] = [];

    for (const email of twoEmailsShuffled) {
      const classification = await classifyEmail(email);
      console.log(
        `Classification for "${email.subject}" was ${classification}`,
      );
      results.push({
        ...email,
        classification,
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
