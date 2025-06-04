import os
import sys
import time
from dotenv import load_dotenv
from rich.console import Console
from rich.syntax import Syntax

from humanlayer import HumanLayer
from humanlayer.core.models import (
    Escalation,
    EmailContactChannel,
    ContactChannel,
    FunctionCallSpec,
    EmailRecipient,
)

# Load environment variables
load_dotenv()

# Initialize Rich console for colored output
console = Console()

# Validate required environment variables
required_env_vars = [
    "HUMANLAYER_API_KEY",
    "HL_EXAMPLE_CONTACT_EMAIL",
    "HL_EXAMPLE_SECOND_CONTACT_EMAIL", 
    "HL_EXAMPLE_THIRD_CONTACT_EMAIL",
]

for env_var in required_env_vars:
    if not os.getenv(env_var):
        console.print(f"Missing required environment variable: [red]{env_var}[/red]")
        sys.exit(1)

# Initialize HumanLayer
hl = HumanLayer(verbose=True, run_id="email-escalation")

def main():
    """Main function"""
    try:
        # Create initial function call with email channel
        call = hl.create_function_call(
            spec=FunctionCallSpec(
                fn="multiply",
                kwargs={"foo": "bar"},
                channel=ContactChannel(
                    email=EmailContactChannel(
                        experimental_subject_line="FunctionCall Approval, a HumanLayer Test",
                        address=os.getenv("HL_EXAMPLE_CONTACT_EMAIL"),
                    )
                ),
            )
        )
        
        console.print(f"First function call sent to [green]{os.getenv('HL_EXAMPLE_CONTACT_EMAIL')}[/green]. "
                      f"Waiting 5 more seconds and then escalating to [yellow]{os.getenv('HL_EXAMPLE_SECOND_CONTACT_EMAIL')}[/yellow]...\n")
        
        # EXAMPLE - escalate immediately after 5 seconds
        # in reality, this would happen after some longer amount of time has passed
        time.sleep(5)
        
        # First escalation: add additional recipient
        hl.escalate_email_function_call(
            call_id=call.call_id,
            escalation=Escalation(
                escalation_msg="please take a look because it's been too long",
                additional_recipients=[
                    EmailRecipient(
                        address=os.getenv("HL_EXAMPLE_SECOND_CONTACT_EMAIL"),
                        field="to",
                    )
                ],
            )
        )
        
        console.print(f"First escalation sent to [yellow]{os.getenv('HL_EXAMPLE_SECOND_CONTACT_EMAIL')}[/yellow]. "
                      f"Waiting 5 more seconds and then sending to [red]{os.getenv('HL_EXAMPLE_THIRD_CONTACT_EMAIL')}[/red]...\n")
        
        # Wait another 5 seconds, then escalate to a different channel entirely
        time.sleep(5)
        
        # Second escalation: switch to different channel
        second_escalation = hl.escalate_email_function_call(
            call_id=call.call_id,
            escalation=Escalation(
                escalation_msg="URGENT: Still no response - escalating to management",
                channel=ContactChannel(
                    email=EmailContactChannel(
                        experimental_subject_line="FunctionCall Approval, a HumanLayer Test (2nd Escalation)",
                        address=os.getenv("HL_EXAMPLE_THIRD_CONTACT_EMAIL"),
                    )
                ),
            )
        )
        
        json_output = second_escalation.model_dump_json(indent=2)
        syntax = Syntax(json_output, "json", theme="monokai", line_numbers=False)
        console.print("Check your emails - escalated to different address:")
        console.print(syntax)
        
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        sys.exit(1)


if __name__ == "__main__":
    main()