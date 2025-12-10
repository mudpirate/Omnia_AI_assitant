import React, { useState, useRef, useEffect } from "react";
// Import Icons
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
  FiExternalLink,
} from "react-icons/fi";
import { BsStars, BsHandbag, BsRobot } from "react-icons/bs";

// --- Styles ---
const styles = `
  @keyframes fadeInUp {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .animate-fade-in-up {
    animation: fadeInUp 0.4s ease-out forwards;
  }
  /* Hide scrollbar for clean look */
  .no-scrollbar::-webkit-scrollbar { display: none; }
  .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
`;

// --- Components ---

const ProductCard = ({ product }) => {
  const price = parseFloat(product.price_kwd).toFixed(3);
  const fallbackImage =
    "https://placehold.co/300x300/f3f4f6/a1a1aa?text=No+Image";

  return (
    <div className="group bg-white border border-gray-200 rounded-xl overflow-hidden hover:shadow-lg transition-all duration-300 w-full sm:w-[280px] flex-shrink-0 flex flex-col">
      {/* Image Area */}
      <div className="h-40 bg-gray-50 flex items-center justify-center p-4 relative overflow-hidden">
        <img
          src={product.image_url || fallbackImage}
          alt={product.product_name}
          className="h-full w-full object-contain mix-blend-multiply group-hover:scale-105 transition-transform duration-500"
          onError={(e) => (e.target.src = fallbackImage)}
        />
        <div className="absolute top-2 right-2 bg-white/90 backdrop-blur text-[10px] font-bold px-2 py-1 rounded-md border border-gray-100 shadow-sm uppercase tracking-wide text-gray-600">
          {product.store_name}
        </div>
      </div>

      {/* Content Area */}
      <div className="p-4 flex-1 flex flex-col justify-between">
        <div>
          <h3 className="text-sm font-bold text-gray-900 leading-snug line-clamp-2 mb-1 group-hover:text-indigo-600 transition-colors">
            {product.product_name}
          </h3>
          <p className="text-xs text-gray-500 line-clamp-2 mb-3">
            {product.product_description}
          </p>
        </div>

        <div className="flex items-end justify-between pt-3 border-t border-gray-100">
          <div>
            <span className="text-lg font-bold text-gray-900">{price}</span>
            <span className="text-xs font-medium text-gray-500 ml-1">KWD</span>
          </div>
          <a
            href={product.product_url}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-black text-white p-2 rounded-lg hover:bg-gray-800 transition-colors"
            title="View Product"
          >
            <FiExternalLink className="w-4 h-4" />
          </a>
        </div>
      </div>
    </div>
  );
};

const ChatMessage = ({ message }) => {
  const isUser = message.sender === "user";
  const hasProducts = message.products && message.products.length > 0;

  return (
    <div
      className={`w-full py-6 ${
        !isUser ? "bg-gray-50/50" : ""
      } animate-fade-in-up`}
    >
      <div className="max-w-4xl mx-auto px-4 sm:px-6 flex gap-4">
        {/* Avatar */}
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 border ${
            isUser
              ? "bg-white border-gray-200"
              : "bg-indigo-50 border-indigo-100"
          }`}
        >
          {isUser ? (
            <FiUser className="w-4 h-4 text-gray-600" />
          ) : (
            <BsStars className="w-4 h-4 text-indigo-600" />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 space-y-4 overflow-hidden">
          {/* Text Bubble */}
          <div
            className={`text-[15px] leading-relaxed text-gray-800 whitespace-pre-wrap ${
              isUser
                ? "bg-gray-100 px-4 py-2.5 rounded-2xl rounded-tl-none inline-block font-medium"
                : ""
            }`}
          >
            {message.text}
          </div>

          {/* Product Carousel / Grid */}
          {hasProducts && (
            <div className="mt-4">
              <div className="flex items-center gap-2 mb-3">
                <BsHandbag className="text-indigo-500 w-3.5 h-3.5" />
                <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                  Found {message.products.length} Items
                </span>
                <div className="h-px bg-gray-200 flex-1" />
              </div>

              {/* Horizontal Scroll for Mobile, Grid for Desktop */}
              <div className="flex flex-nowrap sm:grid sm:grid-cols-2 lg:grid-cols-3 gap-4 overflow-x-auto sm:overflow-visible pb-4 sm:pb-0 px-1 no-scrollbar">
                {message.products.map((prod, idx) => (
                  <ProductCard key={idx} product={prod} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// --- Main App ---
export default function ChatApp() {
  const [messages, setMessages] = useState([
    {
      id: "init",
      text: "Hello! I'm Omnia. Looking for a new phone or laptop? Ask me anything!",
      sender: "ai",
      products: [],
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const messagesEndRef = useRef(null);

  // Inject Styles
  useEffect(() => {
    const styleEl = document.createElement("style");
    styleEl.innerText = styles;
    document.head.appendChild(styleEl);

    const handleResize = () => setSidebarOpen(window.innerWidth >= 1024);
    window.addEventListener("resize", handleResize);
    handleResize();

    return () => {
      document.head.removeChild(styleEl);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  // Auto Scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userText = input.trim();
    setMessages((prev) => [
      ...prev,
      { id: Date.now(), text: userText, sender: "user" },
    ]);
    setInput("");
    setIsLoading(true);

    try {
      const res = await fetch("http://localhost:4000/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: userText, sessionId }),
      });

      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();

      if (data.sessionId) setSessionId(data.sessionId);

      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          text: data.reply || "Here is what I found:",
          sender: "ai",
          products: data.products || [],
        },
      ]);
    } catch (err) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          text: "Sorry, I'm having trouble connecting right now.",
          sender: "ai",
          products: [],
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-screen bg-white text-gray-900 font-sans overflow-hidden">
      {/* Sidebar (Simplified for Brevity) */}
      <div
        className={`${
          sidebarOpen ? "w-64" : "w-0"
        } bg-black text-white transition-all duration-300 flex flex-col overflow-hidden shrink-0 border-r border-gray-800`}
      >
        <div className="p-5 font-bold text-xl tracking-tight flex items-center gap-2">
          <BsRobot className="text-indigo-500" /> Omnia AI
        </div>
        <div className="flex-1 p-3 space-y-1">
          <button
            onClick={() => setMessages([])}
            className="w-full text-left px-4 py-3 rounded-xl bg-white/10 hover:bg-white/20 transition text-sm font-medium flex items-center gap-2"
          >
            <FiPlus /> New Chat
          </button>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col h-full relative">
        {/* Mobile Header */}
        <div className="lg:hidden h-14 border-b flex items-center px-4 justify-between bg-white z-20">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-2 -ml-2 text-gray-600"
          >
            <FiMenu className="w-6 h-6" />
          </button>
          <span className="font-bold">Omnia AI</span>
          <div className="w-6" />
        </div>

        {/* Messages List */}
        <div className="flex-1 overflow-y-auto scroll-smooth">
          <div className="flex flex-col min-h-full pb-32 pt-4">
            {messages.length === 0 && (
              <div className="flex-1 flex items-center justify-center text-gray-300 font-bold text-2xl">
                Start a conversation...
              </div>
            )}
            {messages.map((msg) => (
              <ChatMessage key={msg.id} message={msg} />
            ))}

            {isLoading && (
              <div className="w-full py-6">
                <div className="max-w-4xl mx-auto px-4 flex gap-4">
                  <div className="w-8 h-8 rounded-full bg-indigo-50 flex items-center justify-center border border-indigo-100">
                    <div className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                  </div>
                  <div className="text-sm text-gray-400 font-medium py-1.5 animate-pulse">
                    Thinking...
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input Footer */}
        <div className="absolute bottom-0 w-full p-4 bg-gradient-to-t from-white via-white to-white/0">
          <div className="max-w-3xl mx-auto relative">
            <form
              onSubmit={handleSend}
              className="relative flex items-center gap-2 bg-white p-2 rounded-2xl border border-gray-200 shadow-xl shadow-gray-100/50 focus-within:ring-2 focus-within:ring-indigo-100 transition-all"
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about prices, specs, or deals..."
                className="flex-1 px-4 py-3 bg-transparent outline-none text-base placeholder:text-gray-400"
                disabled={isLoading}
              />
              <button
                type="submit"
                disabled={!input.trim() || isLoading}
                className="p-3 bg-black text-white rounded-xl hover:bg-gray-800 disabled:opacity-50 disabled:hover:bg-black transition-all"
              >
                <FiSend className="w-5 h-5" />
              </button>
            </form>
            <p className="text-center text-[10px] text-gray-400 mt-2 font-medium">
              AI-generated results. Check store for latest prices.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
