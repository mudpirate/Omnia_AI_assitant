import React, { useState, useRef, useEffect } from "react";

// --- SVG Icons ---
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

// Loader
const Loader = () => (
  <div className="flex items-center space-x-2 p-3 text-gray-500">
    <div className="w-2 h-2 rounded-full bg-gray-500 animate-bounce delay-100" />
    <div className="w-2 h-2 rounded-full bg-gray-500 animate-bounce delay-200" />
    <div className="w-2 h-2 rounded-full bg-gray-500 animate-bounce delay-300" />
  </div>
);

// Product Card
const ProductCard = ({ product }) => (
  <div className="group relative p-4 border border-gray-200 rounded-xl shadow-sm hover:shadow-md transition-all duration-150 bg-white">
    <div className="flex gap-4">
      <div className="shrink-0 w-28 h-28 bg-gray-100 rounded-lg overflow-hidden flex items-center justify-center border border-gray-300">
        <img
          src={product.image_url}
          alt={product.product_name}
          className="w-full h-full object-cover"
          onError={(e) => {
            e.target.onerror = null;
            e.target.src =
              "https://placehold.co/100x100/E5E7EB/4B5563?text=No+Image";
          }}
        />
      </div>

      <div className="flex-1 min-w-0">
        <h3 className="text-lg font-semibold text-gray-800 line-clamp-2">
          {product.product_name}
        </h3>

        <p className="text-2xl font-extrabold text-indigo-700 mt-1">
          {typeof product.price_kwd === "number"
            ? product.price_kwd.toFixed(2)
            : product.price_kwd}{" "}
          KWD
        </p>

        <p className="text-sm text-gray-600 mt-1">
          Store:{" "}
          <span className="font-medium text-gray-800">
            {product.store_name}
          </span>
        </p>

        <div className="flex flex-wrap gap-2 mt-3">
          {Array.isArray(product.spec_highlights) &&
            product.spec_highlights.map((spec, idx) => (
              <span
                key={idx}
                className="px-3 py-1 text-xs font-medium bg-indigo-50 text-indigo-700 rounded-full"
              >
                {spec}
              </span>
            ))}
        </div>
      </div>
    </div>

    <a
      href={product.product_url}
      target="_blank"
      rel="noopener noreferrer"
      className="absolute top-4 right-4 p-2 rounded-full bg-indigo-50 hover:bg-indigo-100 text-indigo-600 transition focus:outline-none focus:ring-2 focus:ring-indigo-500"
      title="View Product Page"
    >
      <LinkIcon className="w-5 h-5" />
    </a>
  </div>
);

const ProductResponse = ({ data }) => (
  <div className="space-y-4">
    <p className="text-gray-900 font-medium whitespace-pre-wrap px-4 pt-4">
      {data.message}
    </p>

    <div className="space-y-3 p-4 bg-white/90">
      <h4 className="text-sm font-semibold text-gray-600 border-b pb-2">
        Recommended Products:
      </h4>
      <div className="grid gap-3">
        {data.products.map((product, index) => (
          <ProductCard key={index} product={product} />
        ))}
      </div>
    </div>

    {data.disclaimer && (
      <div className="pt-2 text-sm text-gray-500 px-4 italic">
        {data.disclaimer}
      </div>
    )}
  </div>
);

// Message bubble
const Message = ({ message }) => {
  const isUser = message.sender === "user";
  const hasStructuredData =
    message.sender === "ai" && message.data && message.data.products;

  const userIcon = (
    <div className="w-8 h-8 rounded-sm bg-gray-800 text-white flex items-center justify-center text-xs font-bold shrink-0">
      U
    </div>
  );

  const aiIcon = (
    <div className="w-8 h-8 rounded-sm bg-indigo-500 text-white flex items-center justify-center shrink-0">
      <SparkleIcon className="w-5 h-5" />
    </div>
  );

  return (
    <div
      className={
        isUser
          ? "w-full bg-white border-b border-gray-200 py-4"
          : "w-full bg-gray-50 border-b border-gray-200 py-4"
      }
    >
      <div className="max-w-4xl mx-auto px-4 sm:px-6 flex items-start gap-4">
        <div className="self-start">{isUser ? userIcon : aiIcon}</div>
        <div className="flex-1 min-w-0">
          {hasStructuredData ? (
            <ProductResponse data={message.data} />
          ) : (
            <p className="text-gray-900 font-semibold whitespace-pre-wrap">
              {message.text}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

const Splash = () => (
  <div className="flex flex-col items-center justify-center h-full text-center px-6">
    <SparkleIcon className="w-12 h-12 text-indigo-500 mb-4" />
    <h2 className="text-3xl sm:text-4xl font-semibold font-mono text-gray-800 mb-2">
      Omnia AI
    </h2>
    <p className="text-lg sm:text-2xl font-mono text-gray-600">
      Purchase things at the best price. Ask me anything about electronics!
    </p>
    <div className="mt-6 text-md text-gray-500">
      <p>Example: "Find me the cheapest Samsung Galaxy S23"</p>
    </div>
  </div>
);

export default function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    if (messages.length === 0) {
      setMessages([
        {
          id: 1,
          text: "Hello! I'm your Omnia AI shopping assistant. Ask me to find you a product!",
          sender: "ai",
        },
      ]);
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
    <div className="flex flex-col h-screen bg-gray-100 font-sans antialiased">
      <header className="flex items-center justify-between p-4 bg-black text-white shadow-md sticky top-0 z-10">
        <h1 className="text-lg sm:text-xl font-bold font-mono flex items-center gap-2">
          <SparkleIcon className="w-5 h-5 text-indigo-400" />
          <span>Omnia AI</span>
        </h1>
      </header>

      <main className="flex-1 overflow-y-auto w-full bg-white relative">
        {showSplash ? (
          <Splash />
        ) : (
          <div className="pb-24">
            {displayMessages.map((msg) => (
              <Message key={msg.id} message={msg} />
            ))}

            {isLoading && (
              <div className="w-full bg-gray-50 border-b border-gray-200 py-4">
                <div className="max-w-4xl mx-auto px-4 sm:px-6 flex items-start gap-4">
                  <div className="w-8 h-8 rounded-sm bg-indigo-500 text-white flex items-center justify-center shrink-0">
                    <SparkleIcon className="w-5 h-5" />
                  </div>
                  <Loader />
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </main>

      <footer className="w-full bg-white border-t border-gray-200 p-3 sticky bottom-0 z-10">
        <div className="max-w-4xl mx-auto">
          <form
            onSubmit={handleSendMessage}
            className="flex items-center gap-3 bg-white p-2 rounded-xl border border-gray-300 shadow-sm"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="E.g., 'Find me the best wireless headphones under 100 KWD'"
              className="flex-1 p-2 outline-none text-gray-800 bg-white placeholder-gray-400"
              disabled={isLoading}
            />

            <button
              type="submit"
              className={`p-2 rounded-lg transition duration-150 flex items-center justify-center ${
                isLoading
                  ? "bg-gray-300 cursor-not-allowed text-gray-500"
                  : "bg-black hover:bg-indigo-700 text-white active:scale-95"
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
