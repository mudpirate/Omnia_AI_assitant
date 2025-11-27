import React, { useState, useRef, useEffect } from "react";

// --- SVG Icons ---
// Note: Icons remain the same, but their usage will reflect the new color theme
const UserIcon = (props) => (
  <svg
    {...props}
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

const SparkleIcon = (props) => (
  <svg
    {...props}
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M10 12l2 2 2-2M14 6l1 1 1-1M5 18l1 1 1-1M21 3l-1 1 1 1M3 21l1 1 1-1M12 2v2M20 12h2M12 20v2M2 12h2" />
  </svg>
);

const LinkIcon = (props) => (
  <svg
    {...props}
    xmlns="http://www.w3.org/2000/svg"
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M15 7h4a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-4" />
    <polyline points="10 21 3 14 10 7" />
    <line x1="21" y1="21" x2="14" y2="14" />
  </svg>
);

// Loader - Added a simple transition for subtlety
const Loader = () => (
  <div className="flex items-center space-x-2 p-3 text-cyan-400 transition-opacity duration-300">
    <div className="w-2 h-2 rounded-full bg-cyan-400 animate-bounce delay-100" />
    <div className="w-2 h-2 rounded-full bg-cyan-400 animate-bounce delay-200" />
    <div className="w-2 h-2 rounded-full bg-cyan-400 animate-bounce delay-300" />
  </div>
);

// Product Card - Redesigned for a more "designed" look
const ProductCard = ({ product }) => (
  <div className="group relative p-5 border border-gray-700 rounded-xl shadow-xl transition-all duration-300 bg-gray-800 hover:bg-gray-700/80 transform hover:-translate-y-0.5">
    <div className="flex gap-5">
      {/* Image with a darker placeholder style */}
      <div className="shrink-0 w-32 h-32 bg-gray-900 rounded-lg overflow-hidden flex items-center justify-center border border-gray-600 shadow-inner">
        <img
          src={product.image_url}
          alt={product.product_name}
          className="w-full h-full object-cover transition-opacity duration-300 group-hover:opacity-80"
          onError={(e) => {
            e.target.onerror = null;
            e.target.src =
              "https://placehold.co/128x128/1F2937/D1D5DB?text=NO_IMG";
          }}
        />
      </div>

      <div className="flex-1 min-w-0 text-white">
        <h3 className="text-xl font-bold text-white line-clamp-2 leading-tight">
          {product.product_name}
        </h3>

        <p className="text-3xl font-extrabold text-cyan-400 mt-2 font-mono">
          {typeof product.price_kwd === "number"
            ? product.price_kwd.toFixed(2)
            : product.price_kwd}{" "}
          KWD
        </p>

        <p className="text-sm text-gray-400 mt-2 italic">
          Sold by:{" "}
          <span className="font-semibold text-gray-200">
            {product.store_name}
          </span>
        </p>

        {/* Spec Highlights as distinct badges */}
        <div className="flex flex-wrap gap-2 mt-4">
          {Array.isArray(product.spec_highlights) &&
            product.spec_highlights.map((spec, idx) => (
              <span
                key={idx}
                className="px-3 py-1 text-xs font-medium bg-cyan-900/50 text-cyan-300 border border-cyan-800 rounded-full shadow-md"
              >
                {spec}
              </span>
            ))}
        </div>
      </div>
    </div>

    {/* Link button with new color scheme */}
    <a
      href={product.product_url}
      target="_blank"
      rel="noopener noreferrer"
      className="absolute top-4 right-4 p-2 rounded-full bg-cyan-600 hover:bg-cyan-500 text-white transition focus:outline-none focus:ring-4 focus:ring-cyan-500 focus:ring-opacity-50 shadow-lg"
      title="View Product Page"
    >
      <LinkIcon className="w-5 h-5" />
    </a>
  </div>
);

// Response container - Adjusted background and text color
const ProductResponse = ({ data }) => (
  <div className="space-y-4">
    <p className="text-gray-100 font-medium whitespace-pre-wrap px-4 pt-4">
      {data.message}
    </p>

    <div className="space-y-3 p-4 bg-gray-900 rounded-lg border border-gray-700 shadow-inner">
      <h4 className="text-sm font-semibold text-cyan-400 border-b border-gray-700 pb-2">
        ✨ Recommended Products:
      </h4>
      <div className="grid gap-4">
        {data.products.map((product, index) => (
          <ProductCard key={index} product={product} />
        ))}
      </div>
    </div>

    {data.disclaimer && (
      <div className="pt-2 text-sm text-gray-400 px-4 italic">
        {data.disclaimer}
      </div>
    )}
  </div>
);

// Message bubble - Dark theme and subtle alternating backgrounds
const Message = ({ message }) => {
  const isUser = message.sender === "user";
  const hasStructuredData =
    message.sender === "ai" && message.data && message.data.products;

  const userIcon = (
    <div className="w-8 h-8 rounded-full bg-cyan-600 text-white flex items-center justify-center text-sm font-bold shrink-0 shadow-md">
      <UserIcon className="w-4 h-4" />
    </div>
  );

  const aiIcon = (
    <div className="w-8 h-8 rounded-full bg-gray-200 text-gray-900 flex items-center justify-center shrink-0 shadow-md">
      <SparkleIcon className="w-5 h-5" />
    </div>
  );

  return (
    <div
      className={
        isUser
          ? "w-full bg-gray-900 border-b border-gray-800 py-6" // Darker user message
          : "w-full bg-gray-800 border-b border-gray-800 py-6" // Slightly lighter AI message
      }
    >
      <div className="max-w-4xl mx-auto px-4 sm:px-6 flex items-start gap-4">
        <div className="self-start">{isUser ? userIcon : aiIcon}</div>
        <div className="flex-1 min-w-0">
          {hasStructuredData ? (
            <ProductResponse data={message.data} />
          ) : (
            <p className="text-gray-200 font-normal whitespace-pre-wrap leading-relaxed">
              {message.text}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

// Splash Screen - Enhanced with new typography and color
const Splash = () => (
  <div className="flex flex-col items-center justify-center h-full text-center px-6 text-white">
    <SparkleIcon className="w-16 h-16 text-cyan-400 mb-6 animate-pulse" />
    <h2 className="text-5xl font-bold font-mono text-cyan-200 mb-4 tracking-wider drop-shadow-lg">
      Omnia AI
    </h2>
    <p className="text-xl font-sans text-gray-300 max-w-lg mb-8">
      Your specialized assistant for purchasing electronics at the **best
      price**.
    </p>
    <div className="mt-6 p-3 bg-gray-700/50 rounded-lg border border-gray-600 shadow-inner">
      <p className="text-md text-gray-400 font-mono italic">
        Example: "Find me the cheapest Samsung Galaxy S23"
      </p>
    </div>
  </div>
);

// --- Main App Component ---
export default function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    if (messages.length === 0) {
      // Staggered reveal for initial message (Motion principle)
      setTimeout(() => {
        setMessages([
          {
            id: 1,
            text: "Hello! I'm your Omnia AI shopping assistant. Ask me to find you a product!",
            sender: "ai",
          },
        ]);
      }, 500); // 500ms delay for a gentle entrance
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const handleFetchWithRetry = async (url, options, maxRetries = 3) => {
    let lastError = null;
    for (let i = 0; i < maxRetries; i++) {
      try {
        const response = await fetch(url, options);
        if (!response.ok) {
          if (response.status >= 500 && response.status < 600) {
            throw new Error(`Server error! status: ${response.status}`);
          }
          throw new Error(`Client error! status: ${response.status}`);
        }
        return response;
      } catch (error) {
        lastError = error;
        if (i < maxRetries - 1) {
          const delay = Math.pow(2, i) * 1000;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }
    throw lastError;
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    const query = input.trim();
    if (!query || isLoading) return;

    const userMessage = { id: Date.now(), text: query, sender: "user" };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      const response = await handleFetchWithRetry(
        "http://localhost:4000/chat",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query }),
        }
      );

      const serverResponse = await response.json();

      let structuredData = null;
      let displayText = serverResponse.message || serverResponse.reply || "";

      if (serverResponse.reply) {
        try {
          const parsed = JSON.parse(serverResponse.reply);
          if (parsed.products && Array.isArray(parsed.products)) {
            structuredData = parsed;
            displayText = parsed.message || displayText;
          }
        } catch (err) {
          // reply was not JSON
        }
      } else if (
        serverResponse.products &&
        Array.isArray(serverResponse.products)
      ) {
        structuredData = serverResponse;
        displayText = serverResponse.message || displayText;
      }

      const aiMessage = {
        id: Date.now() + 1,
        text: displayText,
        data: structuredData,
        sender: "ai",
      };

      setMessages((prev) => [...prev, aiMessage]);
    } catch (error) {
      console.error("Error fetching chat response:", error);
      const errorMessage = {
        id: Date.now() + 1,
        text: `Sorry, I could not connect to the backend at http://localhost:4000/chat. Please ensure the server is running. Error: ${error.message}`,
        sender: "ai",
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const displayMessages = messages.filter(
    (msg) =>
      msg.sender === "user" ||
      msg.text ||
      (msg.data && msg.data.products && msg.data.products.length > 0)
  );

  const showSplash =
    displayMessages.length === 1 &&
    displayMessages[0].sender === "ai" &&
    !isLoading;

  return (
    // Apply new font/color/background to the root
    <div className="flex flex-col h-screen bg-gray-900 font-sans antialiased text-gray-200">
      <header className="flex items-center justify-between p-4 bg-gray-950 border-b border-cyan-500/20 text-white shadow-xl sticky top-0 z-10">
        <h1 className="text-xl sm:text-2xl font-bold font-mono flex items-center gap-2 tracking-wide">
          <SparkleIcon className="w-6 h-6 text-cyan-400 animate-spin-slow" />
          <span>Omnia AI</span>
        </h1>
      </header>

      <main className="flex-1 overflow-y-auto w-full relative">
        {/* Background with depth/texture */}
        <div className="absolute inset-0 bg-gray-900 opacity-90 [background-image:radial-gradient(ellipse_at_top,_var(--tw-color-cyan-900)_0%,_#1f2937_100%)]"></div>

        {/* Chat content container */}
        <div className="relative z-0 h-full">
          {showSplash ? (
            <Splash />
          ) : (
            <div className="pb-28">
              {displayMessages.map((msg) => (
                // Messages are wrapped in a relative container to allow simple animation (if using a motion library)
                <div
                  key={msg.id}
                  className="opacity-100 transition-opacity duration-500"
                >
                  <Message message={msg} />
                </div>
              ))}

              {isLoading && (
                <div className="w-full bg-gray-800 border-b border-gray-800 py-6">
                  <div className="max-w-4xl mx-auto px-4 sm:px-6 flex items-start gap-4">
                    <div className="w-8 h-8 rounded-full bg-gray-200 text-gray-900 flex items-center justify-center shrink-0">
                      <SparkleIcon className="w-5 h-5" />
                    </div>
                    <Loader />
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
      </main>

      <footer className="w-full bg-gray-950 border-t border-cyan-500/20 p-4 sticky bottom-0 z-10 shadow-2xl">
        <div className="max-w-4xl mx-auto">
          <form
            onSubmit={handleSendMessage}
            className="flex items-center gap-3 bg-gray-900 p-3 rounded-xl border border-gray-700 shadow-lg"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="E.g., 'Find me the best wireless headphones under 100 KWD'"
              className="flex-1 p-2 outline-none text-gray-200 bg-transparent placeholder-gray-500 focus:placeholder-gray-400 transition"
              disabled={isLoading}
            />

            <button
              type="submit"
              className={`p-3 rounded-lg transition duration-200 flex items-center justify-center shadow-lg ${
                isLoading
                  ? "bg-gray-700 cursor-not-allowed text-gray-500"
                  : "bg-cyan-600 hover:bg-cyan-500 text-white active:scale-95 transform"
              }`}
              disabled={isLoading}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-6 w-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M14 5l7 7m0 0l-7 7m7-7H3"
                />
              </svg>
            </button>
          </form>
        </div>
      </footer>
    </div>
  );
}
