import React, { useState, useEffect, useRef } from "react";
import {
  Send,
  Loader2,
  ShoppingBag,
  ExternalLink,
  Search,
  Sparkles,
} from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput("");

    // Add user message to chat
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setIsLoading(true);

    try {
      const response = await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: userMessage,
          sessionId: sessionId,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      // Update session ID if new
      if (data.sessionId && !sessionId) {
        setSessionId(data.sessionId);
      }

      // Add assistant message with products
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.reply,
          products: data.products || [],
        },
      ]);
    } catch (error) {
      console.error("Error sending message:", error);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "❌ Sorry, I encountered an error. Please try again.",
          error: true,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-br from-indigo-500 to-purple-600 p-2 rounded-xl">
              <ShoppingBag className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
                Omnia AI
              </h1>
              <p className="text-sm text-slate-600">
                Your Smart Shopping Assistant
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Messages Container */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-5xl mx-auto space-y-6">
          {messages.length === 0 && (
            <div className="text-center py-12">
              <div className="bg-gradient-to-br from-indigo-500 to-purple-600 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg">
                <Sparkles className="w-10 h-10 text-white" />
              </div>
              <h2 className="text-2xl font-semibold text-slate-800 mb-2">
                Welcome to Omnia AI
              </h2>
              <p className="text-slate-600 mb-6">
                Find the best electronics in Kuwait. Just ask me anything!
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 max-w-3xl mx-auto">
                {[
                  "iPhone 15 Pro Max 512GB",
                  "Gaming laptops under 800 KWD",
                  "Black wireless headphones",
                ].map((example, idx) => (
                  <button
                    key={idx}
                    onClick={() => setInput(example)}
                    className="px-4 py-3 bg-white border-2 border-slate-200 rounded-xl hover:border-indigo-400 hover:shadow-md transition-all text-sm text-slate-700 font-medium"
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message, index) => (
            <MessageBubble key={index} message={message} />
          ))}

          {isLoading && (
            <div className="flex items-center gap-3 text-slate-600">
              <div className="bg-white rounded-2xl px-4 py-3 shadow-sm border border-slate-200">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
                  <span className="text-sm">Searching products...</span>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Area */}
      <div className="bg-white border-t border-slate-200 shadow-lg">
        <div className="max-w-5xl mx-auto px-4 py-4">
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Ask me about electronics in Kuwait..."
                className="w-full px-4 py-3 pr-12 border-2 border-slate-200 rounded-xl focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all"
                disabled={isLoading}
              />
              <Search className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            </div>
            <button
              onClick={handleSend}
              disabled={isLoading || !input.trim()}
              className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-6 py-3 rounded-xl hover:from-indigo-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2 shadow-md hover:shadow-lg"
            >
              {isLoading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Send className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-4xl ${isUser ? "w-auto" : "w-full"}`}>
        {isUser ? (
          <div className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-2xl px-5 py-3 shadow-md">
            <p className="whitespace-pre-wrap">{message.content}</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl px-5 py-4 shadow-sm border border-slate-200">
              <div className="prose prose-sm max-w-none">
                <p className="whitespace-pre-wrap text-slate-700 leading-relaxed">
                  {message.content}
                </p>
              </div>
            </div>

            {/* Product Cards */}
            {message.products && message.products.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {message.products.map((product, idx) => (
                  <ProductCard key={idx} product={product} index={idx} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ProductCard({ product, index }) {
  // Format specs to show most important ones first
  const getDisplaySpecs = () => {
    if (!product.specs || typeof product.specs !== "object") return [];

    const specEntries = Object.entries(product.specs);
    const priorityKeys = [
      "storage",
      "ram",
      "color",
      "size",
      "screen_size",
      "processor",
    ];

    // Sort specs by priority
    const sorted = specEntries.sort((a, b) => {
      const aIndex = priorityKeys.indexOf(a[0].toLowerCase());
      const bIndex = priorityKeys.indexOf(b[0].toLowerCase());
      if (aIndex === -1 && bIndex === -1) return 0;
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    });

    return sorted.slice(0, 4);
  };

  const displaySpecs = getDisplaySpecs();

  return (
    <div className="bg-white rounded-xl shadow-md hover:shadow-xl transition-all duration-300 overflow-hidden border border-slate-200 group">
      {/* Product Image */}
      {product.imageUrl && (
        <div className="relative h-48 bg-slate-100 overflow-hidden">
          <img
            src={product.imageUrl}
            alt={product.title}
            className="w-full h-full object-contain p-4 group-hover:scale-105 transition-transform duration-300"
            onError={(e) => {
              e.target.style.display = "none";
            }}
          />
          <div className="absolute top-3 left-3 bg-indigo-600 text-white px-3 py-1 rounded-full text-xs font-semibold">
            #{index + 1}
          </div>
        </div>
      )}

      {/* Product Info */}
      <div className="p-4 space-y-3">
        {/* Title */}
        <h3 className="font-semibold text-slate-800 line-clamp-2 text-sm leading-tight min-h-[2.5rem]">
          {product.title}
        </h3>

        {/* Price and Store */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col">
            <span className="text-2xl font-bold text-indigo-600">
              {parseFloat(product.price).toFixed(3)}
            </span>
            <span className="text-xs text-slate-400 font-medium">KWD</span>
            {product.storeName && (
              <span className="text-xs text-slate-500 font-medium mt-1">
                {formatStoreName(product.storeName)}
              </span>
            )}
          </div>
          {product.category && (
            <span className="bg-purple-100 text-purple-700 px-2 py-1 rounded-full text-xs font-medium whitespace-nowrap">
              {formatCategory(product.category)}
            </span>
          )}
        </div>

        {/* Brand */}
        {product.brand && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Brand:</span>
            <span className="text-xs font-semibold text-slate-700 bg-slate-50 px-2 py-1 rounded">
              {product.brand}
            </span>
          </div>
        )}

        {/* Specs */}
        {displaySpecs.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {displaySpecs.map(([key, value], idx) => (
              <span
                key={idx}
                className="bg-slate-100 text-slate-700 px-2 py-1 rounded-md text-xs font-medium"
              >
                {formatSpecKey(key)}: {formatSpecValue(value)}
              </span>
            ))}
          </div>
        )}

        {/* Description */}
        {product.description && product.description.length > 10 && (
          <p className="text-xs text-slate-600 line-clamp-3 leading-relaxed">
            {product.description}
          </p>
        )}

        {/* View Product Button */}
        {product.productUrl && (
          <a
            href={product.productUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white py-2.5 rounded-lg transition-all font-medium text-sm shadow-sm hover:shadow-md mt-3"
          >
            View Product
            <ExternalLink className="w-4 h-4" />
          </a>
        )}
      </div>
    </div>
  );
}

function formatStoreName(storeName) {
  const storeMap = {
    XCITE: "Xcite",
    BEST: "Best",
    BEST_KW: "Best",
    NOON: "Noon",
    EUREKA: "Eureka",
  };
  return storeMap[storeName] || storeName.replace(/_/g, " ");
}

function formatCategory(category) {
  return category
    .replace(/_/g, " ")
    .toLowerCase()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatSpecKey(key) {
  return key
    .replace(/_/g, " ")
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatSpecValue(value) {
  if (typeof value === "string") {
    // Capitalize first letter
    return value.charAt(0).toUpperCase() + value.slice(1);
  }
  return value;
}

export default App;
