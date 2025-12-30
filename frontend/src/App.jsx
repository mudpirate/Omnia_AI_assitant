import React, { useState, useEffect, useRef } from "react";
import {
  Send,
  Loader2,
  ShoppingBag,
  ExternalLink,
  Search,
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
  Scan,
  Circle,
  Sparkles,
} from "lucide-react";

// ═══════════════════════════════════════════════════════════════════════════
// JAPANESE MINIMAL THEME
// Zen simplicity, generous whitespace, quiet elegance, subtle warmth
// ═══════════════════════════════════════════════════════════════════════════

const customStyles = `
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;1,300&family=Noto+Sans+JP:wght@300;400;500&display=swap');

  :root {
    --washi: #FDFBF7;
    --sumi: #2C2C2C;
    --sumi-light: #4A4A4A;
    --kinari: #F5F1E8;
    --cha: #8B7355;
    --aka: #C73E3A;
    --matcha: #7D8471;
    --usuzumi: #9E9E9E;
  }

  * {
    font-family: 'Noto Sans JP', sans-serif;
    font-weight: 300;
  }

  .font-display {
    font-family: 'Cormorant Garamond', serif;
    font-weight: 300;
  }

  @keyframes breath {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 0.8; }
  }

  @keyframes rise {
    from { opacity: 0; transform: translateY(30px); }
    to { opacity: 1; transform: translateY(0); }
  }

  @keyframes fade {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes float-gentle {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-8px); }
  }

  @keyframes pulse-ring {
    0% { transform: scale(0.8); opacity: 0.8; }
    50% { transform: scale(1.2); opacity: 0.3; }
    100% { transform: scale(0.8); opacity: 0.8; }
  }

  .animate-breath { animation: breath 4s ease-in-out infinite; }
  .animate-rise { animation: rise 0.8s cubic-bezier(0.22, 1, 0.36, 1) forwards; }
  .animate-fade { animation: fade 0.6s ease-out forwards; }
  .animate-float-gentle { animation: float-gentle 6s ease-in-out infinite; }
  .animate-pulse-ring { animation: pulse-ring 2s ease-in-out infinite; }

  .delay-1 { animation-delay: 0.1s; opacity: 0; }
  .delay-2 { animation-delay: 0.2s; opacity: 0; }
  .delay-3 { animation-delay: 0.3s; opacity: 0; }

  .ink-wash {
    background: radial-gradient(ellipse at 30% 0%, rgba(44, 44, 44, 0.02) 0%, transparent 50%),
                radial-gradient(ellipse at 70% 100%, rgba(139, 115, 85, 0.03) 0%, transparent 50%);
  }

  .no-scrollbar::-webkit-scrollbar { display: none; }
  .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }

  .hover-line {
    position: relative;
  }
  .hover-line::after {
    content: '';
    position: absolute;
    bottom: -2px;
    left: 0;
    width: 0;
    height: 1px;
    background: var(--sumi);
    transition: width 0.4s cubic-bezier(0.22, 1, 0.36, 1);
  }
  .hover-line:hover::after {
    width: 100%;
  }

  .card-lift {
    transition: transform 0.5s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.5s ease;
  }
  .card-lift:hover {
    transform: translateY(-4px);
    box-shadow: 0 20px 40px -20px rgba(44, 44, 44, 0.15);
  }

  .enso {
    border: 1px solid var(--usuzumi);
    border-radius: 50%;
    opacity: 0.2;
  }
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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
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
    if (!validTypes.includes(file.type))
      return alert("Please upload a JPEG, PNG, or WebP image");
    if (file.size > 10 * 1024 * 1024)
      return alert("Image size must be less than 10MB");
    setSelectedImage(file);
    const reader = new FileReader();
    reader.onloadend = () => {
      setImagePreview(reader.result);
      setShowImageUpload(true);
    };
    reader.readAsDataURL(file);
  };

  // 🔥 NEW: CLIP Visual Search - Direct image-to-product matching
  const visualSearch = async () => {
    if (!selectedImage) return;
    setIsAnalyzingImage(true);
    setAnalysisStatus("Processing image with Omnia...");

    try {
      // Add user message with image
      setMessages((prev) => [
        ...prev,
        {
          role: "user",
          content: "Visual Search",
          image: imagePreview,
          isVisualSearch: true,
        },
      ]);

      setAnalysisStatus("Finding visually similar products...");

      // 🔥 Single API call to /visual-search (CLIP-powered)
      const formData = new FormData();
      formData.append("image", selectedImage);

      const response = await fetch(`${API_URL}/visual-search`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Search failed: ${response.status}`);
      }

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || "Visual search failed");
      }

      // Add assistant response with products
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            data.count > 0
              ? `I found ${data.count} visually similar products. Here are the best matches:`
              : "I couldn't find any visually similar products. Try uploading a clearer image or search by text.",
          products: data.products || [],
          isVisualSearch: true,
          categoryType: data.categoryType,
        },
      ]);

      clearImage();
    } catch (error) {
      console.error("Visual search error:", error);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Visual search failed: ${error.message}. Please try again or use text search.`,
          error: true,
        },
      ]);
    } finally {
      setIsAnalyzingImage(false);
      setAnalysisStatus("");
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
    <div className="flex h-screen bg-[#FDFBF7] overflow-hidden">
      <style>{customStyles}</style>
      <Sidebar />
      <main className="flex-1 flex flex-col relative h-full ink-wash">
        <div className="absolute top-32 right-24 w-40 h-40 enso animate-float-gentle pointer-events-none" />
        <div className="absolute bottom-60 left-[20%] w-2 h-2 rounded-full bg-[#C73E3A]/30 pointer-events-none" />

        <header className="absolute top-8 right-8 z-20">
          <div className="flex items-center gap-4">
            <p className="text-[10px] tracking-[0.2em] text-[#9E9E9E] uppercase">
              Guest
            </p>
            <div className="w-8 h-8 rounded-full bg-[#F5F1E8] flex items-center justify-center">
              <span className="text-[10px] text-[#8B7355]">G</span>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto no-scrollbar scroll-smooth relative z-10">
          <div className="max-w-4xl mx-auto px-8 lg:px-16 py-16 min-h-full flex flex-col">
            {messages.length === 0 ? (
              <WelcomeScreen
                onSuggestionClick={handleSend}
                onImageUploadClick={() => fileInputRef.current?.click()}
              />
            ) : (
              <div className="space-y-16 pb-48 pt-20">
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

        {selectedProduct && (
          <ProductModal
            product={selectedProduct}
            onClose={() => setSelectedProduct(null)}
          />
        )}
        {showImageUpload && imagePreview && (
          <ImageUploadModal
            imagePreview={imagePreview}
            isAnalyzing={isAnalyzingImage}
            analysisStatus={analysisStatus}
            onAnalyze={visualSearch}
            onCancel={clearImage}
          />
        )}

        <div className="absolute bottom-10 left-0 right-0 px-8 z-30">
          <div className="max-w-2xl mx-auto">
            <div className="bg-white/80 backdrop-blur-sm border-b border-[#2C2C2C]/10 flex items-center gap-4 px-2 py-3">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading || isAnalyzingImage}
                className="p-3 text-[#9E9E9E] hover:text-[#8B7355] transition-colors duration-300 disabled:opacity-30 group relative"
                title="Visual Search with Omnia"
              >
                <Camera className="w-5 h-5" strokeWidth={1.5} />
                <Sparkles
                  className="w-2.5 h-2.5 absolute -top-0.5 -right-0.5 text-[#C73E3A] opacity-0 group-hover:opacity-100 transition-opacity"
                  strokeWidth={2}
                />
              </button>
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="What are you looking for..."
                className="flex-1 bg-transparent border-none outline-none text-[#2C2C2C] placeholder-[#9E9E9E] text-base tracking-wide h-10"
                disabled={isLoading || isAnalyzingImage}
                autoFocus
              />
              <button
                onClick={() => handleSend()}
                disabled={isLoading || !input.trim() || isAnalyzingImage}
                className="p-3 text-[#2C2C2C] hover:text-[#C73E3A] disabled:opacity-30 transition-colors duration-300"
              >
                {isLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin" strokeWidth={1.5} />
                ) : (
                  <Send className="w-5 h-5" strokeWidth={1.5} />
                )}
              </button>
            </div>
            <div className="flex items-center justify-center gap-6 mt-6 text-[10px] tracking-[0.3em] text-[#9E9E9E] uppercase">
              <span>Omnia</span>
              <span className="w-1 h-1 rounded-full bg-[#9E9E9E]/30" />
              <span>Kuwait</span>
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

function Sidebar() {
  return (
    <aside className="w-20 lg:w-64 bg-[#F5F1E8] flex flex-col justify-between py-12 px-4 lg:px-8 hidden md:flex z-40 border-r border-[#2C2C2C]/5">
      <div>
        <div className="flex items-center gap-4 mb-20">
          <div className="w-10 h-10 rounded-full border border-[#2C2C2C]/20 flex items-center justify-center">
            <ShoppingBag className="w-4 h-4 text-[#2C2C2C]" strokeWidth={1.5} />
          </div>
          <span className="hidden lg:block font-display text-2xl text-[#2C2C2C] tracking-wide">
            Omnia
          </span>
        </div>
        <nav className="space-y-1">
          <SidebarItem
            icon={<Search className="w-4 h-4" strokeWidth={1.5} />}
            label="Discover"
            sublabel="Search products"
            active
          />
          <SidebarItem
            icon={<LayoutGrid className="w-4 h-4" strokeWidth={1.5} />}
            label="Categories"
            sublabel="Browse all"
          />
          <SidebarItem
            icon={<TrendingUp className="w-4 h-4" strokeWidth={1.5} />}
            label="Trending"
            sublabel="Popular now"
          />
          <SidebarItem
            icon={<History className="w-4 h-4" strokeWidth={1.5} />}
            label="History"
            sublabel="Past searches"
          />
          <SidebarItem
            icon={<Star className="w-4 h-4" strokeWidth={1.5} />}
            label="Saved"
            sublabel="Your favorites"
          />
        </nav>
      </div>
      <div className="hidden lg:block border-t border-[#2C2C2C]/10 pt-8">
        <p className="text-[10px] tracking-[0.2em] text-[#9E9E9E] uppercase mb-3">
          Pro
        </p>
        <p className="text-xs text-[#4A4A4A] leading-relaxed mb-4">
          Unlock price tracking and unlimited history
        </p>
        <button className="text-xs text-[#8B7355] hover-line">Upgrade →</button>
      </div>
    </aside>
  );
}

function SidebarItem({ icon, label, sublabel, active }) {
  return (
    <button
      className={`w-full flex items-center gap-4 px-4 py-3 transition-all duration-300 ${
        active ? "text-[#2C2C2C]" : "text-[#9E9E9E] hover:text-[#4A4A4A]"
      }`}
    >
      {icon}
      <div className="hidden lg:block text-left">
        <span className="block text-sm">{label}</span>
        <span className="block text-[10px] tracking-wider text-[#9E9E9E]">
          {sublabel}
        </span>
      </div>
      {active && <div className="ml-auto w-1 h-1 rounded-full bg-[#C73E3A]" />}
    </button>
  );
}

function WelcomeScreen({ onSuggestionClick, onImageUploadClick }) {
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const suggestions = [
    {
      icon: <Scan className="w-5 h-5" strokeWidth={1.5} />,
      title: "Visual Search",
      subtitle: "Omnia Powered",
      desc: "Upload a photo to find similar products",
      action: onImageUploadClick,
      highlight: true,
    },
    {
      icon: <Zap className="w-5 h-5" strokeWidth={1.5} />,
      title: "Technology",
      subtitle: "Electronics",
      desc: "Latest devices & gadgets",
      query: "Show me the latest flagship phones",
    },
    {
      icon: <Package className="w-5 h-5" strokeWidth={1.5} />,
      title: "Fashion",
      subtitle: "Style",
      desc: "Clothes, shoes, accessories",
      query: "Trending fashion items under 40 KWD",
    },
  ];

  return (
    <div className="flex flex-col items-center justify-center h-full animate-fade max-w-3xl mx-auto pb-32">
      <div className="w-24 h-24 enso mb-12 animate-breath" />
      <div className="text-center space-y-6 mb-20">
        <p className="text-[10px] tracking-[0.4em] text-[#9E9E9E] uppercase animate-rise delay-1">
          {greeting}
        </p>
        <h1 className="font-display text-5xl md:text-7xl text-[#2C2C2C] leading-[1.1] tracking-wide animate-rise delay-2">
          What are you looking for?
        </h1>
        <p className="text-lg text-[#9E9E9E] max-w-md mx-auto tracking-wide animate-rise delay-3">
          Search across Kuwait's top stores
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 w-full">
        {suggestions.map((card, idx) => (
          <button
            key={idx}
            onClick={() =>
              card.action ? card.action() : onSuggestionClick(card.query)
            }
            className={`group text-left p-8 bg-white/50 hover:bg-white border transition-all duration-500 card-lift animate-rise ${
              card.highlight
                ? "border-[#C73E3A]/20 hover:border-[#C73E3A]/40"
                : "border-[#2C2C2C]/5 hover:border-[#2C2C2C]/10"
            }`}
            style={{ animationDelay: `${(idx + 4) * 0.1}s`, opacity: 0 }}
          >
            <div
              className={`w-12 h-12 rounded-full border flex items-center justify-center mb-6 transition-all duration-300 ${
                card.highlight
                  ? "border-[#C73E3A]/30 text-[#C73E3A] group-hover:border-[#C73E3A]/60 group-hover:bg-[#C73E3A]/5"
                  : "border-[#2C2C2C]/10 text-[#8B7355] group-hover:border-[#C73E3A]/30 group-hover:text-[#C73E3A]"
              }`}
            >
              {card.icon}
            </div>
            <h3 className="text-base text-[#2C2C2C] mb-1">{card.title}</h3>
            <p
              className={`text-[10px] tracking-[0.2em] uppercase mb-3 ${
                card.highlight ? "text-[#C73E3A]/70" : "text-[#9E9E9E]"
              }`}
            >
              {card.subtitle}
            </p>
            <p className="text-sm text-[#9E9E9E]">{card.desc}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({ message, onProductClick }) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end animate-rise">
        <div className="max-w-[75%]">
          {message.image && (
            <div className="mb-4 overflow-hidden border border-[#2C2C2C]/10 relative">
              <img
                src={message.image}
                alt="Uploaded"
                className="max-w-full max-h-48 object-contain bg-[#F5F1E8]"
              />
              {message.isVisualSearch && (
                <div className="absolute bottom-2 right-2 bg-[#C73E3A] text-white text-[9px] tracking-wider uppercase px-2 py-1 flex items-center gap-1">
                  <Sparkles className="w-3 h-3" strokeWidth={2} />
                  Omnia Visual Search
                </div>
              )}
            </div>
          )}
          <div className="bg-[#2C2C2C] text-white/90 px-6 py-4">
            <p className="text-sm tracking-wide">{message.content}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-8 animate-rise items-start">
      <div className="w-8 h-8 rounded-full border border-[#C73E3A]/30 flex items-center justify-center flex-shrink-0 text-[#C73E3A]">
        <Circle className="w-3 h-3" fill="currentColor" strokeWidth={0} />
      </div>
      <div className="flex-1 space-y-10 overflow-hidden">
        {message.isVisualSearch && message.products?.length > 0 && (
          <div className="inline-flex items-center gap-3 text-sm text-[#9E9E9E] bg-[#F5F1E8] px-4 py-2">
            <Sparkles className="w-4 h-4 text-[#C73E3A]" strokeWidth={1.5} />
            <span>
              Visual match powered by{" "}
              <span className="text-[#C73E3A]">Omnia</span>
            </span>
          </div>
        )}
        <div className="text-base text-[#4A4A4A] leading-relaxed tracking-wide">
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>
        {message.products?.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {message.products.map((product, idx) => (
              <ProductCard
                key={idx}
                product={product}
                index={idx}
                onClick={() => onProductClick(product)}
                showSimilarity={message.isVisualSearch}
              />
            ))}
          </div>
        )}
        {message.error && (
          <div className="text-sm text-[#C73E3A]/80 border-l-2 border-[#C73E3A]/30 pl-4">
            {message.content}
          </div>
        )}
      </div>
    </div>
  );
}

function ProductCard({ product, index, onClick, showSimilarity = false }) {
  const specs = product.specs ? Object.entries(product.specs).slice(0, 2) : [];
  const isFashion = getCategoryType(product.category) === "fashion";

  if (isFashion) {
    return (
      <button
        onClick={onClick}
        className="group bg-white border border-[#2C2C2C]/5 text-left w-full card-lift animate-rise overflow-hidden"
        style={{ animationDelay: `${index * 60}ms`, opacity: 0 }}
      >
        <div className="relative aspect-[3/4] w-full overflow-hidden bg-[#F5F1E8]">
          <img
            src={product.imageUrl}
            alt={product.title}
            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
            onError={(e) => (e.target.style.display = "none")}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#2C2C2C]/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
          <div className="absolute top-4 right-4 text-[10px] tracking-[0.15em] text-[#9E9E9E] uppercase bg-white/90 px-2 py-1">
            {formatStoreName(product.storeName)}
          </div>
          {/* 🔥 NEW: Similarity badge for visual search */}
          {showSimilarity && product.similarity && (
            <div className="absolute top-4 left-4 text-[10px] tracking-[0.1em] text-white uppercase bg-[#C73E3A] px-2 py-1 flex items-center gap-1">
              <Sparkles className="w-3 h-3" strokeWidth={2} />
              {product.similarity} match
            </div>
          )}
          <div className="absolute bottom-0 left-0 p-5 w-full text-white opacity-0 group-hover:opacity-100 transition-opacity duration-500">
            <div className="font-display text-2xl">
              {parseFloat(product.price).toFixed(3)}
              <span className="text-xs opacity-70 ml-2">KWD</span>
            </div>
          </div>
        </div>
        <div className="p-5">
          <div className="text-[10px] tracking-[0.2em] text-[#8B7355] uppercase mb-2">
            {product.brand}
          </div>
          <h3 className="text-sm text-[#2C2C2C] line-clamp-2 group-hover:text-[#C73E3A] transition-colors duration-300">
            {product.title}
          </h3>
          <div className="mt-3 font-display text-lg text-[#2C2C2C]">
            {parseFloat(product.price).toFixed(3)}{" "}
            <span className="text-[10px] text-[#9E9E9E]">KWD</span>
          </div>
        </div>
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      className="group bg-white border border-[#2C2C2C]/5 text-left w-full card-lift animate-rise"
      style={{ animationDelay: `${index * 60}ms`, opacity: 0 }}
    >
      <div className="relative aspect-square bg-[#F5F1E8] overflow-hidden">
        <img
          src={product.imageUrl}
          alt={product.title}
          className="w-full h-full object-contain p-8 mix-blend-multiply group-hover:scale-105 transition-transform duration-700"
          onError={(e) => (e.target.style.display = "none")}
        />
        <div className="absolute top-4 left-4 text-[10px] tracking-[0.15em] text-[#9E9E9E] uppercase">
          {formatStoreName(product.storeName)}
        </div>
        {/* 🔥 NEW: Similarity badge for visual search */}
        {showSimilarity && product.similarity && (
          <div className="absolute top-4 right-4 text-[10px] tracking-[0.1em] text-white uppercase bg-[#C73E3A] px-2 py-1 flex items-center gap-1">
            <Sparkles className="w-3 h-3" strokeWidth={2} />
            {product.similarity} match
          </div>
        )}
      </div>
      <div className="p-5 border-t border-[#2C2C2C]/5">
        <div className="text-[10px] tracking-[0.2em] text-[#8B7355] uppercase mb-2">
          {product.brand}
        </div>
        <h3 className="text-sm text-[#2C2C2C] leading-snug line-clamp-2 mb-4 group-hover:text-[#C73E3A] transition-colors duration-300">
          {product.title}
        </h3>
        {specs.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {specs.map(([k, v], i) => (
              <span
                key={i}
                className="text-[10px] text-[#9E9E9E] border border-[#2C2C2C]/10 px-2 py-1"
              >
                {v}
              </span>
            ))}
          </div>
        )}
        <div className="flex items-end justify-between pt-4 border-t border-[#2C2C2C]/5">
          <div>
            <span className="font-display text-2xl text-[#2C2C2C]">
              {parseFloat(product.price).toFixed(3)}
            </span>
            <span className="text-[10px] text-[#9E9E9E] ml-2 tracking-wider">
              KWD
            </span>
          </div>
          <ChevronRight
            className="w-4 h-4 text-[#9E9E9E] group-hover:text-[#C73E3A] group-hover:translate-x-1 transition-all duration-300"
            strokeWidth={1.5}
          />
        </div>
      </div>
    </button>
  );
}

function ImageUploadModal({
  imagePreview,
  isAnalyzing,
  analysisStatus,
  onAnalyze,
  onCancel,
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-8 bg-[#FDFBF7]/95 backdrop-blur-sm animate-fade">
      <div className="bg-white border border-[#2C2C2C]/10 max-w-lg w-full overflow-hidden animate-rise shadow-2xl shadow-[#2C2C2C]/5">
        <div className="px-8 py-6 border-b border-[#2C2C2C]/5 flex justify-between items-center">
          <div>
            <h3 className="text-base text-[#2C2C2C] mb-1 flex items-center gap-2">
              Visual Search
              <Sparkles className="w-4 h-4 text-[#C73E3A]" strokeWidth={2} />
            </h3>
            <p className="text-[10px] tracking-[0.2em] text-[#9E9E9E] uppercase">
              Omnia • Image Recognition
            </p>
          </div>
          <button
            onClick={onCancel}
            disabled={isAnalyzing}
            className="p-2 text-[#9E9E9E] hover:text-[#2C2C2C] transition-colors disabled:opacity-30"
          >
            <X className="w-5 h-5" strokeWidth={1.5} />
          </button>
        </div>
        <div className="p-8">
          <div className="relative aspect-video w-full bg-[#F5F1E8] overflow-hidden mb-8">
            <img
              src={imagePreview}
              alt="Selected"
              className="w-full h-full object-contain"
            />
            {isAnalyzing && (
              <div className="absolute inset-0 bg-[#FDFBF7]/90 flex items-center justify-center">
                <div className="text-center">
                  {/* Animated CLIP processing indicator */}
                  <div className="relative w-16 h-16 mx-auto mb-4">
                    <div className="absolute inset-0 border-2 border-[#C73E3A]/20 rounded-full animate-pulse-ring" />
                    <div
                      className="absolute inset-2 border-2 border-[#C73E3A]/40 rounded-full animate-pulse-ring"
                      style={{ animationDelay: "0.3s" }}
                    />
                    <div
                      className="absolute inset-4 border-2 border-[#C73E3A]/60 rounded-full animate-pulse-ring"
                      style={{ animationDelay: "0.6s" }}
                    />
                    <Sparkles
                      className="absolute inset-0 m-auto w-6 h-6 text-[#C73E3A]"
                      strokeWidth={2}
                    />
                  </div>
                  <p className="text-sm text-[#4A4A4A]">{analysisStatus}</p>
                  <p className="text-[10px] text-[#9E9E9E] mt-2 tracking-wider uppercase">
                    Powered by Omnia
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Info box about CLIP */}
          <div className="mb-8 p-4 bg-[#F5F1E8] border-l-2 border-[#C73E3A]/30">
            <p className="text-xs text-[#4A4A4A] leading-relaxed">
              <span className="text-[#C73E3A] font-medium">Omnia</span> analyzes
              your image and finds visually similar products by comparing image
              features directly — no text description needed.
            </p>
          </div>

          <div className="flex gap-4">
            <button
              onClick={onAnalyze}
              disabled={isAnalyzing}
              className="flex-1 bg-[#2C2C2C] text-white py-4 text-sm tracking-wider flex items-center justify-center gap-3 hover:bg-[#C73E3A] transition-colors disabled:opacity-30"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.5} />
                  Processing...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" strokeWidth={2} />
                  Find Similar Products
                </>
              )}
            </button>
            <button
              onClick={onCancel}
              disabled={isAnalyzing}
              className="px-8 py-4 border border-[#2C2C2C]/20 text-[#4A4A4A] text-sm tracking-wider hover:border-[#2C2C2C]/40 transition-colors disabled:opacity-30"
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
  const specs = product.specs ? Object.entries(product.specs) : [];

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-8 bg-[#FDFBF7]/95 backdrop-blur-sm animate-fade"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white border border-[#2C2C2C]/10 max-w-4xl w-full max-h-[85vh] overflow-hidden flex flex-col md:flex-row animate-rise shadow-2xl shadow-[#2C2C2C]/5">
        <div className="w-full md:w-1/2 bg-[#F5F1E8] p-12 flex items-center justify-center relative shrink-0">
          <div className="absolute top-6 left-6 text-[10px] tracking-[0.15em] text-[#9E9E9E] uppercase flex items-center gap-2">
            <MapPin className="w-3 h-3" strokeWidth={1.5} />
            {formatStoreName(product.storeName)}
          </div>
          {/* Show similarity in modal if available */}
          {product.similarity && (
            <div className="absolute top-6 right-6 text-[10px] tracking-[0.1em] text-white uppercase bg-[#C73E3A] px-2 py-1 flex items-center gap-1">
              <Sparkles className="w-3 h-3" strokeWidth={2} />
              {product.similarity} match
            </div>
          )}
          <img
            src={product.imageUrl}
            alt={product.title}
            className="max-w-full max-h-[50vh] object-contain mix-blend-multiply"
            onError={(e) => {
              e.target.src = "https://via.placeholder.com/400?text=No+Image";
            }}
          />
        </div>
        <div className="w-full md:w-1/2 flex flex-col min-h-0 border-l border-[#2C2C2C]/5">
          <div className="px-8 py-6 border-b border-[#2C2C2C]/5 flex justify-between items-start shrink-0">
            <div className="pr-4">
              <div className="text-[10px] tracking-[0.2em] text-[#8B7355] uppercase mb-2">
                {product.brand}
              </div>
              <h2 className="text-lg text-[#2C2C2C] leading-snug">
                {product.title}
              </h2>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-[#9E9E9E] hover:text-[#2C2C2C] transition-colors shrink-0"
            >
              <X className="w-5 h-5" strokeWidth={1.5} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-8 space-y-8 no-scrollbar min-h-0">
            <div className="pb-8 border-b border-[#2C2C2C]/5">
              <p className="text-[10px] tracking-[0.2em] text-[#9E9E9E] uppercase mb-2">
                Price
              </p>
              <div className="flex items-baseline gap-2">
                <span className="font-display text-4xl text-[#2C2C2C]">
                  {parseFloat(product.price).toFixed(3)}
                </span>
                <span className="text-sm text-[#9E9E9E]">KWD</span>
              </div>
              <span className="inline-block mt-3 text-[10px] tracking-[0.15em] text-[#7D8471] uppercase border border-[#7D8471]/30 px-2 py-1">
                In Stock
              </span>
            </div>
            {specs.length > 0 && (
              <div>
                <h3 className="text-[10px] tracking-[0.2em] text-[#9E9E9E] uppercase mb-4">
                  Specifications
                </h3>
                <div className="space-y-3">
                  {specs.map(([k, v], i) => (
                    <div
                      key={i}
                      className="flex justify-between items-baseline py-2 border-b border-[#2C2C2C]/5"
                    >
                      <span className="text-xs text-[#9E9E9E]">
                        {formatSpecKey(k)}
                      </span>
                      <span className="text-sm text-[#2C2C2C]">
                        {formatSpecValue(v)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {product.description && (
              <div>
                <h3 className="text-[10px] tracking-[0.2em] text-[#9E9E9E] uppercase mb-3">
                  Details
                </h3>
                <p className="text-sm text-[#4A4A4A] leading-relaxed">
                  {product.description}
                </p>
              </div>
            )}
          </div>
          <div className="p-8 border-t border-[#2C2C2C]/5 shrink-0">
            <a
              href={product.productUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full bg-[#2C2C2C] text-white py-4 text-sm tracking-wider flex items-center justify-center gap-3 hover:bg-[#C73E3A] transition-colors duration-300"
            >
              Buy Now
              <ExternalLink className="w-4 h-4" strokeWidth={1.5} />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

function LoadingIndicator() {
  return (
    <div className="flex items-center gap-6 pl-2">
      <div className="w-8 h-8 rounded-full border border-[#C73E3A]/30 flex items-center justify-center">
        <div className="w-2 h-2 rounded-full bg-[#C73E3A]/50 animate-breath" />
      </div>
      <div className="flex gap-3">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-[#9E9E9E]/40 animate-breath"
            style={{ animationDelay: `${i * 300}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

function getCategoryType(category) {
  if (!category) return "electronics";
  const cat = category.toLowerCase();
  return [
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
  ].some((k) => cat.includes(k))
    ? "fashion"
    : "electronics";
}

function formatStoreName(storeName) {
  return (
    {
      XCITE: "Xcite",
      BEST: "Best Al-Yousifi",
      BEST_KW: "Best",
      NOON: "Noon",
      EUREKA: "Eureka",
      DIESEL: "Diesel",
      "H&M": "H&M",
      HM: "H&M",
    }[storeName] || storeName.replace(/_/g, " ")
  );
}

function formatSpecKey(key) {
  return key
    .replace(/_/g, " ")
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function formatSpecValue(value) {
  return typeof value === "string"
    ? value.charAt(0).toUpperCase() + value.slice(1)
    : value;
}

export default App;
