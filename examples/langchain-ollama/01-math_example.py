from llama_toolkit import LlamaToolkit
from humanlayer import HumanLayer


hl = HumanLayer(
    verbose=True,
    # run_id is optional -it can be used to identify the agent in approval history
    run_id="langchain-math",
)


# Example usage
def main():
    toolkit = LlamaToolkit(model_name="llama3.1", temperature=0.1)

    # Define your custom functions
    @toolkit.add_function()
    def calculate_square(x: int) -> int:
        """Calculate the square of a number."""
        return x * x

    @toolkit.add_function()
    def add_numbers(x: int, y: int) -> int:
        """Add two numbers together."""
        return x + y

    @toolkit.add_function()
    @hl.require_approval()
    def multiply_numbers(x: int, y: int) -> int:
        """Multiply two numbers together."""
        return x * y

    # Create agent
    agent = toolkit.create_agent()

    print("Llama Agent Ready with Custom Functions!")

    query = "multiply 5 and 3, then add 10 to the result"

    try:
        response = agent.invoke(query)
        print(f"\nFinal Answer: {response}")
    except Exception as e:
        print(f"Error: {str(e)}")


if __name__ == "__main__":
    main()

"""
Example queries to test:
1. "multiply 5 and 3, then add 10 to the result"
2. "calculate the square of 7, then multiply it by 2"
3. "add 5 and 3, then calculate the square of the result"
"""
