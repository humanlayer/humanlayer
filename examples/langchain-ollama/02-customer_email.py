from dotenv import load_dotenv
from llama_toolkit import LlamaToolkit

from humanlayer import ContactChannel, HumanLayer, SlackContactChannel

load_dotenv()

toolkit = LlamaToolkit(model_name="llama3.1", temperature=0.1)
hl = HumanLayer(
    verbose=True,
    contact_channel=ContactChannel(
        slack=SlackContactChannel(
            channel_or_user_id="",
            experimental_slack_blocks=True,
        )
    ),
    # run_id is optional -it can be used to identify the agent in approval history
    run_id="langchain-customer-email",
)

task_prompt = """

You are the email onboarding assistant. You check on the progress customers
are making and then based on that info, you
send friendly and encouraging emails to customers to help them fully onboard
into the product.

Before sending an email, you check with the head of marketing for feedback,
then you send the email.

your task is to prepare an email to send to the customer danny@metacorp.com
"""


@toolkit.add_function()
def get_info_about_customer(email: str) -> str:
    return f"Customer {email} is a small company that makes a product called MetaCorp. They are looking for a new employee to join their team."


@toolkit.add_function()
@hl.require_approval()
def send_email(email: str, subject: str, body: str) -> str:
    return f"Email sent to {email} with subject: {subject}"


agent = toolkit.create_agent()

if __name__ == "__main__":
    agent.invoke(task_prompt)
