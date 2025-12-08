import React, { useState, useRef, useEffect } from "react";
import { Send, User, Bot, Loader2, Sparkles } from "lucide-react";

const API_URL = "http://localhost:4000/chat";

export default function TextChat() {
  const [messages, setMessages] = useState([
    {
      id: "welcome",
      role: "assistant",
      content: "Hello! I'm Omnia. What electronics are you looking for today?",
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState(null);

  // Auto-scroll to bottom
  const messagesEndRef = useRef(null);
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };
  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = { id: Date.now(), role: "user", content: input };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: userMessage.content, sessionId }),
      });

      const data = await res.json();

      if (data.sessionId) setSessionId(data.sessionId);

      // We ONLY use data.reply (Text), completely ignoring data.products
      const aiMessage = {
        id: Date.now() + 1,
        role: "assistant",
        content:
          data.reply ||
          "I found some results, but I can't display them right now.",
      };

      setMessages((prev) => [...prev, aiMessage]);
    } catch (error) {
      console.error("Chat error:", error);
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          role: "assistant",
          content: "Sorry, I'm having trouble connecting to the server.",
          isError: true,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-screen bg-gray-50 text-gray-900 font-sans">
      <div className="w-full max-w-2xl mx-auto flex flex-col h-full bg-white shadow-xl border-x border-gray-100">
        {/* Header */}
        <header className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-white/80 backdrop-blur sticky top-0 z-10">
          <div className="flex items-center gap-2">
            <div className="bg-indigo-600 p-2 rounded-lg">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-lg text-gray-900">Omnia Chat</h1>
              <p className="text-xs text-gray-500 font-medium">
                Text-Only Mode
              </p>
            </div>
          </div>
        </header>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-thin scrollbar-thumb-gray-200">
          {messages.map((msg) => {
            const isUser = msg.role === "user";
            return (
              <div
                key={msg.id}
                className={`flex gap-4 ${
                  isUser ? "justify-end" : "justify-start"
                }`}
              >
                {/* Avatar (AI Only) */}
                {!isUser && (
                  <div className="w-8 h-8 rounded-full bg-indigo-100 border border-indigo-200 flex items-center justify-center shrink-0 mt-1">
                    <Bot className="w-5 h-5 text-indigo-600" />
                  </div>
                )}

                {/* Message Bubble */}
                <div
                  className={`relative max-w-[85%] px-5 py-3.5 rounded-2xl text-[15px] leading-relaxed shadow-sm ${
                    isUser
                      ? "bg-indigo-600 text-white rounded-br-sm"
                      : msg.isError
                      ? "bg-red-50 text-red-600 border border-red-100"
                      : "bg-gray-100 text-gray-800 rounded-bl-sm"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                </div>

                {/* Avatar (User Only) */}
                {isUser && (
                  <div className="w-8 h-8 rounded-full bg-gray-200 border border-gray-300 flex items-center justify-center shrink-0 mt-1">
                    <User className="w-5 h-5 text-gray-600" />
                  </div>
                )}
              </div>
            );
          })}

          {/* Loading Indicator */}
          {isLoading && (
            <div className="flex gap-4 justify-start animate-pulse">
              <div className="w-8 h-8 rounded-full bg-indigo-50 flex items-center justify-center shrink-0">
                <Bot className="w-5 h-5 text-indigo-300" />
              </div>
              <div className="bg-gray-50 px-5 py-4 rounded-2xl rounded-bl-sm border border-gray-100 flex items-center gap-2">
                <span className="text-xs font-medium text-gray-400">
                  Omnia is thinking
                </span>
                <Loader2 className="w-3 h-3 text-indigo-500 animate-spin" />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="p-4 border-t border-gray-100 bg-white">
          <form
            onSubmit={handleSend}
            className="flex items-center gap-2 bg-gray-50 p-2 rounded-xl border border-gray-200 focus-within:ring-2 focus-within:ring-indigo-100 focus-within:border-indigo-300 transition-all"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about phones, laptops..."
              className="flex-1 bg-transparent px-3 py-2 text-gray-900 placeholder:text-gray-400 focus:outline-none"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              className="p-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:hover:bg-indigo-600 transition-colors shadow-sm"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
          <p className="text-center text-[10px] text-gray-400 mt-2">
            AI can make mistakes. Check important info.
          </p>
        </div>
      </div>
    </div>
  );
}
