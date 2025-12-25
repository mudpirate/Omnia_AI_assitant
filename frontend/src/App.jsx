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
  History,
  LayoutGrid,
  X,
  Package,
  Tag,
  MapPin,
  ChevronRight,
  TrendingUp,
} from "lucide-react";

// --- CUSTOM STYLES FOR ANIMATIONS ---
const customStyles = `
  @keyframes slideUp {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes scaleIn {
    from { opacity: 0; transform: scale(0.95); }
    to { opacity: 1; transform: scale(1); }
  }
  @keyframes float {
    0% { transform: translateY(0px); }
    50% { transform: translateY(-10px); }
    100% { transform: translateY(0px); }
  }
  .animate-slideUp { animation: slideUp 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
  .animate-fadeIn { animation: fadeIn 0.4s ease-out forwards; }
  .animate-scaleIn { animation: scaleIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
  .animate-float { animation: float 6s ease-in-out infinite; }
  .no-scrollbar::-webkit-scrollbar { display: none; }
  .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
  .glass-panel { background: rgba(255, 255, 255, 0.7); backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.5); }
`;

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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: userMessage,
          sessionId: sessionId,
        }),
      });

      if (!response.ok)
        throw new Error(`HTTP error! status: ${response.status}`);

      const data = await response.json();

      if (data.sessionId && !sessionId) setSessionId(data.sessionId);

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
    <div className="flex h-screen bg-[#F8FAFC] font-sans text-slate-800 overflow-hidden selection:bg-violet-200 selection:text-violet-900">
      <style>{customStyles}</style>

      {/* Sidebar - Modern & Minimal */}
      <Sidebar />

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col relative h-full">
        {/* Header - Transparent & Floating */}
        <header className="absolute top-0 right-0 p-6 z-20 flex justify-end items-center pointer-events-none">
          <div className="pointer-events-auto flex items-center gap-3 bg-white/80 backdrop-blur-md px-4 py-2 rounded-full shadow-sm border border-white/50">
            <div className="text-right hidden sm:block">
              <p className="text-xs font-bold text-slate-800">Guest User</p>
              <p className="text-[10px] text-slate-500">Shopping Session</p>
            </div>
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-violet-500 to-fuchsia-500 p-[2px]">
              <div className="w-full h-full rounded-full bg-white overflow-hidden">
                <img
                  src="https://api.dicebear.com/7.x/avataaars/svg?seed=Felix"
                  alt="User"
                />
              </div>
            </div>
          </div>
        </header>

        {/* Chat / Content Area */}
        <div className="flex-1 overflow-y-auto no-scrollbar scroll-smooth relative z-10">
          {/* Background Ambient Gradients */}
          <div className="fixed top-0 left-0 w-full h-full overflow-hidden -z-10 pointer-events-none">
            <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-violet-200/30 rounded-full blur-[120px] animate-float" />
            <div
              className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-fuchsia-200/30 rounded-full blur-[120px] animate-float"
              style={{ animationDelay: "2s" }}
            />
          </div>

          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10 min-h-full flex flex-col">
            {messages.length === 0 ? (
              <WelcomeScreen onSuggestionClick={handleSend} />
            ) : (
              <div className="space-y-10 pb-40 pt-10">
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

        {/* Input Footer - Floating Glass Bar */}
        <div className="absolute bottom-6 left-0 right-0 px-4 z-30">
          <div className="max-w-3xl mx-auto">
            <div className="glass-panel rounded-[2rem] shadow-2xl shadow-violet-100/50 p-2 relative group transition-all duration-300 hover:shadow-violet-200/50">
              <div className="relative flex items-center">
                <div className="pl-4 pr-3 text-violet-500 animate-pulse">
                  <Sparkles className="w-6 h-6" />
                </div>
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Ask Omnia for fashion, gadgets, or gifts..."
                  className="flex-1 bg-transparent border-none outline-none text-slate-800 placeholder-slate-400 text-lg font-medium h-12"
                  disabled={isLoading}
                  autoFocus
                />
                <button
                  onClick={() => handleSend()}
                  disabled={isLoading || !input.trim()}
                  className="w-12 h-12 bg-gray-900 text-white rounded-full hover:bg-violet-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95 flex items-center justify-center shadow-lg"
                >
                  {isLoading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Send className="w-5 h-5 ml-0.5" />
                  )}
                </button>
              </div>
            </div>
            <p className="text-center text-[10px] text-slate-400 mt-3 font-medium tracking-wide">
              POWERED BY OMNIA AI • PRICES MAY VARY
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}

// ----------------------------------------------------------------------
// Message Bubble
// ----------------------------------------------------------------------
function MessageBubble({ message, onProductClick }) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end animate-slideUp">
        <div className="bg-white/80 backdrop-blur-sm border border-white text-slate-800 rounded-[2rem] rounded-tr-sm px-8 py-5 max-w-[85%] md:max-w-[70%] font-medium text-lg shadow-sm">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-5 animate-slideUp items-start">
      <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center flex-shrink-0 shadow-lg shadow-violet-200 text-white mt-1">
        <Sparkles className="w-5 h-5" />
      </div>

      <div className="flex-1 space-y-8 overflow-hidden">
        {/* Text Response */}
        <div className="prose prose-lg text-slate-600 leading-relaxed max-w-none">
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>

        {/* Product Grid - DYNAMIC RENDERING */}
        {message.products && message.products.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {message.products.map((product, idx) => {
              const type = getCategoryType(product.category);
              if (type === "fashion") {
                return (
                  <FashionCard
                    key={idx}
                    product={product}
                    index={idx}
                    onClick={() => onProductClick(product)}
                  />
                );
              }
              return (
                <ElectronicsCard
                  key={idx}
                  product={product}
                  index={idx}
                  onClick={() => onProductClick(product)}
                />
              );
            })}
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
// 1. ELECTRONICS CARD (Modern Tech Look)
// ----------------------------------------------------------------------
function ElectronicsCard({ product, index, onClick }) {
  const specs = product.specs ? Object.entries(product.specs).slice(0, 2) : [];

  return (
    <button
      onClick={onClick}
      className="group relative bg-white rounded-3xl p-4 shadow-[0_2px_20px_rgb(0,0,0,0.04)] hover:shadow-[0_20px_40px_rgb(124,58,237,0.15)] transition-all duration-300 flex flex-col h-full animate-scaleIn text-left w-full border border-slate-100 hover:border-violet-100 hover:-translate-y-1"
      style={{ animationDelay: `${index * 100}ms` }}
    >
      <div className="relative aspect-[4/3] bg-slate-50 rounded-2xl overflow-hidden mb-4 group-hover:bg-white transition-colors">
        <img
          src={product.imageUrl}
          alt={product.title}
          className="w-full h-full object-contain mix-blend-multiply p-6 group-hover:scale-110 transition-transform duration-500 ease-out"
          onError={(e) => (e.target.style.display = "none")}
        />
        <div className="absolute top-3 left-3 bg-white/90 backdrop-blur px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider text-slate-600 border border-slate-100">
          {formatStoreName(product.storeName)}
        </div>
      </div>

      <div className="flex-1 flex flex-col">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[10px] font-bold text-violet-600 bg-violet-50 px-2 py-0.5 rounded-md uppercase tracking-wider">
            {product.brand}
          </span>
        </div>

        <h3 className="font-bold text-slate-800 text-sm leading-snug line-clamp-2 mb-3 group-hover:text-violet-700 transition-colors">
          {product.title}
        </h3>

        {/* Mini Specs */}
        <div className="flex flex-wrap gap-2 mb-4">
          {specs.map(([key, val], i) => (
            <span
              key={i}
              className="text-[10px] text-slate-500 bg-slate-50 px-2 py-1 rounded-md border border-slate-100"
            >
              {val}
            </span>
          ))}
        </div>

        <div className="flex items-center justify-between mt-auto pt-4 border-t border-slate-50">
          <div>
            <span className="block text-[10px] text-slate-400 font-medium uppercase">
              Best Price
            </span>
            <div className="flex items-baseline gap-1">
              <span className="text-lg font-black text-slate-900">
                {parseFloat(product.price).toFixed(3)}
              </span>
              <span className="text-xs font-bold text-slate-400">KWD</span>
            </div>
          </div>
          <div className="w-9 h-9 rounded-full bg-slate-900 text-white flex items-center justify-center group-hover:bg-violet-600 transition-colors shadow-lg shadow-slate-200 group-hover:shadow-violet-200">
            <ChevronRight className="w-5 h-5" />
          </div>
        </div>
      </div>
    </button>
  );
}

// ----------------------------------------------------------------------
// 2. FASHION CARD (Editorial Look)
// ----------------------------------------------------------------------
function FashionCard({ product, index, onClick }) {
  return (
    <button
      onClick={onClick}
      className="group relative bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-2xl hover:shadow-slate-200 transition-all duration-500 flex flex-col h-full animate-scaleIn text-left w-full border border-slate-100"
      style={{ animationDelay: `${index * 100}ms` }}
    >
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-slate-100">
        <img
          src={product.imageUrl}
          alt={product.title}
          className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
          onError={(e) => (e.target.style.display = "none")}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-60 group-hover:opacity-80 transition-opacity" />

        <div className="absolute bottom-0 left-0 p-4 w-full text-white">
          <div className="text-[10px] font-bold opacity-80 uppercase tracking-widest mb-1">
            {product.brand}
          </div>
          <div className="flex justify-between items-end">
            <div className="text-xl font-bold">
              {parseFloat(product.price).toFixed(3)}{" "}
              <span className="text-xs font-normal opacity-80">KWD</span>
            </div>
            <div className="bg-white/20 backdrop-blur-md p-2 rounded-full hover:bg-white hover:text-black transition-all">
              <ExternalLink className="w-4 h-4" />
            </div>
          </div>
        </div>

        <div className="absolute top-3 right-3 bg-black/50 backdrop-blur-md px-3 py-1 rounded-full text-[10px] font-bold text-white uppercase tracking-wider">
          {formatStoreName(product.storeName)}
        </div>
      </div>

      <div className="p-4">
        <h3 className="font-medium text-slate-800 text-sm leading-snug line-clamp-2 group-hover:text-violet-600 transition-colors">
          {product.title}
        </h3>
      </div>
    </button>
  );
}

// ----------------------------------------------------------------------
// Sidebar
// ----------------------------------------------------------------------
function Sidebar() {
  return (
    <aside className="w-20 md:w-72 bg-white border-r border-slate-100 flex flex-col justify-between py-8 px-4 hidden md:flex z-40 shadow-[4px_0_24px_rgba(0,0,0,0.02)]">
      <div>
        {/* Logo */}
        <div className="flex items-center gap-4 px-2 mb-12">
          <div className="w-10 h-10 bg-gradient-to-tr from-violet-600 to-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-violet-200">
            <ShoppingBag className="w-5 h-5 text-white" />
          </div>
          <span className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-slate-900 to-slate-600 hidden md:block tracking-tight">
            Omnia
          </span>
        </div>

        <nav className="space-y-2">
          <SidebarItem
            icon={<Search className="w-5 h-5" />}
            label="Discover"
            active
          />
          <SidebarItem
            icon={<LayoutGrid className="w-5 h-5" />}
            label="Categories"
          />
          <SidebarItem
            icon={<TrendingUp className="w-5 h-5" />}
            label="Trending"
          />
          <SidebarItem icon={<History className="w-5 h-5" />} label="History" />
          <SidebarItem icon={<Star className="w-5 h-5" />} label="Favorites" />
        </nav>
      </div>

      <div className="hidden md:block">
        <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl p-5 text-white relative overflow-hidden group cursor-pointer shadow-xl">
          <div className="absolute top-0 right-0 w-32 h-32 bg-violet-500 opacity-20 rounded-full -mr-10 -mt-10 group-hover:scale-150 transition-transform duration-700 blur-2xl"></div>
          <h4 className="font-bold text-base mb-1 relative z-10">Omnia Pro</h4>
          <p className="text-xs text-slate-300 leading-tight mb-4 relative z-10">
            Unlock advanced price tracking & unlimited history.
          </p>
          <button className="w-full py-2 bg-white/10 hover:bg-white/20 rounded-xl text-xs font-bold backdrop-blur-sm transition-colors relative z-10 border border-white/10">
            Upgrade Now
          </button>
        </div>
      </div>
    </aside>
  );
}

function SidebarItem({ icon, label, active }) {
  return (
    <button
      className={`w-full flex items-center gap-4 px-4 py-3.5 rounded-2xl transition-all duration-200 group relative overflow-hidden ${
        active
          ? "bg-violet-50 text-violet-700 font-bold"
          : "text-slate-500 hover:bg-slate-50 hover:text-slate-900 font-medium"
      }`}
    >
      <span className="relative z-10">{icon}</span>
      <span className="relative z-10 hidden md:block text-sm">{label}</span>
      {active && (
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-violet-600 rounded-r-full" />
      )}
    </button>
  );
}

// ----------------------------------------------------------------------
// Welcome Screen (Hero)
// ----------------------------------------------------------------------
function WelcomeScreen({ onSuggestionClick }) {
  const greeting = getGreeting();
  const suggestions = [
    {
      icon: <Zap className="w-6 h-6 text-amber-500" />,
      title: "Latest Tech",
      desc: "iPhone 15, Galaxy S24...",
      query: "Show me the latest flagship phones",
      bg: "bg-amber-50 hover:bg-amber-100",
      border: "border-amber-100",
    },
    {
      icon: <Package className="w-6 h-6 text-emerald-500" />,
      title: "Fashion Drops",
      desc: "Summer essentials, Sneakers",
      query: "Trending clothes for men under 40 KWD",
      bg: "bg-emerald-50 hover:bg-emerald-100",
      border: "border-emerald-100",
    },
    {
      icon: <LayoutGrid className="w-6 h-6 text-blue-500" />,
      title: "Home Setup",
      desc: "Monitors, Ergonomic chairs",
      query: "Best monitors for coding under 100 KWD",
      bg: "bg-blue-50 hover:bg-blue-100",
      border: "border-blue-100",
    },
  ];

  return (
    <div className="flex flex-col items-center justify-center h-full animate-fadeIn max-w-4xl mx-auto pb-20">
      {/* Hero Text */}
      <div className="text-center space-y-6 mb-16 relative">
        <div className="inline-flex items-center gap-2 bg-white border border-slate-200 rounded-full px-4 py-1.5 shadow-sm mb-4 animate-slideUp">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
          <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">
            AI Shopping Assistant Online
          </span>
        </div>

        <h1 className="text-6xl md:text-7xl font-black tracking-tight text-slate-900 leading-[1.1]">
          {greeting}, <br />
          <span className="bg-clip-text text-transparent bg-gradient-to-r from-violet-600 via-fuchsia-600 to-indigo-600 animate-gradient-x">
            What are we buying?
          </span>
        </h1>
        <p className="text-xl text-slate-500 max-w-2xl mx-auto font-medium">
          I scan thousands of stores to find you the best deals, specs, and
          styles in seconds.
        </p>
      </div>

      {/* Suggestion Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 w-full">
        {suggestions.map((card, idx) => (
          <button
            key={idx}
            onClick={() => onSuggestionClick(card.query)}
            className={`relative p-8 rounded-[2rem] border transition-all duration-300 text-left group hover:-translate-y-2 hover:shadow-xl ${card.bg} ${card.border}`}
          >
            <div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center shadow-sm mb-6 group-hover:scale-110 transition-transform duration-300">
              {card.icon}
            </div>
            <h3 className="text-xl font-bold text-slate-900 mb-2">
              {card.title}
            </h3>
            <p className="text-sm text-slate-600 font-medium leading-relaxed">
              {card.desc}
            </p>

            <div className="absolute top-8 right-8 opacity-0 group-hover:opacity-100 transition-opacity -translate-x-2 group-hover:translate-x-0">
              <ChevronRight className="w-5 h-5 text-slate-400" />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------
// Detailed Product Modal
// ----------------------------------------------------------------------
function ProductModal({ product, onClose }) {
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "unset";
    };
  }, []);

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  const specs = product.specs ? Object.entries(product.specs) : [];

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-slate-900/60 backdrop-blur-sm animate-fadeIn"
      onClick={handleBackdropClick}
    >
      <div className="bg-white rounded-[2.5rem] shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col md:flex-row animate-slideUp">
        {/* Left Column: Image */}
        <div className="w-full md:w-1/2 bg-[#F8FAFC] p-8 md:p-12 relative flex items-center justify-center group">
          <div className="absolute top-6 left-6 flex gap-2">
            <div className="bg-white/90 backdrop-blur px-3 py-1.5 rounded-full text-xs font-bold shadow-sm flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-violet-600" />
              {formatStoreName(product.storeName)}
            </div>
          </div>

          <img
            src={product.imageUrl}
            alt={product.title}
            className="max-w-full max-h-[50vh] object-contain mix-blend-multiply transition-transform duration-500 group-hover:scale-105"
            onError={(e) => {
              e.target.src = "https://via.placeholder.com/400?text=No+Image";
            }}
          />
        </div>

        {/* Right Column: Details */}
        <div className="w-full md:w-1/2 flex flex-col h-full bg-white">
          {/* Header */}
          <div className="px-8 py-6 border-b border-slate-100 flex justify-between items-start">
            <div>
              <div className="text-violet-600 font-bold text-xs uppercase tracking-widest mb-2">
                {product.brand}
              </div>
              <h2 className="text-2xl font-bold text-slate-900 leading-tight">
                {product.title}
              </h2>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-slate-100 rounded-full transition-colors"
            >
              <X className="w-6 h-6 text-slate-400" />
            </button>
          </div>

          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto p-8 space-y-8 no-scrollbar">
            {/* Price Section */}
            <div className="bg-gradient-to-r from-violet-50 to-fuchsia-50 p-6 rounded-2xl border border-violet-100 flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-500 font-bold uppercase mb-1">
                  Current Price
                </p>
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-black text-slate-900">
                    {parseFloat(product.price).toFixed(3)}
                  </span>
                  <span className="text-sm font-bold text-slate-500">KWD</span>
                </div>
              </div>
              <div className="text-right hidden sm:block">
                <p className="text-xs text-green-600 font-bold bg-green-100 px-2 py-1 rounded-md inline-block">
                  In Stock
                </p>
              </div>
            </div>

            {/* Specs Grid */}
            {specs.length > 0 && (
              <div>
                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-4 flex items-center gap-2">
                  <Zap className="w-4 h-4 text-amber-500" /> Key Specs
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  {specs.map(([key, value], idx) => (
                    <div
                      key={idx}
                      className="p-3 bg-slate-50 rounded-xl border border-slate-100"
                    >
                      <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">
                        {formatSpecKey(key)}
                      </div>
                      <div
                        className="text-sm font-bold text-slate-800 line-clamp-1"
                        title={formatSpecValue(value)}
                      >
                        {formatSpecValue(value)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Description */}
            {product.description && (
              <div>
                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-3">
                  About
                </h3>
                <p className="text-sm text-slate-600 leading-loose">
                  {product.description}
                </p>
              </div>
            )}
          </div>

          {/* Sticky Footer Action */}
          <div className="p-6 border-t border-slate-100 bg-white">
            <a
              href={product.productUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full bg-slate-900 text-white py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-3 hover:bg-violet-600 transition-colors shadow-lg shadow-slate-200"
            >
              Buy Now
              <ExternalLink className="w-5 h-5" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------
// Loading & Helpers
// ----------------------------------------------------------------------
function LoadingIndicator() {
  return (
    <div className="flex items-center gap-4 pl-2">
      <div className="w-8 h-8 rounded-full bg-slate-100 animate-pulse" />
      <div className="flex gap-1">
        <span
          className="w-2 h-2 bg-slate-300 rounded-full animate-bounce"
          style={{ animationDelay: "0ms" }}
        ></span>
        <span
          className="w-2 h-2 bg-slate-300 rounded-full animate-bounce"
          style={{ animationDelay: "150ms" }}
        ></span>
        <span
          className="w-2 h-2 bg-slate-300 rounded-full animate-bounce"
          style={{ animationDelay: "300ms" }}
        ></span>
      </div>
    </div>
  );
}

const getGreeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return "Good Morning";
  if (hour < 18) return "Good Afternoon";
  return "Good Evening";
};

function getCategoryType(category) {
  if (!category) return "electronics";
  const cat = category.toLowerCase();
  const fashionKeywords = [
    "clothing",
    "fashion",
    "apparel",
    "shirt",
    "pant",
    "jeans",
    "shoe",
    "sneaker",
    "dress",
    "jacket",
    "t-shirt",
    "wear",
    "men",
    "women",
  ];
  if (fashionKeywords.some((keyword) => cat.includes(keyword)))
    return "fashion";
  return "electronics";
}

function formatStoreName(storeName) {
  const storeMap = {
    XCITE: "Xcite",
    BEST: "Best Al-Yousifi",
    BEST_KW: "Best",
    NOON: "Noon",
    EUREKA: "Eureka",
  };
  return storeMap[storeName] || storeName.replace(/_/g, " ");
}

function formatSpecKey(key) {
  return key
    .replace(/_/g, " ")
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatSpecValue(value) {
  if (typeof value === "string")
    return value.charAt(0).toUpperCase() + value.slice(1);
  return value;
}

export default App;
