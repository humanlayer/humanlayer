"use client";

import { useChat } from "ai/react";
import { useEffect, useRef } from "react";

export default function Chat() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } =
    useChat({
      onToolCall: async ({ toolCall }) => {
        // Just log when we see the tool call
        console.log("Tool call:", toolCall);
      },
    });

  // Auto-scroll to bottom
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  return (
    <div className="flex flex-col w-full max-w-4xl mx-auto h-[90vh] p-4">
      <div className="flex-1 bg-white dark:bg-gray-800 rounded-lg shadow-xl overflow-hidden flex flex-col">
        {/* Messages Container */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex ${
                m.role === "user" ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className={`p-4 rounded-lg max-w-[80%] ${
                  m.role === "user"
                    ? "bg-[#426699] text-white"
                    : "bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-100"
                }`}
              >
                <div className="text-sm opacity-75 mb-1">
                  {m.role === "user" ? "You" : "Assistant"}
                </div>
                <p className="whitespace-pre-wrap">{m.content}</p>
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-100 p-4 rounded-lg max-w-[80%]">
                <div className="text-sm opacity-75 mb-1">Assistant</div>
                <div className="flex items-center h-6 space-x-2">
                  <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce [animation-delay:-0.3s]" />
                  <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce [animation-delay:-0.15s]" />
                  <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" />
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} /> {/* Auto-scroll anchor */}
        </div>

        {/* Input Form */}
        <div className="p-4 bg-gray-50 dark:bg-gray-900 border-t dark:border-gray-700">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              value={input}
              onChange={handleInputChange}
              placeholder="Ask about orders or request a refund..."
              className="flex-1 p-4 rounded-lg border border-gray-200 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-[#426699] dark:bg-gray-800 dark:text-gray-100 transition-colors"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className={`px-6 py-4 rounded-lg font-medium transition-colors ${
                isLoading || !input.trim()
                  ? "bg-gray-300 dark:bg-gray-600 cursor-not-allowed"
                  : "bg-[#426699] hover:bg-[#35547d] text-white shadow-lg hover:shadow-xl"
              }`}
            >
              Send
            </button>
          </form>

          {/* Example Queries */}
          <div className="mt-4 flex flex-wrap gap-2">
            {[
              "Show me my active orders",
              "I need a refund for order #123",
              "Can you help me get a refund? The product was damaged",
            ].map((query) => (
              <button
                key={query}
                onClick={() => {
                  handleInputChange({ target: { value: query } } as any);
                }}
                className="text-sm px-3 py-1.5 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
              >
                {query}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
