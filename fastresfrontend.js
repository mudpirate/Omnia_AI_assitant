import React, { useState, useRef, useEffect } from "react";
// Import React Icons
import {
  FiMenu,
  FiPlus,
  FiMessageSquare,
  FiSettings,
  FiLogOut,
  FiCpu,
  FiUser,
  FiHelpCircle,
  FiChevronLeft,
  FiChevronRight,
  FiSend,
  FiLink,
} from "react-icons/fi";
import { BsStars, BsHandbag } from "react-icons/bs";

// --- CSS for Animations ---
const styles = `
  @keyframes fadeInUp {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .animate-fade-in-up {
    animation: fadeInUp 0.5s ease-out forwards;
  }
  .scrollbar-hide::-webkit-scrollbar {
    display: none;
  }
  .scrollbar-hide {
    -ms-overflow-style: none;
    scrollbar-width: none;
  }
`;

// --- Loader Component ---
const Loader = () => (
  <div className="flex items-center space-x-1.5 p-1">
    <div className="w-1.5 h-1.5 rounded-full bg-zinc-600 animate-bounce [animation-delay:-0.3s]" />
    <div className="w-1.5 h-1.5 rounded-full bg-zinc-600 animate-bounce [animation-delay:-0.15s]" />
    <div className="w-1.5 h-1.5 rounded-full bg-zinc-600 animate-bounce" />
  </div>
);

// --- Product Card Component ---
const ProductCard = ({ product }) => {
  const formatPrice = (price) => {
    const num = parseFloat(price);
    return isNaN(num) ? "N/A" : num.toFixed(3);
  };

  return (
    <div className="group relative flex flex-col sm:flex-row gap-4 p-4 bg-white border border-zinc-200 rounded-2xl hover:shadow-lg transition-all duration-300">
      <div className="shrink-0 w-full sm:w-32 h-32 bg-zinc-50 rounded-xl border border-zinc-100 overflow-hidden flex items-center justify-center relative">
        <img
          src={product.image_url}
          alt={product.product_name}
          className="w-full h-full object-contain p-2 mix-blend-multiply group-hover:scale-110 transition-all duration-500"
          onError={(e) => {
            e.target.onerror = null;
            e.target.src =
              "https://placehold.co/200x200/f4f4f5/a1a1aa?text=No+Image";
          }}
        />
      </div>
      <div className="flex-1 flex flex-col justify-between">
        <div>
          <div className="flex justify-between items-start gap-3">
            <h3 className="text-base font-bold text-zinc-900 leading-tight group-hover:text-blue-600 transition-colors">
              {product.product_name}
            </h3>
            <span className="shrink-0 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-zinc-100 text-zinc-600 border border-zinc-200 rounded-full">
              {product.store_name}
            </span>
          </div>
          <p className="mt-2 text-xs text-zinc-500 line-clamp-2">
            {product.product_description}
          </p>
        </div>
        <div className="mt-4 flex items-end justify-between border-t border-zinc-100 pt-3">
          <div>
            <div className="flex items-baseline gap-1">
              <span className="text-xl font-extrabold text-zinc-900">
                {formatPrice(product.price_kwd)}
              </span>
              <span className="text-xs font-semibold text-zinc-500">KWD</span>
            </div>
          </div>
          <a
            href={product.product_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2 bg-black text-white text-xs font-bold rounded-lg hover:bg-zinc-800 transition-all duration-200 active:scale-95"
          >
            <span>View Deal</span>
            <FiLink className="w-3 h-3" />
          </a>
        </div>
      </div>
    </div>
  );
};

// --- Message Component ---
const Message = ({ message }) => {
  const isUser = message.sender === "user";
  const hasProducts = message.products && message.products.length > 0;

  return (
    <div
      className={`w-full py-6 animate-fade-in-up ${
        isUser ? "" : "bg-gray-50/50"
      }`}
    >
      <div className="max-w-4xl mx-auto px-4 sm:px-6 flex gap-4 sm:gap-6">
        <div
          className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center border shadow-sm ${
            isUser
              ? "bg-white text-black border-gray-200"
              : "bg-white text-indigo-600 border-zinc-200"
          }`}
        >
          {isUser ? (
            <FiUser className="w-4 h-4" />
          ) : (
            <BsStars className="w-4 h-4" />
          )}
        </div>
        <div className="flex-1 min-w-0 pt-1">
          <div className="text-[15px] leading-7 text-zinc-800 font-medium">
            {isUser ? (
              <div className="bg-zinc-100 px-4 py-2 rounded-2xl rounded-tl-none inline-block text-zinc-900">
                {message.text}
              </div>
            ) : (
              <p className="whitespace-pre-wrap">{message.text}</p>
            )}
          </div>
          {hasProducts && (
            <div className="mt-6 space-y-4">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-1">
                  <BsHandbag className="w-3 h-3" />
                  Recommendations
                </span>
                <div className="h-px flex-1 bg-zinc-200"></div>
              </div>
              <div className="grid grid-cols-1 gap-3">
                {message.products.map((product, idx) => (
                  <ProductCard key={idx} product={product} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// --- Splash Screen Component (RESTORED) ---
const Splash = () => (
  <div className="flex flex-col items-center justify-center h-full text-center px-6 animate-fade-in-up">
    <div className="relative mb-6">
      <div className="absolute inset-0 bg-indigo-500 blur-3xl opacity-10 rounded-full"></div>
      <div className="relative w-20 h-20 bg-white rounded-2xl flex items-center justify-center border border-zinc-200 shadow-xl">
        <BsStars className="w-8 h-8 text-black" />
      </div>
    </div>

    <h1 className="text-4xl font-bold text-zinc-900 mb-3 tracking-tight">
      Omnia AI
    </h1>
    <p className="text-zinc-500 text-base max-w-sm mx-auto leading-relaxed mb-8">
      Your intelligent shopping assistant for the Kuwaiti electronics market.
    </p>

    <div className="flex gap-2 flex-wrap justify-center">
      {["iPhone 15 Pro", "Sony Headphones", "Gaming Laptop"].map((tag) => (
        <span
          key={tag}
          className="px-3 py-1.5 bg-white text-zinc-600 text-xs font-semibold rounded-full border border-zinc-200 shadow-sm hover:border-indigo-300 hover:text-indigo-600 cursor-pointer transition-colors"
        >
          {tag}
        </span>
      ))}
    </div>
  </div>
);

// --- Sidebar ---
const Sidebar = ({ isOpen, toggleSidebar, startNewChat }) => {
  return (
    <div
      className={`${
        isOpen ? "w-72" : "w-20"
      } bg-black h-screen flex flex-col justify-between transition-all duration-300 ease-in-out border-r border-zinc-900 shrink-0 relative z-50`}
    >
      <button
        onClick={toggleSidebar}
        className="absolute -right-3 top-8 w-6 h-6 bg-white border border-zinc-200 rounded-full flex items-center justify-center text-zinc-600 shadow-md hover:scale-110 transition-transform z-50 lg:hidden"
      >
        {isOpen ? <FiChevronLeft size={14} /> : <FiChevronRight size={14} />}
      </button>
      <div className="p-4 flex flex-col gap-6 overflow-hidden">
        <div
          className={`flex items-center gap-3 p-2 rounded-xl bg-zinc-900/50 border border-zinc-800 ${
            !isOpen && "justify-center"
          }`}
        >
          <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center text-black shrink-0 font-bold text-xs">
            M
          </div>
          <div
            className={`flex flex-col overflow-hidden transition-opacity duration-200 ${
              isOpen ? "opacity-100" : "opacity-0 w-0"
            }`}
          >
            <span className="text-sm font-semibold text-white whitespace-nowrap">
              Mishaal
            </span>
            <span className="text-[10px] text-zinc-500 whitespace-nowrap">
              Pro Plan
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          {[
            { icon: FiMessageSquare, label: "Mobile Shopping" },
            { icon: FiHelpCircle, label: "Guides and FAQ" },
          ].map((item, idx) => (
            <button
              key={idx}
              className={`flex items-center gap-3 p-3 rounded-lg text-zinc-400 hover:bg-zinc-900 hover:text-white transition-all group ${
                !isOpen && "justify-center"
              }`}
            >
              <item.icon className="w-5 h-5 shrink-0 group-hover:text-indigo-400 transition-colors" />
              <span
                className={`text-sm font-medium whitespace-nowrap transition-all duration-300 ${
                  isOpen
                    ? "opacity-100 translate-x-0"
                    : "opacity-0 -translate-x-4 w-0 overflow-hidden"
                }`}
              >
                {item.label}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="p-4 flex flex-col gap-2 bg-black border-t border-zinc-900">
        <button
          onClick={startNewChat}
          className={`mt-2 flex items-center gap-2 bg-white hover:bg-indigo-700 text-black rounded-xl shadow-lg shadow-indigo-900/20 transition-all active:scale-95 ${
            isOpen ? "px-4 py-3 justify-start" : "p-3 justify-center"
          }`}
        >
          <FiPlus className="w-5 h-5" />
          <span
            className={`font-semibold text-sm whitespace-nowrap transition-all duration-300 ${
              isOpen ? "w-auto opacity-100" : "w-0 opacity-0 overflow-hidden"
            }`}
          >
            New Chat
          </span>
        </button>
      </div>
    </div>
  );
};

// --- Main App ---
export default function ChatApp() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [loadingText, setLoadingText] = useState("Searching..."); // New State for Status updates
  const [sessionId, setSessionId] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

  useEffect(() => {
    const styleSheet = document.createElement("style");
    styleSheet.innerText = styles;
    document.head.appendChild(styleSheet);
    setTimeout(() => {
      setMessages([
        {
          id: "init",
          text: "Hello. I'm Omnia. What electronics are you looking for today?",
          sender: "ai",
          products: [],
        },
      ]);
    }, 600);
    const handleResize = () => {
      if (window.innerWidth < 1024) setSidebarOpen(false);
      else setSidebarOpen(true);
    };
    window.addEventListener("resize", handleResize);
    handleResize();
    return () => {
      document.head.removeChild(styleSheet);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading, loadingText]);

  // --- STREAMING HANDLER ---
  const handleSendMessage = async (e) => {
    e.preventDefault();
    const query = input.trim();
    if (!query || isLoading) return;

    // 1. Add User Message
    const userMsg = { id: Date.now(), text: query, sender: "user" };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);
    setLoadingText("Connecting...");

    // 2. Prepare AI Message Placeholder
    const aiMsgId = Date.now() + 1;
    const aiPlaceholder = { id: aiMsgId, text: "", sender: "ai", products: [] };
    setMessages((prev) => [...prev, aiPlaceholder]);

    try {
      const response = await fetch(`${API_BASE_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, sessionId }),
      });

      if (!response.ok) throw new Error("Server error");

      // 3. Setup Stream Reader
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process buffer by splitting double newlines (SSE format)
        const parts = buffer.split("\n\n");
        buffer = parts.pop(); // Keep incomplete part in buffer

        for (const part of parts) {
          if (!part.trim()) continue;

          const lines = part.split("\n");
          let eventType = null;
          let eventData = null;

          for (const line of lines) {
            if (line.startsWith("event: ")) {
              eventType = line.substring(7).trim();
            } else if (line.startsWith("data: ")) {
              try {
                eventData = JSON.parse(line.substring(6));
              } catch (e) {
                // Should not happen if backend sends valid JSON
                console.error("JSON parse error", e);
              }
            }
          }

          if (eventType && eventData !== null) {
            handleStreamEvent(eventType, eventData, aiMsgId);
          }
        }
      }
    } catch (error) {
      console.error(error);
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === aiMsgId
            ? { ...msg, text: "Connection error. Please check server." }
            : msg
        )
      );
    } finally {
      setIsLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  // --- EVENT DISPATCHER ---
  const handleStreamEvent = (type, data, msgId) => {
    switch (type) {
      case "session":
        setSessionId(data.sessionId);
        break;

      case "status":
        setLoadingText(data); // Update loading text (e.g., "Searching...", "Thinking...")
        break;

      case "products":
        // Immediate Product Render
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === msgId ? { ...msg, products: data } : msg
          )
        );
        break;

      case "token":
        // Append Text Token
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === msgId ? { ...msg, text: msg.text + data } : msg
          )
        );
        break;

      case "done":
        setIsLoading(false);
        break;

      case "error":
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === msgId ? { ...msg, text: "Something went wrong." } : msg
          )
        );
        setIsLoading(false);
        break;

      default:
        break;
    }
  };

  const startNewChat = () => {
    setMessages([
      {
        id: Date.now(),
        text: "Hello. I'm Omnia. What electronics are you looking for?",
        sender: "ai",
        products: [],
      },
    ]);
    setSessionId(null);
    setInput("");
  };

  const showSplash = messages.length === 1 && !isLoading;

  return (
    <div className="flex h-screen bg-white font-sans text-zinc-900 overflow-hidden">
      <Sidebar
        isOpen={sidebarOpen}
        toggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        startNewChat={startNewChat}
      />
      <div className="flex-1 flex flex-col h-full relative w-full">
        <header className="absolute top-0 w-full z-40 bg-white/80 backdrop-blur-md border-b border-zinc-100 lg:hidden">
          <div className="px-4 h-14 flex items-center justify-between">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 -ml-2 text-zinc-600"
            >
              <FiMenu size={20} />
            </button>
            <span className="font-bold text-zinc-900">Omnia AI</span>
            <div className="w-6" />
          </div>
        </header>
        <main className="flex-1 overflow-y-auto scroll-smooth bg-white">
          {showSplash ? (
            <div className="h-full flex flex-col justify-center pb-20">
              <Splash />
            </div>
          ) : (
            <div className="flex flex-col pb-36 pt-14 lg:pt-4">
              {messages.map((msg) => (
                <Message key={msg.id} message={msg} />
              ))}
              {isLoading && (
                <div className="w-full py-6">
                  <div className="max-w-4xl mx-auto px-4 sm:px-6 flex gap-4">
                    <div className="w-9 h-9 rounded-full bg-white border border-zinc-200 flex items-center justify-center shrink-0">
                      <BsStars className="w-4 h-4 text-zinc-400" />
                    </div>
                    <div className="flex items-center gap-3 px-4 py-2 bg-zinc-50 rounded-2xl rounded-tl-none">
                      <span className="text-sm font-medium text-zinc-500">
                        {loadingText}
                      </span>
                      <Loader />
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </main>
        <div className="absolute bottom-0 w-full p-4 lg:p-6 bg-gradient-to-t from-white via-white to-transparent z-10">
          <div className="max-w-3xl mx-auto">
            <form
              onSubmit={handleSendMessage}
              className="relative flex items-center gap-2 bg-white p-2 rounded-2xl border border-zinc-200 shadow-xl shadow-zinc-200/50 focus-within:ring-2 focus-within:ring-indigo-100 transition-all"
            >
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask anything about electronics..."
                className="flex-1 px-4 py-3 bg-transparent text-zinc-900 placeholder:text-zinc-400 focus:outline-none text-base"
                disabled={isLoading}
              />
              <button
                type="submit"
                disabled={isLoading || !input.trim()}
                className="p-3 bg-white text-black rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:hover:bg-indigo-600 transition-all duration-200 shadow-md shadow-indigo-200"
              >
                <FiSend className="w-5 h-5 ml-0.5" />
              </button>
            </form>
            <div className="text-center mt-3">
              <p className="text-[10px] text-zinc-400 font-medium">
                OMNIA AI can make mistakes. Check important info.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
