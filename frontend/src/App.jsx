import React, { useState, useEffect, useRef } from "react";
import {
  Send,
  Loader2,
  ShoppingBag,
  ExternalLink,
  Search,
  Sparkles,
  Zap,
  Star,
  Clock,
  Menu,
  History,
  LayoutGrid,
  X,
  Package,
  Tag,
  MapPin,
} from "lucide-react";

// Assuming you have your index.css set up with Tailwind as provided in your prompt
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const handleSend = async (text = input) => {
    if (!text.trim() || isLoading) return;

    const userMessage = text.trim();
    setInput("");

    // Add user message immediately
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

      if (data.sessionId && !sessionId) {
        setSessionId(data.sessionId);
      }

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
          content:
            "❌ Sorry, I encountered an error. Please check your connection and try again.",
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
    <div className="flex h-screen bg-[#FDFDFD] font-sans text-gray-800 overflow-hidden">
      {/* Sidebar - Fixed Width */}
      <Sidebar />

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col relative h-full">
        {/* Header / Top Bar (Optional if you want user profile etc) */}
        <header className="absolute top-0 right-0 p-6 z-10 hidden md:block">
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-sm font-bold text-gray-900">Guest User</p>
              <p className="text-xs text-gray-400">user@example.com</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-gray-200 border-2 border-white shadow-sm overflow-hidden">
              <img
                src="https://api.dicebear.com/7.x/avataaars/svg?seed=Felix"
                alt="User"
              />
            </div>
          </div>
        </header>

        {/* Chat / Content Area */}
        <div className="flex-1 overflow-y-auto no-scrollbar scroll-smooth">
          <div className="max-w-5xl mx-auto px-6 md:px-12 py-10 min-h-full flex flex-col justify-center">
            {messages.length === 0 ? (
              <WelcomeScreen onSuggestionClick={handleSend} />
            ) : (
              <div className="space-y-8 pb-32 pt-10">
                {messages.map((message, index) => (
                  <MessageBubble
                    key={index}
                    message={message}
                    onProductClick={setSelectedProduct}
                  />
                ))}

                {isLoading && <LoadingIndicator />}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>
        </div>

        {/* Product Detail Modal */}
        {selectedProduct && (
          <ProductModal
            product={selectedProduct}
            onClose={() => setSelectedProduct(null)}
          />
        )}

        {/* Input Footer - Floating Style */}
        <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-white via-white to-transparent">
          <div className="max-w-4xl mx-auto">
            <div className="relative group">
              <div className="absolute -inset-0.5 bg-gradient-to-r from-violet-200 to-fuchsia-200 rounded-2xl opacity-50 group-hover:opacity-100 transition duration-500 blur-sm"></div>
              <div className="relative flex items-center bg-white rounded-2xl shadow-sm border border-gray-100 p-2">
                <div className="p-3 text-gray-400">
                  <Sparkles className="w-5 h-5" />
                </div>
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Ask Omnia to find phones, laptops, clothes..."
                  className="flex-1 bg-transparent border-none outline-none text-gray-700 placeholder-gray-400 px-2 font-medium"
                  disabled={isLoading}
                  autoFocus
                />
                <button
                  onClick={() => handleSend()}
                  disabled={isLoading || !input.trim()}
                  className="p-3 bg-gray-900 text-white rounded-xl hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95 flex items-center justify-center"
                >
                  {isLoading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Send className="w-5 h-5" />
                  )}
                </button>
              </div>
            </div>
            <p className="text-center text-xs text-gray-400 mt-3 font-medium">
              Omnia AI can make mistakes. Consider checking important
              information.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}

// ----------------------------------------------------------------------
// Product Modal Component
// ----------------------------------------------------------------------
function ProductModal({ product, onClose }) {
  useEffect(() => {
    // Prevent body scroll when modal is open
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "unset";
    };
  }, []);

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  // Get all specs for display
  const specs = product.specs ? Object.entries(product.specs) : [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn"
      onClick={handleBackdropClick}
    >
      <div className="bg-white rounded-3xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto animate-scaleIn">
        {/* Header */}
        <div className="sticky top-0 bg-white/95 backdrop-blur-sm border-b border-gray-100 px-6 py-4 flex items-center justify-between z-10">
          <h2 className="text-lg font-bold text-gray-900">Product Details</h2>
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors"
          >
            <X className="w-5 h-5 text-gray-600" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 md:p-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Left Column - Image */}
            <div className="space-y-4">
              <div className="aspect-square bg-gradient-to-br from-gray-50 to-gray-100 rounded-2xl p-8 flex items-center justify-center">
                <img
                  src={product.imageUrl}
                  alt={product.title}
                  className="w-full h-full object-contain mix-blend-multiply"
                  onError={(e) => {
                    e.target.src =
                      'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="200"%3E%3Crect fill="%23f3f4f6" width="200" height="200"/%3E%3Ctext fill="%239ca3af" font-family="sans-serif" font-size="14" x="50%25" y="50%25" text-anchor="middle" dominant-baseline="middle"%3ENo Image%3C/text%3E%3C/svg%3E';
                  }}
                />
              </div>

              {/* Store Badge */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 bg-gray-50 px-4 py-2 rounded-xl">
                  <MapPin className="w-4 h-4 text-gray-500" />
                  <span className="text-sm font-semibold text-gray-700">
                    {formatStoreName(product.storeName)}
                  </span>
                </div>
                <div className="flex items-center gap-2 bg-violet-50 px-4 py-2 rounded-xl">
                  <Package className="w-4 h-4 text-violet-600" />
                  <span className="text-sm font-semibold text-violet-700">
                    {formatCategory(product.category)}
                  </span>
                </div>
              </div>
            </div>

            {/* Right Column - Details */}
            <div className="space-y-6">
              {/* Brand */}
              {product.brand && (
                <div className="inline-flex items-center gap-2 bg-gray-900 text-white px-4 py-2 rounded-xl">
                  <Tag className="w-4 h-4" />
                  <span className="text-sm font-bold">{product.brand}</span>
                </div>
              )}

              {/* Title */}
              <h1 className="text-2xl md:text-3xl font-bold text-gray-900 leading-tight">
                {product.title}
              </h1>

              {/* Price */}
              <div className="bg-gradient-to-br from-violet-50 to-purple-50 rounded-2xl p-6 border-2 border-violet-100">
                <div className="text-sm text-gray-600 font-medium mb-1">
                  Price
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-black bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">
                    {parseFloat(product.price).toFixed(3)}
                  </span>
                  <span className="text-xl font-bold text-gray-500">KWD</span>
                </div>
              </div>

              {/* Specifications */}
              {specs.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-sm font-bold text-black uppercase tracking-wider">
                    Specifications
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    {specs.map(([key, value], idx) => (
                      <div
                        key={idx}
                        className="bg-gray-50 rounded-xl px-4 py-3 border border-gray-100"
                      >
                        <div className="text-[10px] font-bold text-black  uppercase tracking-wider mb-1">
                          {formatSpecKey(key)}
                        </div>
                        <div className="text-sm font-bold text-gray-900">
                          {formatSpecValue(value)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Description */}
              {product.description && (
                <div className="space-y-2">
                  <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider">
                    Description
                  </h3>
                  <p className="text-sm text-black leading-relaxed">
                    {product.description}
                  </p>
                </div>
              )}

              {/* Action Button */}
              <a
                href={product.productUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-3 w-full bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white py-4 rounded-2xl transition-all font-bold text-base shadow-lg hover:shadow-xl group"
              >
                View on {formatStoreName(product.storeName)}
                <ExternalLink className="w-5 h-5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------
// Sidebar Component
// ----------------------------------------------------------------------
function Sidebar() {
  return (
    <aside className="w-20 md:w-64 bg-[#F9F9FB] border-r border-gray-100 flex flex-col justify-between py-6 px-4 hidden md:flex transition-all duration-300">
      <div>
        {/* Logo */}
        <div className="flex items-center gap-3 px-2 mb-10">
          <div className="w-10 h-10 bg-purple-400 rounded-xl flex items-center justify-center shadow-lg shadow-violet-200">
            <ShoppingBag className="w-5 h-5 text-white" />
          </div>
          <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-gray-900 to-gray-600 hidden md:block">
            Omnia
          </span>
        </div>

        {/* Nav Items */}
        <nav className="space-y-1">
          <SidebarItem
            icon={<Search className="w-5 h-5" />}
            label="Explore"
            active
          />
          <SidebarItem
            icon={<LayoutGrid className="w-5 h-5" />}
            label="Categories"
          />
          <SidebarItem icon={<History className="w-5 h-5" />} label="History" />
          <SidebarItem icon={<Star className="w-5 h-5" />} label="Favorites" />
        </nav>
      </div>

      {/* Bottom Upgrade Card */}
      <div className="hidden md:block">
        <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl p-4 text-white relative overflow-hidden group cursor-pointer">
          <div className="absolute top-0 right-0 w-24 h-24 bg-white opacity-5 rounded-full -mr-10 -mt-10 group-hover:scale-150 transition-transform duration-700"></div>
          <h4 className="font-bold text-sm mb-1">Upgrade to Pro</h4>
          <p className="text-[10px] text-gray-300 leading-tight mb-3">
            Get advanced search & price alerts.
          </p>
          <button className="w-full py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-xs font-semibold backdrop-blur-sm transition-colors">
            Learn More
          </button>
        </div>
      </div>
    </aside>
  );
}

function SidebarItem({ icon, label, active }) {
  return (
    <button
      className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200 group ${
        active
          ? "bg-white text-gray-900 shadow-sm border border-gray-100"
          : "text-gray-500 hover:bg-white hover:text-gray-900 hover:shadow-sm"
      }`}
    >
      <span
        className={`${
          active ? "text-violet-600" : "group-hover:text-violet-600"
        } transition-colors`}
      >
        {icon}
      </span>
      <span className="font-medium text-sm hidden md:block">{label}</span>
    </button>
  );
}

// ----------------------------------------------------------------------
// Welcome Screen (The "Valerio" style landing)
// ----------------------------------------------------------------------
function WelcomeScreen({ onSuggestionClick }) {
  const greeting = getGreeting();

  const suggestions = [
    {
      icon: <Zap className="w-5 h-5 text-amber-500" />,
      title: "Latest Tech",
      desc: "iPhone 15, Galaxy S24, MacBooks",
      query: "Show me the latest flagship phones",
      color: "bg-amber-50 border-amber-100",
    },
    {
      icon: <ShoppingBag className="w-5 h-5 text-emerald-500" />,
      title: "Summer Fashion",
      desc: "Men's shirts, Nike shoes, Zara",
      query: "Summer clothes for men under 20 KWD",
      color: "bg-emerald-50 border-emerald-100",
    },
    {
      icon: <LayoutGrid className="w-5 h-5 text-blue-500" />,
      title: "Home Office",
      desc: "Desks, chairs, monitors",
      query: "Budget monitors for gaming",
      color: "bg-blue-50 border-blue-100",
    },
  ];

  return (
    <div className="flex flex-col items-center justify-center h-full space-y-12 animate-fadeIn max-w-3xl mx-auto">
      <div className="text-center space-y-4">
        <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight text-gray-900">
          <span className="bg-clip-text text-transparent bg-purple-400">
            {greeting}
          </span>
        </h1>
        <p className="text-2xl md:text-3xl text-gray-300 font-semibold tracking-tight">
          How can I help you shop today?
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full">
        {suggestions.map((card, idx) => (
          <button
            key={idx}
            onClick={() => onSuggestionClick(card.query)}
            className={`p-6 rounded-3xl border transition-all duration-300 text-left group hover:-translate-y-1 hover:shadow-xl ${card.color} border-opacity-50 bg-opacity-50`}
          >
            <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm mb-4 group-hover:scale-110 transition-transform">
              {card.icon}
            </div>
            <h3 className="font-bold text-gray-900 mb-1">{card.title}</h3>
            <p className="text-xs text-gray-500 font-medium leading-relaxed">
              {card.desc}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------
// Message Bubble & Product Grid
// ----------------------------------------------------------------------
function MessageBubble({ message, onProductClick }) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end animate-slideUp">
        <div className="bg-gray-100 text-gray-900 rounded-[2rem] rounded-tr-sm px-6 py-4 max-w-[80%] font-medium text-base shadow-sm">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-4 animate-slideUp">
      <div className="w-10 h-10 rounded-full bg-purple-400 flex items-center justify-center flex-shrink-0 shadow-lg shadow-violet-200">
        <Sparkles className="w-5 h-5 text-white" />
      </div>

      <div className="flex-1 space-y-6 overflow-hidden">
        {/* Text Response */}
        <div className="prose prose-lg text-gray-700 leading-relaxed max-w-none">
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>

        {/* Product Grid */}
        {message.products && message.products.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {message.products.map((product, idx) => (
              <ProductCard
                key={idx}
                product={product}
                index={idx}
                onClick={() => onProductClick(product)}
              />
            ))}
          </div>
        )}

        {/* Error State */}
        {message.error && (
          <div className="p-4 bg-red-50 text-red-600 rounded-xl text-sm font-medium border border-red-100 flex items-center gap-2">
            <span>⚠️</span> {message.content}
          </div>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------
// Product Card
// ----------------------------------------------------------------------
function ProductCard({ product, index, onClick }) {
  // Only show top 3 critical specs to keep card clean
  const specs = product.specs ? Object.entries(product.specs).slice(0, 3) : [];

  return (
    <button
      onClick={onClick}
      className="group bg-white rounded-3xl border border-gray-100 hover:border-violet-200 p-3 shadow-sm hover:shadow-2xl hover:shadow-violet-100 transition-all duration-300 flex flex-col h-full animate-scaleIn text-left w-full"
      style={{ animationDelay: `${index * 100}ms` }}
    >
      {/* Image Container */}
      <div className="relative aspect-[4/3] bg-gray-50 rounded-2xl overflow-hidden mb-3">
        <img
          src={product.imageUrl}
          alt={product.title}
          className="w-full h-full object-contain mix-blend-multiply p-4 group-hover:scale-110 transition-transform duration-500"
          onError={(e) => (e.target.style.display = "none")}
        />
        <div className="absolute top-2 right-2 bg-white/80 backdrop-blur-sm px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider text-gray-600 border border-gray-100 shadow-sm">
          {formatStoreName(product.storeName)}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col px-1">
        {/* Category Tag */}
        <div className="text-[10px] font-bold text-violet-600 uppercase tracking-wider mb-1">
          {product.brand}
        </div>

        {/* Title */}
        <h3 className="font-semibold text-gray-900 text-sm leading-snug line-clamp-2 mb-2 flex-1 group-hover:text-violet-700 transition-colors">
          {product.title}
        </h3>

        {/* Specs Pills */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          {specs.map(([key, val], i) => (
            <span
              key={i}
              className="inline-flex items-center px-2 py-1 rounded-md bg-gray-50 text-gray-500 text-[10px] font-medium border border-gray-100"
            >
              {val}
            </span>
          ))}
        </div>

        {/* Price & Action */}
        <div className="flex items-center justify-between mt-auto pt-3 border-t border-gray-50">
          <div className="flex flex-col">
            <span className="text-[10px] text-gray-400 font-medium">Price</span>
            <span className="text-lg font-bold text-gray-900">
              {parseFloat(product.price).toFixed(3)}{" "}
              <span className="text-xs font-normal text-gray-500">KWD</span>
            </span>
          </div>
          <div className="w-8 h-8 rounded-full bg-gray-900 text-white flex items-center justify-center group-hover:bg-violet-600 transition-colors shadow-lg shadow-gray-200">
            <ExternalLink className="w-4 h-4" />
          </div>
        </div>
      </div>
    </button>
  );
}

// ----------------------------------------------------------------------
// Loading State
// ----------------------------------------------------------------------
function LoadingIndicator() {
  return (
    <div className="flex items-center gap-3 pl-2 animate-pulse">
      <div className="w-8 h-8 rounded-full bg-gray-200" />
      <div className="space-y-2">
        <div className="h-4 w-24 bg-gray-200 rounded-full" />
        <div className="h-3 w-48 bg-gray-100 rounded-full" />
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------
const getGreeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return "Good Morning";
  if (hour < 18) return "Good Afternoon";
  return "Good Evening";
};

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
    return value.charAt(0).toUpperCase() + value.slice(1);
  }
  return value;
}

export default App;
