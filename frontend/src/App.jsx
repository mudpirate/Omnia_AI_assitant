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
  MapPin,
  ChevronRight,
  TrendingUp,
  Camera,
  ArrowUpRight,
  Scan,
  CircleDot,
} from "lucide-react";

// ═══════════════════════════════════════════════════════════════════════════
// NEO-BRUTALIST LUXURY THEME
// Warm sand/cream base, electric coral accents, deep charcoal, chunky borders
// ═══════════════════════════════════════════════════════════════════════════

const customStyles = `
  @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&display=swap');

  :root {
    --cream: #FAF7F2;
    --sand: #F0EBE3;
    --charcoal: #1A1A1A;
    --coral: #FF6B4A;
    --coral-light: #FF8A70;
    --sage: #8B9A7D;
    --navy: #2C3E50;
  }

  * {
    font-family: 'DM Sans', sans-serif;
  }

  .font-display {
    font-family: 'Instrument Serif', serif;
  }

  @keyframes float-slow {
    0%, 100% { transform: translateY(0) rotate(0deg); }
    50% { transform: translateY(-20px) rotate(1deg); }
  }

  @keyframes grain {
    0%, 100% { transform: translate(0, 0); }
    10% { transform: translate(-5%, -10%); }
    20% { transform: translate(-15%, 5%); }
    30% { transform: translate(7%, -25%); }
    40% { transform: translate(-5%, 25%); }
    50% { transform: translate(-15%, 10%); }
    60% { transform: translate(15%, 0%); }
    70% { transform: translate(0%, 15%); }
    80% { transform: translate(3%, 35%); }
    90% { transform: translate(-10%, 10%); }
  }

  @keyframes slide-up {
    from { opacity: 0; transform: translateY(40px); }
    to { opacity: 1; transform: translateY(0); }
  }

  @keyframes scale-in {
    from { opacity: 0; transform: scale(0.9); }
    to { opacity: 1; transform: scale(1); }
  }

  @keyframes fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes bounce-subtle {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-4px); }
  }

  .animate-float-slow { animation: float-slow 8s ease-in-out infinite; }
  .animate-slide-up { animation: slide-up 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
  .animate-scale-in { animation: scale-in 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
  .animate-fade-in { animation: fade-in 0.5s ease-out forwards; }
  .animate-bounce-subtle { animation: bounce-subtle 2s ease-in-out infinite; }

  .grain-overlay::before {
    content: '';
    position: fixed;
    top: -50%;
    left: -50%;
    right: -50%;
    bottom: -50%;
    width: 200%;
    height: 200%;
    background: transparent url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E") repeat;
    opacity: 0.03;
    pointer-events: none;
    z-index: 1000;
    animation: grain 8s steps(10) infinite;
  }

  .brutal-border {
    border: 3px solid var(--charcoal);
    box-shadow: 6px 6px 0 var(--charcoal);
    transition: all 0.2s ease;
  }

  .brutal-border:hover {
    box-shadow: 8px 8px 0 var(--charcoal);
    transform: translate(-2px, -2px);
  }

  .brutal-border-coral {
    border: 3px solid var(--coral);
    box-shadow: 6px 6px 0 var(--coral);
  }

  .brutal-border-coral:hover {
    box-shadow: 8px 8px 0 var(--coral);
    transform: translate(-2px, -2px);
  }

  .text-stroke {
    -webkit-text-stroke: 1.5px var(--charcoal);
    color: transparent;
  }

  .no-scrollbar::-webkit-scrollbar { display: none; }
  .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }

  .stagger-1 { animation-delay: 0.1s; }
  .stagger-2 { animation-delay: 0.2s; }
  .stagger-3 { animation-delay: 0.3s; }
  .stagger-4 { animation-delay: 0.4s; }
`;

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedImage, setSelectedImage] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [isAnalyzingImage, setIsAnalyzingImage] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState("");
  const [showImageUpload, setShowImageUpload] = useState(false);

  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

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
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setIsLoading(true);

    try {
      const response = await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: userMessage, sessionId }),
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
      console.error("Error:", error);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Connection lost. Please try again.",
          error: true,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleImageSelect = (event) => {
    const file = event.target.files?.[0];
    if (file) processImage(file);
  };

  const processImage = (file) => {
    const validTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    if (!validTypes.includes(file.type)) {
      alert("Please upload a JPEG, PNG, or WebP image");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      alert("Image size must be less than 10MB");
      return;
    }

    setSelectedImage(file);
    const reader = new FileReader();
    reader.onloadend = () => {
      setImagePreview(reader.result);
      setShowImageUpload(true);
    };
    reader.readAsDataURL(file);
  };

  const analyzeAndSearch = async () => {
    if (!selectedImage) return;
    setIsAnalyzingImage(true);
    setAnalysisStatus("Scanning your image...");

    try {
      const formData = new FormData();
      formData.append("image", selectedImage);

      const analysisResponse = await fetch(`${API_URL}/analyze-image`, {
        method: "POST",
        body: formData,
      });

      const analysisData = await analysisResponse.json();
      if (!analysisData.success)
        throw new Error(analysisData.error || "Analysis failed");

      const searchQuery = analysisData.query;
      setAnalysisStatus(`Found: "${searchQuery}"`);

      setMessages((prev) => [
        ...prev,
        {
          role: "user",
          content: `📷 Image search: "${searchQuery}"`,
          image: imagePreview,
        },
      ]);

      setIsLoading(true);
      const searchResponse = await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: searchQuery,
          sessionId: sessionId || "default",
        }),
      });

      const searchData = await searchResponse.json();
      if (searchData.sessionId && !sessionId)
        setSessionId(searchData.sessionId);

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: searchData.reply,
          products: searchData.products || [],
          generatedQuery: searchQuery,
        },
      ]);

      clearImage();
    } catch (error) {
      console.error("Image search error:", error);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Failed to analyze image: ${error.message}`,
          error: true,
        },
      ]);
    } finally {
      setIsAnalyzingImage(false);
      setIsLoading(false);
    }
  };

  const clearImage = () => {
    setSelectedImage(null);
    setImagePreview(null);
    setShowImageUpload(false);
    setAnalysisStatus("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex h-screen bg-[#FAF7F2] overflow-hidden grain-overlay">
      <style>{customStyles}</style>

      {/* Sidebar */}
      <Sidebar />

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative h-full">
        {/* Decorative Elements */}
        <div className="absolute top-20 right-20 w-32 h-32 border-[3px] border-[#FF6B4A]/30 rounded-full animate-float-slow pointer-events-none" />
        <div className="absolute bottom-40 left-[30%] w-20 h-20 bg-[#8B9A7D]/10 rotate-45 pointer-events-none" />

        {/* Header */}
        <header className="absolute top-6 right-6 z-20">
          <div className="brutal-border bg-white px-4 py-2 flex items-center gap-3">
            <div className="w-8 h-8 bg-[#FF6B4A] flex items-center justify-center">
              <span className="text-white text-xs font-bold">G</span>
            </div>
            <div className="hidden sm:block">
              <p className="text-xs font-bold text-[#1A1A1A]">Guest</p>
              <p className="text-[10px] text-[#1A1A1A]/60">Kuwait</p>
            </div>
          </div>
        </header>

        {/* Chat Area */}
        <div className="flex-1 overflow-y-auto no-scrollbar scroll-smooth relative z-10">
          <div className="max-w-5xl mx-auto px-6 lg:px-12 py-12 min-h-full flex flex-col">
            {messages.length === 0 ? (
              <WelcomeScreen
                onSuggestionClick={handleSend}
                onImageUploadClick={() => fileInputRef.current?.click()}
              />
            ) : (
              <div className="space-y-12 pb-48 pt-16">
                {messages.map((message, index) => (
                  <MessageBubble
                    key={index}
                    message={message}
                    onProductClick={setSelectedProduct}
                    index={index}
                  />
                ))}
                {isLoading && <LoadingIndicator />}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>
        </div>

        {/* Product Modal */}
        {selectedProduct && (
          <ProductModal
            product={selectedProduct}
            onClose={() => setSelectedProduct(null)}
          />
        )}

        {/* Image Upload Modal */}
        {showImageUpload && imagePreview && (
          <ImageUploadModal
            imagePreview={imagePreview}
            isAnalyzing={isAnalyzingImage}
            analysisStatus={analysisStatus}
            onAnalyze={analyzeAndSearch}
            onCancel={clearImage}
          />
        )}

        {/* Input Bar */}
        <div className="absolute bottom-8 left-0 right-0 px-6 z-30">
          <div className="max-w-3xl mx-auto">
            <div className="brutal-border bg-white p-2 flex items-center gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading || isAnalyzingImage}
                className="w-12 h-12 bg-[#F0EBE3] hover:bg-[#FF6B4A] hover:text-white flex items-center justify-center transition-colors disabled:opacity-50"
                title="Upload image"
              >
                <Camera className="w-5 h-5" />
              </button>

              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="What are you looking for?"
                className="flex-1 bg-transparent border-none outline-none text-[#1A1A1A] placeholder-[#1A1A1A]/40 text-lg font-medium h-12 px-2"
                disabled={isLoading || isAnalyzingImage}
                autoFocus
              />

              <button
                onClick={() => handleSend()}
                disabled={isLoading || !input.trim() || isAnalyzingImage}
                className="w-12 h-12 bg-[#1A1A1A] text-white hover:bg-[#FF6B4A] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
              >
                {isLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Send className="w-5 h-5" />
                )}
              </button>
            </div>

            <div className="flex items-center justify-center gap-4 mt-4 text-[10px] font-bold tracking-widest text-[#1A1A1A]/40 uppercase">
              <span>Omnia AI</span>
              <CircleDot className="w-2 h-2" />
              <span>Kuwait</span>
              <CircleDot className="w-2 h-2" />
              <span>Multi-Store</span>
            </div>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/jpg"
          onChange={handleImageSelect}
          className="hidden"
        />
      </main>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SIDEBAR
// ═══════════════════════════════════════════════════════════════════════════

function Sidebar() {
  return (
    <aside className="w-20 lg:w-72 bg-[#1A1A1A] flex flex-col justify-between py-8 px-4 hidden md:flex z-40">
      <div>
        {/* Logo */}
        <div className="flex items-center gap-4 px-2 mb-16">
          <div className="w-12 h-12 bg-[#FF6B4A] flex items-center justify-center">
            <ShoppingBag className="w-6 h-6 text-white" />
          </div>
          <div className="hidden lg:block">
            <span className="font-display text-3xl text-white italic">
              Omnia
            </span>
          </div>
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
          <SidebarItem icon={<Star className="w-5 h-5" />} label="Saved" />
        </nav>
      </div>

      <div className="hidden lg:block">
        <div className="border-2 border-[#FF6B4A] p-5 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-16 h-16 bg-[#FF6B4A] -mr-8 -mt-8 rotate-45" />
          <h4 className="font-display text-xl text-white italic mb-2">
            Go Pro
          </h4>
          <p className="text-xs text-white/60 leading-relaxed mb-4">
            Price alerts, unlimited history, exclusive deals.
          </p>
          <button className="w-full py-2 bg-[#FF6B4A] text-white text-xs font-bold uppercase tracking-wider hover:bg-[#FF8A70] transition-colors">
            Upgrade
          </button>
        </div>
      </div>
    </aside>
  );
}

function SidebarItem({ icon, label, active }) {
  return (
    <button
      className={`w-full flex items-center gap-4 px-4 py-3 transition-all group ${
        active
          ? "bg-[#FF6B4A] text-white"
          : "text-white/50 hover:text-white hover:bg-white/5"
      }`}
    >
      <span>{icon}</span>
      <span className="hidden lg:block text-sm font-medium uppercase tracking-wider">
        {label}
      </span>
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// WELCOME SCREEN
// ═══════════════════════════════════════════════════════════════════════════

function WelcomeScreen({ onSuggestionClick, onImageUploadClick }) {
  const greeting = getGreeting();

  const suggestions = [
    {
      icon: <Scan className="w-7 h-7" />,
      title: "Visual Search",
      desc: "Upload a photo to find it",
      action: onImageUploadClick,
      accent: true,
    },
    {
      icon: <Zap className="w-7 h-7" />,
      title: "Latest Tech",
      desc: "Phones, laptops, gadgets",
      query: "Show me the latest flagship phones",
    },
    {
      icon: <Package className="w-7 h-7" />,
      title: "Fashion",
      desc: "Clothes, shoes, accessories",
      query: "Trending fashion items under 40 KWD",
    },
  ];

  return (
    <div className="flex flex-col items-center justify-center h-full animate-fade-in max-w-4xl mx-auto pb-24">
      {/* Badge */}
      <div className="brutal-border bg-white px-4 py-2 mb-10 animate-slide-up">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[#1A1A1A]">
          <span className="w-2 h-2 bg-[#8B9A7D] animate-pulse" />
          AI Shopping Assistant
        </div>
      </div>

      {/* Hero */}
      <div className="text-center space-y-6 mb-16">
        <h1 className="font-display text-6xl md:text-8xl text-[#1A1A1A] leading-[0.9] animate-slide-up stagger-1">
          {greeting},<br />
          <span className="text-stroke">what shall</span>
          <br />
          <span className="italic">we find?</span>
        </h1>
        <p className="text-lg text-[#1A1A1A]/60 max-w-md mx-auto font-medium animate-slide-up stagger-2">
          Search across Kuwait's top stores. Upload an image or ask away.
        </p>
      </div>

      {/* Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full">
        {suggestions.map((card, idx) => (
          <button
            key={idx}
            onClick={() => {
              if (card.action) card.action();
              else if (card.query) onSuggestionClick(card.query);
            }}
            className={`${
              card.accent ? "brutal-border-coral" : "brutal-border"
            } bg-white p-8 text-left group animate-slide-up`}
            style={{ animationDelay: `${(idx + 3) * 0.1}s` }}
          >
            <div
              className={`w-14 h-14 ${
                card.accent ? "bg-[#FF6B4A] text-white" : "bg-[#F0EBE3]"
              } flex items-center justify-center mb-6 group-hover:scale-110 transition-transform`}
            >
              {card.icon}
            </div>
            <h3 className="text-xl font-bold text-[#1A1A1A] mb-2">
              {card.title}
            </h3>
            <p className="text-sm text-[#1A1A1A]/60 font-medium">{card.desc}</p>
            <ArrowUpRight className="w-5 h-5 text-[#1A1A1A]/30 mt-4 group-hover:text-[#FF6B4A] group-hover:translate-x-1 group-hover:-translate-y-1 transition-all" />
          </button>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MESSAGE BUBBLE
// ═══════════════════════════════════════════════════════════════════════════

function MessageBubble({ message, onProductClick, index }) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end animate-slide-up">
        <div className="max-w-[80%]">
          {message.image && (
            <div className="mb-3 brutal-border overflow-hidden">
              <img
                src={message.image}
                alt="Uploaded"
                className="max-w-full max-h-48 object-contain bg-[#F0EBE3]"
              />
            </div>
          )}
          <div className="brutal-border bg-[#1A1A1A] text-white px-6 py-4">
            <p className="font-medium">{message.content}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-6 animate-slide-up items-start">
      <div className="w-12 h-12 bg-[#FF6B4A] flex items-center justify-center flex-shrink-0 text-white">
        <Sparkles className="w-5 h-5" />
      </div>

      <div className="flex-1 space-y-8 overflow-hidden">
        {message.generatedQuery && (
          <div className="brutal-border inline-flex items-center gap-2 bg-[#8B9A7D]/10 px-4 py-2 text-sm">
            <Camera className="w-4 h-4 text-[#8B9A7D]" />
            <span className="text-[#1A1A1A] font-medium">
              Detected: <strong>{message.generatedQuery}</strong>
            </span>
          </div>
        )}

        <div className="text-lg text-[#1A1A1A] font-medium leading-relaxed">
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>

        {message.products && message.products.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {message.products.map((product, idx) => {
              const type = getCategoryType(product.category);
              return type === "fashion" ? (
                <FashionCard
                  key={idx}
                  product={product}
                  index={idx}
                  onClick={() => onProductClick(product)}
                />
              ) : (
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

        {message.error && (
          <div className="brutal-border-coral bg-[#FF6B4A]/5 px-4 py-3 text-sm font-medium text-[#FF6B4A]">
            ⚠️ {message.content}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PRODUCT CARDS
// ═══════════════════════════════════════════════════════════════════════════

function ElectronicsCard({ product, index, onClick }) {
  const specs = product.specs ? Object.entries(product.specs).slice(0, 2) : [];

  return (
    <button
      onClick={onClick}
      className="brutal-border bg-white p-0 text-left w-full group animate-scale-in"
      style={{ animationDelay: `${index * 80}ms` }}
    >
      {/* Image */}
      <div className="relative aspect-square bg-[#F0EBE3] overflow-hidden">
        <img
          src={product.imageUrl}
          alt={product.title}
          className="w-full h-full object-contain p-6 mix-blend-multiply group-hover:scale-110 transition-transform duration-500"
          onError={(e) => (e.target.style.display = "none")}
        />
        <div className="absolute top-3 left-3 bg-[#1A1A1A] text-white px-2 py-1 text-[10px] font-bold uppercase tracking-wider">
          {formatStoreName(product.storeName)}
        </div>
      </div>

      {/* Info */}
      <div className="p-4 border-t-[3px] border-[#1A1A1A]">
        <div className="text-[10px] font-bold text-[#FF6B4A] uppercase tracking-wider mb-2">
          {product.brand}
        </div>
        <h3 className="font-bold text-[#1A1A1A] text-sm leading-tight line-clamp-2 mb-3 group-hover:text-[#FF6B4A] transition-colors">
          {product.title}
        </h3>

        {specs.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {specs.map(([key, val], i) => (
              <span
                key={i}
                className="text-[10px] bg-[#F0EBE3] px-2 py-1 font-medium text-[#1A1A1A]/70"
              >
                {val}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between pt-3 border-t border-[#1A1A1A]/10">
          <div>
            <span className="text-2xl font-bold text-[#1A1A1A]">
              {parseFloat(product.price).toFixed(3)}
            </span>
            <span className="text-xs font-medium text-[#1A1A1A]/50 ml-1">
              KWD
            </span>
          </div>
          <div className="w-8 h-8 bg-[#1A1A1A] text-white flex items-center justify-center group-hover:bg-[#FF6B4A] transition-colors">
            <ChevronRight className="w-4 h-4" />
          </div>
        </div>
      </div>
    </button>
  );
}

function FashionCard({ product, index, onClick }) {
  return (
    <button
      onClick={onClick}
      className="brutal-border bg-white p-0 text-left w-full group animate-scale-in overflow-hidden"
      style={{ animationDelay: `${index * 80}ms` }}
    >
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-[#F0EBE3]">
        <img
          src={product.imageUrl}
          alt={product.title}
          className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
          onError={(e) => (e.target.style.display = "none")}
        />

        {/* Overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#1A1A1A] via-transparent to-transparent opacity-80" />

        {/* Store Badge */}
        <div className="absolute top-3 right-3 bg-white text-[#1A1A1A] px-2 py-1 text-[10px] font-bold uppercase tracking-wider">
          {formatStoreName(product.storeName)}
        </div>

        {/* Bottom Info */}
        <div className="absolute bottom-0 left-0 p-4 w-full text-white">
          <div className="text-[10px] font-bold opacity-70 uppercase tracking-widest mb-1">
            {product.brand}
          </div>
          <h3 className="font-bold text-sm line-clamp-2 mb-3">
            {product.title}
          </h3>
          <div className="flex justify-between items-end">
            <div className="text-2xl font-bold">
              {parseFloat(product.price).toFixed(3)}
              <span className="text-xs font-normal opacity-70 ml-1">KWD</span>
            </div>
            <div className="w-8 h-8 bg-white/20 backdrop-blur flex items-center justify-center group-hover:bg-[#FF6B4A] transition-colors">
              <ExternalLink className="w-4 h-4" />
            </div>
          </div>
        </div>
      </div>
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MODALS
// ═══════════════════════════════════════════════════════════════════════════

function ImageUploadModal({
  imagePreview,
  isAnalyzing,
  analysisStatus,
  onAnalyze,
  onCancel,
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-[#1A1A1A]/80 backdrop-blur-sm animate-fade-in">
      <div className="brutal-border bg-white max-w-xl w-full overflow-hidden animate-scale-in">
        {/* Header */}
        <div className="px-6 py-4 border-b-[3px] border-[#1A1A1A] flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#FF6B4A] flex items-center justify-center">
              <Scan className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-[#1A1A1A]">
                Visual Search
              </h3>
              <p className="text-xs text-[#1A1A1A]/60">
                AI-powered product detection
              </p>
            </div>
          </div>
          <button
            onClick={onCancel}
            disabled={isAnalyzing}
            className="p-2 hover:bg-[#F0EBE3] transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5 text-[#1A1A1A]" />
          </button>
        </div>

        {/* Image */}
        <div className="p-6">
          <div className="relative aspect-video w-full bg-[#F0EBE3] overflow-hidden border-2 border-dashed border-[#1A1A1A]/20 mb-6">
            <img
              src={imagePreview}
              alt="Selected"
              className="w-full h-full object-contain"
            />
            {isAnalyzing && (
              <div className="absolute inset-0 bg-[#1A1A1A]/70 flex items-center justify-center">
                <div className="text-center text-white">
                  <Loader2 className="w-10 h-10 animate-spin mx-auto mb-3" />
                  <p className="text-sm font-medium">{analysisStatus}</p>
                </div>
              </div>
            )}
          </div>

          {analysisStatus && !isAnalyzing && (
            <div className="mb-6 p-3 bg-[#8B9A7D]/10 border-2 border-[#8B9A7D] text-sm font-medium text-[#1A1A1A] flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#8B9A7D]" />
              {analysisStatus}
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={onAnalyze}
              disabled={isAnalyzing}
              className="flex-1 bg-[#1A1A1A] text-white py-4 font-bold text-sm uppercase tracking-wider flex items-center justify-center gap-2 hover:bg-[#FF6B4A] transition-colors disabled:opacity-50"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Search className="w-4 h-4" />
                  Find Product
                </>
              )}
            </button>
            <button
              onClick={onCancel}
              disabled={isAnalyzing}
              className="px-6 py-4 border-[3px] border-[#1A1A1A] text-[#1A1A1A] font-bold text-sm uppercase tracking-wider hover:bg-[#F0EBE3] transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

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
      className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-[#1A1A1A]/80 backdrop-blur-sm animate-fade-in"
      onClick={handleBackdropClick}
    >
      <div className="brutal-border bg-white max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col md:flex-row animate-scale-in">
        {/* Image Side */}
        <div className="w-full md:w-1/2 bg-[#F0EBE3] p-8 flex items-center justify-center relative shrink-0">
          <div className="absolute top-4 left-4 bg-[#1A1A1A] text-white px-3 py-1 text-[10px] font-bold uppercase tracking-wider flex items-center gap-2">
            <MapPin className="w-3 h-3" />
            {formatStoreName(product.storeName)}
          </div>
          <img
            src={product.imageUrl}
            alt={product.title}
            className="max-w-full max-h-[40vh] md:max-h-[60vh] object-contain mix-blend-multiply"
            onError={(e) => {
              e.target.src = "https://via.placeholder.com/400?text=No+Image";
            }}
          />
        </div>

        {/* Details Side */}
        <div className="w-full md:w-1/2 flex flex-col min-h-0 border-l-[3px] border-[#1A1A1A]">
          {/* Header */}
          <div className="px-6 py-5 border-b-[3px] border-[#1A1A1A] flex justify-between items-start shrink-0">
            <div className="pr-4">
              <div className="text-[#FF6B4A] font-bold text-xs uppercase tracking-widest mb-2">
                {product.brand}
              </div>
              <h2 className="text-xl font-bold text-[#1A1A1A] leading-tight">
                {product.title}
              </h2>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-[#F0EBE3] transition-colors shrink-0"
            >
              <X className="w-5 h-5 text-[#1A1A1A]" />
            </button>
          </div>

          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6 no-scrollbar min-h-0">
            {/* Price */}
            <div className="bg-[#1A1A1A] text-white p-5 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest opacity-60 mb-1">
                  Price
                </p>
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-bold">
                    {parseFloat(product.price).toFixed(3)}
                  </span>
                  <span className="text-sm opacity-60">KWD</span>
                </div>
              </div>
              <div className="text-right">
                <span className="bg-[#8B9A7D] text-white text-[10px] font-bold uppercase px-2 py-1">
                  In Stock
                </span>
              </div>
            </div>

            {/* Specs */}
            {specs.length > 0 && (
              <div>
                <h3 className="text-xs font-bold text-[#1A1A1A] uppercase tracking-widest mb-4 flex items-center gap-2">
                  <Zap className="w-4 h-4 text-[#FF6B4A]" /> Specifications
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {specs.map(([key, value], idx) => (
                    <div key={idx} className="p-3 bg-[#F0EBE3]">
                      <div className="text-[10px] font-bold text-[#1A1A1A]/50 uppercase tracking-wider mb-1">
                        {formatSpecKey(key)}
                      </div>
                      <div
                        className="text-sm font-bold text-[#1A1A1A] line-clamp-1"
                        title={formatSpecValue(value)}
                      >
                        {formatSpecValue(value)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {product.description && (
              <div>
                <h3 className="text-xs font-bold text-[#1A1A1A] uppercase tracking-widest mb-3">
                  About
                </h3>
                <p className="text-sm text-[#1A1A1A]/70 leading-relaxed">
                  {product.description}
                </p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-6 border-t-[3px] border-[#1A1A1A] shrink-0">
            <a
              href={product.productUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full bg-[#FF6B4A] text-white py-4 font-bold text-sm uppercase tracking-wider flex items-center justify-center gap-2 hover:bg-[#FF8A70] transition-colors"
            >
              Buy Now
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

function LoadingIndicator() {
  return (
    <div className="flex items-center gap-4 pl-2">
      <div className="w-12 h-12 bg-[#F0EBE3] animate-pulse" />
      <div className="flex gap-2">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-3 h-3 bg-[#1A1A1A]/20 animate-bounce-subtle"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

const getGreeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
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
  return fashionKeywords.some((kw) => cat.includes(kw))
    ? "fashion"
    : "electronics";
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
