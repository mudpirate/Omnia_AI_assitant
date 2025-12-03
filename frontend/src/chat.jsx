import React, { useState, useRef, useEffect } from "react";

// --- Minimalist SVG Icons ---
const UserIcon = (props) => (
  <svg
    {...props}
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

const SparkleIcon = (props) => (
  <svg
    {...props}
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962l6.135-1.583A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0l1.581 6.135a2 2 0 0 0 1.437 1.437l6.135 1.583a.5.5 0 0 1 0 .962l-6.135 1.582c-.745.192-1.245.692-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
  </svg>
);

const LinkIcon = (props) => (
  <svg
    {...props}
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);

const SendIcon = (props) => (
  <svg
    {...props}
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="m22 2-7 20-4-9-9-4Z" />
    <path d="M22 2 11 13" />
  </svg>
);

const ShoppingBagIcon = (props) => (
  <svg
    {...props}
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
    <path d="M3 6h18" />
    <path d="M16 10a4 4 0 0 1-8 0" />
  </svg>
);

// --- CSS for Animations ---
const styles = `
  @keyframes fadeInUp {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .animate-fade-in-up {
    animation: fadeInUp 0.5s ease-out forwards;
  }
  @keyframes pulse-soft {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.2; }
  }
  .animate-pulse-soft {
    animation: pulse-soft 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  }
`;

// --- Loader Component ---
const Loader = () => (
  <div className="flex items-center space-x-1.5 p-1">
    <div className="w-1.5 h-1.5 rounded-full bg-white animate-bounce [animation-delay:-0.3s]" />
    <div className="w-1.5 h-1.5 rounded-full bg-white animate-bounce [animation-delay:-0.15s]" />
    <div className="w-1.5 h-1.5 rounded-full bg-white animate-bounce" />
  </div>
);

// --- Product Card Component ---
const ProductCard = ({ product }) => {
  const formatPrice = (price) => {
    const num = parseFloat(price);
    return isNaN(num) ? "N/A" : num.toFixed(3);
  };

  return (
    <div className="group relative flex flex-col sm:flex-row gap-5 p-5 bg-black  border border-zinc-800 rounded-2xl hover:border-zinc-600 transition-all duration-300">
      {/* Product Image */}
      <div className="shrink-0 w-full sm:w-36 h-36 bg-black rounded-xl border border-zinc-800 overflow-hidden flex items-center justify-center relative">
        <img
          src={product.image_url}
          alt={product.product_name}
          className="w-full h-full object-contain p-3 opacity-90 group-hover:scale-110 group-hover:opacity-100 transition-all duration-500"
          onError={(e) => {
            e.target.onerror = null;
            e.target.src =
              "https://placehold.co/200x200/000000/FFFFFF?text=No+Image";
          }}
        />
      </div>

      {/* Product Details */}
      <div className="flex-1 flex flex-col justify-between">
        <div>
          <div className="flex justify-between items-start gap-3">
            <h3 className="text-lg font-bold text-white leading-tight group-hover:underline decoration-1 underline-offset-4 transition-all">
              {product.product_name}
            </h3>
            <span className="shrink-0 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider bg-zinc-800 text-zinc-400 border border-zinc-700 rounded-full">
              {product.store_name}
            </span>
          </div>

          {/* Description */}
          <div className="mt-3 text-sm text-zinc-400 leading-relaxed font-normal line-clamp-3">
            {product.product_description}
          </div>
        </div>

        {/* Price & Action */}
        <div className="mt-5 flex items-end justify-between border-t border-zinc-800 pt-4">
          <div>
            <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">
              Best Price
            </span>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold text-white tracking-tight">
                {formatPrice(product.price_kwd)}
              </span>
              <span className="text-sm font-medium text-zinc-400">KWD</span>
            </div>
          </div>

          <a
            href={product.product_url}
            target="_blank"
            rel="noopener noreferrer"
            // High contrast button: White bg, Black text
            className="flex items-center gap-2 px-5 py-2.5 bg-white text-black text-sm font-bold rounded-xl hover:bg-zinc-200 transition-all duration-200 transform active:scale-95"
          >
            <span>View Deal</span>
            <LinkIcon className="w-4 h-4" />
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
      className={`w-full py-5 animate-fade-in-up ${
        isUser ? "bg-black" : "bg-black border-y border-zinc-900"
      }`}
    >
      <div className="max-w-4xl mx-auto px-4 sm:px-6 flex gap-4 sm:gap-6">
        {/* Avatar */}
        <div
          className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center border ${
            isUser
              ? "bg-black border-white text-white"
              : "bg-black border-zinc-800 text-white "
          }`}
        >
          {isUser ? (
            <UserIcon className="w-5 h-5" />
          ) : (
            <SparkleIcon className="w-5 h-5" />
          )}
        </div>

        {/* Content Bubble */}
        <div className="flex-1 min-w-0">
          <div
            className={`relative px-6 py-1 rounded-2xl text-[15px] leading-7 ${
              isUser
                ? "bg-black text-white rounded-tr-none  font-semibold"
                : "text-zinc-300 rounded-tl-none"
            }`}
          >
            {/* Text Content */}
            <p className="whitespace-pre-wrap font-semibold">{message.text}</p>
          </div>

          {/* Product Grid */}
          {hasProducts && (
            <div className="mt-6 space-y-5">
              <div className="flex items-center gap-2 px-1">
                <div className="h-px flex-1 bg-zinc-800"></div>
                <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider flex items-center gap-1">
                  <ShoppingBagIcon className="w-3.5 h-3.5" />
                  {message.products.length} Recommendations
                </span>
                <div className="h-px flex-1 bg-zinc-800"></div>
              </div>

              <div className="grid grid-cols-1 gap-4">
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

// --- Splash Screen ---
const Splash = () => (
  <div className="flex flex-col items-center justify-center h-full text-center px-6 animate-fade-in-up">
    <div className="relative mb-8">
      {/* Glow Effect */}
      <div className="absolute inset-0 bg-white blur-3xl opacity-10 rounded-full animate-pulse-soft"></div>
      <div className="relative w-24 h-24 bg-black rounded-3xl flex items-center justify-center border border-zinc-800">
        <SparkleIcon className="w-10 h-10 text-white" />
      </div>
    </div>

    <h1 className="text-5xl font-semibold text-white mb-4 tracking-tight">
      OMNIA AI
    </h1>
    <p className="text-zinc-500 text-lg max-w-md mx-auto leading-relaxed mb-8">
      Your smart shopping assistant for the Kuwaiti electronics market.
    </p>

    <div className="flex gap-2 flex-wrap justify-center">
      {["iPhone 15 Pro", "Sony Headphones", "Gaming Laptop"].map((tag) => (
        <span
          key={tag}
          className="px-3 py-1 bg-zinc-900 text-zinc-400 text-xs font-medium rounded-full border border-zinc-800"
        >
          {tag}
        </span>
      ))}
    </div>
  </div>
);

// --- Main Application ---
export default function ChatApp() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

  useEffect(() => {
    // Inject styles
    const styleSheet = document.createElement("style");
    styleSheet.innerText = styles;
    document.head.appendChild(styleSheet);

    setTimeout(() => {
      setMessages([
        {
          id: "init",
          text: "Hello. I'm Omnia. What electronics are you looking for?",
          sender: "ai",
          products: [],
        },
      ]);
    }, 600);
    return () => document.head.removeChild(styleSheet);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const handleSendMessage = async (e) => {
    e.preventDefault();
    const query = input.trim();
    if (!query || isLoading) return;

    const userMsg = { id: Date.now(), text: query, sender: "user" };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });

      if (!response.ok) throw new Error("Server error");
      const data = await response.json();

      const aiMsg = {
        id: Date.now() + 1,
        text: data.reply || data.message || "Here is what I found:",
        sender: "ai",
        products: data.products || [],
      };

      setMessages((prev) => [...prev, aiMsg]);
    } catch (error) {
      console.error(error);
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          text: "Connection error. Please check server status.",
          sender: "ai",
          products: [],
        },
      ]);
    } finally {
      setIsLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const showSplash = messages.length === 1 && !isLoading;

  return (
    <div className="flex flex-col h-screen bg-black font-sans text-white selection:bg-white selection:text-black">
      {/* Header */}
      <header className="fixed top-0 w-full z-50 bg-black backdrop-blur-md border-b border-white/5">
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center text-black">
              <SparkleIcon className="w-4 h-4" />
            </div>
            <span className=" font-semibold text-lg tracking-wider text-white">
              OMNIA AI
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
            <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
              Online
            </span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto pt-20 pb-36 scroll-smooth">
        {showSplash ? (
          <div className="h-full flex flex-col justify-center pb-20">
            <Splash />
          </div>
        ) : (
          <div className="flex flex-col pb-4">
            {messages.map((msg) => (
              <Message key={msg.id} message={msg} />
            ))}

            {isLoading && (
              <div className="w-full py-6">
                <div className="max-w-4xl mx-auto px-4 sm:px-6 flex gap-4">
                  <div className="w-10 h-10 rounded-full bg-black border border-zinc-800 flex items-center justify-center shrink-0">
                    <SparkleIcon className="w-5 h-5 text-zinc-500" />
                  </div>
                  <div className="flex items-center gap-3 px-5 py-3">
                    <span className="text-sm font-medium text-zinc-500">
                      Searching database
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

      {/* Input Area */}
      <footer className="fixed bottom-0 w-full p-4 z-50 pointer-events-none">
        <div className="max-w-3xl mx-auto pointer-events-auto">
          <form
            onSubmit={handleSendMessage}
            className="relative flex items-center gap-2 bg-black backdrop-blur-xl p-2 rounded-full border border-zinc-800 shadow-2xl transition-all focus-within:border-zinc-600"
          >
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Search products..."
              className="flex-1  px-6 py-3 text-white focus:outline-none text-base"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="p-3 bg-white text-black rounded-full hover:bg-gray-200 disabled:opacity-50 transition-all duration-200"
            >
              <SendIcon className="w-5 h-5 ml-0.5" />
            </button>
          </form>
          <div className="text-center mt-3">
            <p className="text-[10px] text-zinc-600 uppercase tracking-widest">
              AI Powered Search
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
