
# State Management Guide

**Description:** This document provides a comprehensive guide to using the `state` parameter in `FunctionCallSpec` and `HumanContactSpec`, focusing on best practices for maintaining conversation context and managing state versioning.

**Target Audience:** Developers, Solution Architects

**Related Endpoints:**

*   `/humanlayer/v1/function_calls`
*   `/humanlayer/v1/human_contacts`

## State Parameter Overview

The `state` parameter in both `FunctionCallSpec` and `HumanContactSpec` allows you to persist data across multiple interactions within a conversation. This is crucial for building stateful agent workflows where the agent needs to remember previous interactions and use that information to inform future actions.

The `state` parameter is a JSON object that can contain any data relevant to the conversation.  It is passed back to your application with each response, allowing you to update it and send it back in the next request.

**Key Use Cases:**

*   **Maintaining Conversation History:** Store a log of previous user inputs and agent responses.
*   **Tracking User Preferences:** Remember user preferences (e.g., language, currency, notification settings).
*   **Managing Multi-Step Processes:** Track the progress of a multi-step process (e.g., booking a flight, ordering a product).
*   **Contextual Understanding:** Provide the agent with the necessary context to understand the current user request.

## State Versioning

As your application evolves, the structure of the `state` object may need to change. To handle these changes gracefully, it's essential to implement state versioning.

**Recommended Approach:**

1.  **Include a `version` field in the `state` object:** This field indicates the schema version of the state data.

    ```json
    {
      "version": "1.0",
      "user_id": "12345",
      "preferences": {
        "language": "en",
        "currency": "USD"
      }
    }
    ```

2.  **Implement migration logic:** When processing a request, check the `version` field and apply any necessary migrations to bring the state data up to the latest version.

**Example: State Migration**

Let's say you want to add a new field `timezone` to the `preferences` object in version 2.0.

*   **Version 1.0 State:**

    ```json
    {
      "version": "1.0",
      "user_id": "12345",
      "preferences": {
        "language": "en",
        "currency": "USD"
      }
    }
    ```

*   **Migration Logic (Python):**

    ```python
    def migrate_state(state):
      version = state.get("version", "1.0") # Default to 1.0 if version is missing

      if version == "1.0":
        state["preferences"]["timezone"] = "UTC"  # Default timezone
        state["version"] = "2.0"

      return state

    # Example usage:
    old_state = {"version": "1.0", "user_id": "12345", "preferences": {"language": "en", "currency": "USD"}}
    new_state = migrate_state(old_state)
    print(new_state)
    ```

    **Output:**

    ```json
    {
      "version": "2.0",
      "user_id": "12345",
      "preferences": {
        "language": "en",
        "currency": "USD",
        "timezone": "UTC"
      }
    }
    ```

3.  **Handle Missing Version:** If the `version` field is missing, assume it's the oldest version and apply all necessary migrations.

## Context Management

Effective context management is crucial for creating natural and engaging conversations. The `state` parameter provides a mechanism for storing and retrieving context across interactions.

**Strategies for Context Management:**

*   **Explicit Context:** Store specific pieces of information that are relevant to the current conversation. For example, if the user is booking a flight, store the origin, destination, and dates.

    ```json
    {
      "version": "2.0",
      "booking_details": {
        "origin": "JFK",
        "destination": "LAX",
        "departure_date": "2024-01-15",
        "return_date": "2024-01-22"
      }
    }
    ```

*   **Conversation History:** Maintain a log of previous user inputs and agent responses. This can be useful for understanding the user's intent and providing more relevant responses.  Be mindful of the size of the history and consider truncating it after a certain number of turns or when it exceeds a certain size limit.

    ```json
    {
      "version": "2.0",
      "conversation_history": [
        {"user": "I want to book a flight to Los Angeles."},
        {"agent": "Okay, from where are you flying?"},
        {"user": "From New York."}
      ]
    }
    ```

*   **Intent Tracking:** Store the user's inferred intent. This can help the agent understand the user's goal and provide more targeted assistance.

    ```json
    {
      "version": "2.0",
      "intent": "book_flight",
      "entities": {
        "destination": "Los Angeles",
        "origin": "New York"
      }
    }
    ```

## Best Practices

*   **Keep the `state` object small:** Large `state` objects can impact performance. Only store data that is essential for maintaining context.
*   **Use a consistent data structure:** Define a clear schema for the `state` object and adhere to it consistently.
*   **Implement state versioning:** This is crucial for handling changes to the `state` object over time.
*   **Handle errors gracefully:** If there is an error processing the `state` object, log the error and provide a fallback mechanism.
*   **Consider data privacy:** Be mindful of the data you are storing in the `state` object and ensure that it complies with all applicable privacy regulations.  Avoid storing sensitive information unless absolutely necessary and ensure it is properly encrypted.
*   **Test thoroughly:** Test your state management logic thoroughly to ensure that it is working correctly and that the agent is maintaining context accurately.
*   **Document your state schema:** Clearly document the structure of your state object, including the purpose of each field and its data type. This will make it easier for other developers to understand and maintain your code.
*   **Use descriptive field names:** Choose field names that clearly indicate the purpose of the data they contain.
*   **Regularly review and refactor your state management logic:** As your application evolves, your state management logic may become more complex. Regularly review and refactor your code to ensure that it remains maintainable and efficient.
