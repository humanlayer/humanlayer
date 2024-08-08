from crewai import Agent, Crew, Task
from crewai_tools import tool
from dotenv import load_dotenv

load_dotenv()

from functionlayer import ApprovalMethod, FunctionLayer

fl = FunctionLayer(approval_method=ApprovalMethod.CLOUD)

PROMPT = """multiply 2 and 5, then add 32 to the result"""


@tool
def add(a: int, b: int) -> int:
    """Add two numbers together."""
    return a + b


@tool
@fl.require_approval()
def multiply(a: int, b: int) -> int:
    """multiply two numbers"""
    return a * b


general_agent = Agent(
    role="Math Professor",
    goal="""Provide the solution to the students that are asking
    mathematical questions and give them the answer.""",
    backstory="""You are an excellent math professor that likes to solve math questions
    in a way that everyone can understand your solution""",
    allow_delegation=False,
    tools=[add],
    verbose=True,
    crew_sharing=False,
)

task = Task(
    description=PROMPT,
    agent=general_agent,
    expected_output="A numerical answer.",
)

crew = Crew(agents=[general_agent], tasks=[task], verbose=2)

if __name__ == "__main__":
    result = crew.kickoff()
    print("\n\n---------- RESULT ----------\n\n")
    print(result)
