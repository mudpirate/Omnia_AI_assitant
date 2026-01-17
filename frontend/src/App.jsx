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
// MONOCHROME THEME
// Strict Black & White, Roboto Font, High Contrast, Industrial Cleanliness
// ═══════════════════════════════════════════════════════════════════════════

const customStyles = `
  @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap');

  :root {
    --bg-primary: #FFFFFF;
    --bg-secondary: #FAFAFA;
    --text-primary: #000000;
    --text-secondary: #52525B; /* Zinc-600 */
    --text-tertiary: #A1A1AA;  /* Zinc-400 */
    --accent-black: #000000;
    --border-light: #E4E4E7;   /* Zinc-200 */
  }

  * {
    font-family: 'Roboto', sans-serif;
    font-weight: 400;
  }

  h1, h2, h3, h4, h5, h6, .font-display {
    font-family: 'Roboto', sans-serif;
    font-weight: 300; /* Light weight for headings */
  }

  .font-medium {
    font-weight: 500;
  }

  @keyframes fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes slide-up {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .animate-fade { animation: fade-in 0.4s ease-out forwards; }
  .animate-rise { animation: slide-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards; }

  .delay-1 { animation-delay: 0.1s; opacity: 0; }
  .delay-2 { animation-delay: 0.2s; opacity: 0; }
  .delay-3 { animation-delay: 0.3s; opacity: 0; }

  .no-scrollbar::-webkit-scrollbar { display: none; }
  .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }

  /* Minimalist Hover Lines */
  .hover-line {
    position: relative;
    text-decoration: none;
  }
  .hover-line::after {
    content: '';
    position: absolute;
    bottom: -2px;
    left: 0;
    width: 0;
    height: 1px;
    background: black;
    transition: width 0.3s ease;
  }
  .hover-line:hover::after {
    width: 100%;
  }

  .card-hover {
    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .card-hover:hover {
    transform: translateY(-2px);
    box-shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.1);
    border-color: #000;
  }
  
  .loader-dot {
    animation: loader-pulse 1.4s infinite ease-in-out both;
  }
  @keyframes loader-pulse {
    0%, 80%, 100% { transform: scale(0); }
    40% { transform: scale(1); }
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

  const visualSearch = async () => {
    if (!selectedImage) return;
    setIsAnalyzingImage(true);
    setAnalysisStatus("Processing image...");

    try {
      setMessages((prev) => [
        ...prev,
        {
          role: "user",
          content: "Visual Search",
          image: imagePreview,
          isVisualSearch: true,
        },
      ]);

      setAnalysisStatus("Finding matches...");

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

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            data.count > 0
              ? `Found ${data.count} similar products.`
              : "No matches found.",
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
          content: `Visual search failed: ${error.message}.`,
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
    <div className="flex h-screen bg-white text-black overflow-hidden font-sans">
      <style>{customStyles}</style>
      <Sidebar />
      <main className="flex-1 flex flex-col relative h-full">
        {/* Subtle geometric accent */}
        <div className="absolute top-0 right-0 w-[400px] h-[400px] border-l border-b border-gray-100 pointer-events-none" />

        <header className="absolute top-6 right-8 z-20">
          <div className="flex items-center gap-4">
            <p className="text-xs font-bold tracking-widest text-black uppercase">
              Guest
            </p>
            <div className="w-8 h-8 bg-black text-white flex items-center justify-center rounded-sm">
              <span className="text-xs font-bold">G</span>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto no-scrollbar scroll-smooth relative z-10">
          <div className="max-w-4xl mx-auto px-6 lg:px-12 py-12 min-h-full flex flex-col">
            {messages.length === 0 ? (
              <WelcomeScreen
                onSuggestionClick={handleSend}
                onImageUploadClick={() => fileInputRef.current?.click()}
              />
            ) : (
              <div className="space-y-12 pb-48 pt-12">
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
            onAsk={(query) => handleSend(query)}
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

        <div className="absolute bottom-0 left-0 right-0 bg-white/90 backdrop-blur-md border-t border-gray-100 z-30 pb-6 pt-4 px-6">
          <div className="max-w-3xl mx-auto">
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 px-3 py-2 rounded-sm focus-within:border-black focus-within:ring-1 focus-within:ring-black transition-all">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading || isAnalyzingImage}
                className="p-2 text-gray-500 hover:text-black transition-colors disabled:opacity-30 relative group"
                title="Visual Search"
              >
                <Camera className="w-5 h-5" strokeWidth={1.5} />
              </button>
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Ask Omnia..."
                className="flex-1 bg-transparent border-none outline-none text-black placeholder-gray-400 text-sm h-10"
                disabled={isLoading || isAnalyzingImage}
                autoFocus
              />
              <button
                onClick={() => handleSend()}
                disabled={isLoading || !input.trim() || isAnalyzingImage}
                className="p-2 text-black disabled:text-gray-300 transition-colors"
              >
                {isLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin" strokeWidth={1.5} />
                ) : (
                  <Send className="w-5 h-5" strokeWidth={1.5} />
                )}
              </button>
            </div>
            <div className="flex items-center justify-center gap-4 mt-3 text-[10px] font-bold tracking-[0.2em] text-gray-300 uppercase">
              <span>Omnia AI</span>
              <span className="w-1 h-1 bg-gray-200 rounded-full" />
              <span>KW</span>
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
    <aside className="w-20 lg:w-64 bg-white border-r border-gray-100 flex flex-col justify-between py-8 px-4 lg:px-6 hidden md:flex z-40">
      <div>
        <div className="flex items-center gap-3 mb-16 pl-2">
          <div className="w-8 h-8 bg-black text-white flex items-center justify-center rounded-sm">
            <ShoppingBag className="w-4 h-4" strokeWidth={2} />
          </div>
          <span className="hidden lg:block font-bold text-xl text-black tracking-tight">
            Omnia.
          </span>
        </div>
        <nav className="space-y-1">
          <SidebarItem
            icon={<Search className="w-4 h-4" />}
            label="Discover"
            sublabel="Search"
            active
          />
          <SidebarItem
            icon={<LayoutGrid className="w-4 h-4" />}
            label="Categories"
            sublabel="Browse"
          />
          <SidebarItem
            icon={<TrendingUp className="w-4 h-4" />}
            label="Trending"
            sublabel="Popular"
          />
          <SidebarItem
            icon={<History className="w-4 h-4" />}
            label="History"
            sublabel="Recent"
          />
          <SidebarItem
            icon={<Star className="w-4 h-4" />}
            label="Saved"
            sublabel="Favorites"
          />
        </nav>
      </div>
      <div className="hidden lg:block border-t border-gray-100 pt-6">
        <div className="bg-gray-50 p-4 rounded-sm border border-gray-100">
          <p className="text-xs font-bold text-black mb-1">Omnia Pro</p>
          <p className="text-[10px] text-gray-500 mb-3">Advanced analytics</p>
          <button className="text-[10px] font-bold uppercase tracking-wider text-black border-b border-black pb-0.5 hover:opacity-70">
            Upgrade
          </button>
        </div>
      </div>
    </aside>
  );
}

function SidebarItem({ icon, label, sublabel, active }) {
  return (
    <button
      className={`w-full flex items-center gap-4 px-3 py-3 rounded-sm transition-all duration-200 group ${
        active
          ? "bg-black text-white"
          : "text-gray-500 hover:bg-gray-50 hover:text-black"
      }`}
    >
      {icon}
      <div className="hidden lg:block text-left">
        <span className={`block text-sm font-medium`}>{label}</span>
      </div>
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
      desc: "Search by image",
      action: onImageUploadClick,
      highlight: true,
    },
    {
      icon: <Zap className="w-5 h-5" strokeWidth={1.5} />,
      title: "Electronics",
      desc: "Latest gadgets",
      query: "Show me the latest flagship phones",
    },
    {
      icon: <Package className="w-5 h-5" strokeWidth={1.5} />,
      title: "Fashion",
      desc: "Trending styles",
      query: "Trending fashion items under 40 KWD",
    },
  ];

  return (
    <div className="flex flex-col items-center justify-center h-full animate-fade max-w-3xl mx-auto pb-32 pt-20">
      <div className="text-center space-y-4 mb-16">
        <div className="inline-block px-3 py-1 border border-black rounded-full mb-6">
          <span className="text-[10px] font-bold tracking-widest uppercase">
            Omnia AI Assistant
          </span>
        </div>
        <h1 className="text-5xl md:text-6xl text-black font-light tracking-tight animate-rise delay-2">
          {greeting}.
        </h1>
        <p className="text-xl text-gray-400 font-light animate-rise delay-3">
          What can I help you find today?
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full">
        {suggestions.map((card, idx) => (
          <button
            key={idx}
            onClick={() =>
              card.action ? card.action() : onSuggestionClick(card.query)
            }
            className={`group text-left p-6 border transition-all duration-300 card-hover animate-rise bg-white ${
              card.highlight
                ? "border-black"
                : "border-gray-200 hover:border-gray-400"
            }`}
            style={{ animationDelay: `${(idx + 4) * 0.1}s`, opacity: 0 }}
          >
            <div
              className={`w-10 h-10 flex items-center justify-center mb-12 transition-colors ${
                card.highlight
                  ? "bg-black text-white"
                  : "bg-gray-50 text-black group-hover:bg-gray-100"
              }`}
            >
              {card.icon}
            </div>
            <h3 className="text-sm font-bold text-black mb-1 uppercase tracking-wide">
              {card.title}
            </h3>
            <p className="text-xs text-gray-500">{card.desc}</p>
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
        <div className="max-w-[85%]">
          {message.image && (
            <div className="mb-4 border border-gray-200 p-2 bg-white">
              <img
                src={message.image}
                alt="Uploaded"
                className="max-w-full max-h-64 object-contain filter grayscale hover:grayscale-0 transition-all duration-500"
              />
              {message.isVisualSearch && (
                <div className="mt-2 text-[10px] font-bold uppercase tracking-widest text-black flex items-center gap-2 border-t border-gray-100 pt-2">
                  <Scan className="w-3 h-3" /> Visual Search Query
                </div>
              )}
            </div>
          )}
          <div className="bg-black text-white px-5 py-3 text-sm leading-relaxed">
            <p>{message.content}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-6 animate-rise items-start w-full">
      <div className="w-8 h-8 bg-white border border-black flex items-center justify-center flex-shrink-0 text-black">
        <div className="w-2 h-2 bg-black rounded-full" />
      </div>
      <div className="flex-1 space-y-8 overflow-hidden">
        <div className="text-sm text-black leading-relaxed max-w-2xl">
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
          <div className="text-xs text-red-500 font-mono bg-red-50 p-3 border border-red-100 inline-block">
            Error: {message.content}
          </div>
        )}
      </div>
    </div>
  );
}

function ProductCard({ product, index, onClick, showSimilarity = false }) {
  return (
    <button
      onClick={onClick}
      className="group bg-white border border-gray-200 text-left w-full card-hover animate-rise relative overflow-hidden"
      style={{ animationDelay: `${index * 50}ms`, opacity: 0 }}
    >
      <div className="relative aspect-[4/5] bg-gray-50 overflow-hidden">
        <img
          src={product.imageUrl}
          alt={product.title}
          className="w-full h-full object-cover mix-blend-multiply transition-transform duration-700 group-hover:scale-105 filter grayscale group-hover:grayscale-0"
          onError={(e) => (e.target.style.display = "none")}
        />
        <div className="absolute top-0 left-0 bg-white/90 border-b border-r border-gray-100 px-3 py-1.5 z-10">
          <span className="text-[10px] font-bold tracking-widest text-black uppercase">
            {formatStoreName(product.storeName)}
          </span>
        </div>

        {showSimilarity && product.similarity && (
          <div className="absolute top-0 right-0 bg-black text-white px-3 py-1.5 z-10">
            <span className="text-[10px] font-bold tracking-widest uppercase flex items-center gap-1">
              {product.similarity} Match
            </span>
          </div>
        )}
      </div>

      <div className="p-4 border-t border-gray-100">
        <div className="text-[10px] text-gray-400 font-bold uppercase mb-1 tracking-wider">
          {product.brand}
        </div>
        <h3 className="text-sm font-medium text-black line-clamp-2 mb-3 h-10 leading-tight group-hover:underline">
          {product.title}
        </h3>

        <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100 border-dashed">
          <div className="font-light text-lg text-black">
            {parseFloat(product.price).toFixed(3)}
            <span className="text-[10px] text-gray-400 ml-1 font-normal">
              KWD
            </span>
          </div>
          <div className="w-6 h-6 flex items-center justify-center bg-gray-100 text-black group-hover:bg-black group-hover:text-white transition-colors">
            <ChevronRight className="w-3 h-3" />
          </div>
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
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-white/80 backdrop-blur-sm animate-fade">
      <div className="bg-white border border-gray-200 max-w-lg w-full shadow-2xl animate-rise">
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
          <h3 className="text-sm font-bold uppercase tracking-widest text-black flex items-center gap-2">
            <Scan className="w-4 h-4" /> Visual Search
          </h3>
          <button
            onClick={onCancel}
            disabled={isAnalyzing}
            className="text-gray-400 hover:text-black transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6">
          <div className="relative aspect-video w-full bg-gray-50 border border-gray-100 mb-6 flex items-center justify-center overflow-hidden">
            <img
              src={imagePreview}
              alt="Selected"
              className="w-full h-full object-contain filter grayscale"
            />
            {isAnalyzing && (
              <div className="absolute inset-0 bg-white/90 flex items-center justify-center backdrop-blur-[2px]">
                <div className="text-center">
                  <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-black" />
                  <p className="text-xs font-bold uppercase tracking-widest text-black">
                    {analysisStatus}
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <button
              onClick={onAnalyze}
              disabled={isAnalyzing}
              className="flex-1 bg-black text-white py-3 text-xs font-bold uppercase tracking-widest hover:bg-gray-800 transition-colors disabled:opacity-50"
            >
              {isAnalyzing ? "Processing..." : "Search"}
            </button>
            <button
              onClick={onCancel}
              disabled={isAnalyzing}
              className="px-6 py-3 border border-gray-200 text-black text-xs font-bold uppercase tracking-widest hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProductModal({ product, onClose, onAsk }) {
  const [selectedSize, setSelectedSize] = useState("");
  const [isSayMoreActive, setIsSayMoreActive] = useState(false);
  const [sayMoreInput, setSayMoreInput] = useState("");

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "unset";
    };
  }, []);

  const specs = product.specs ? Object.entries(product.specs) : [];

  const handleSayMoreSubmit = (e) => {
    e.preventDefault();
    if (sayMoreInput.trim()) {
      const productContext = {
        title: product.title,
        brand: product.brand,
        category: product.category,
        price: product.price,
        specs: product.specs || {},
      };

      const contextParts = [];
      if (product.brand) contextParts.push(product.brand);

      if (product.category === "MOBILEPHONES") contextParts.push("phone");
      else if (product.category === "LAPTOPS") contextParts.push("laptop");
      else if (product.category === "CLOTHING") contextParts.push("clothing");
      else if (product.category === "FOOTWEAR") contextParts.push("shoes");

      if (product.specs?.model || product.specs?.variant) {
        contextParts.push(product.specs.model || product.specs.variant);
      }

      const contextString = contextParts.join(" ");
      const enhancedQuery = `I'm looking at ${product.title}. ${sayMoreInput}. Show me similar ${contextString} products.`;

      onAsk(enhancedQuery);
      setSayMoreInput("");
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-8 bg-white/50 backdrop-blur-sm animate-fade"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      {/* FIX APPLIED: Changed `max-h-[90vh]` to `h-[90vh]`. 
         This fixed height forces the internal flex areas to calculate available space correctly, 
         ensuring the scrollbar appears and the checkout link stays pinned to the bottom.
      */}
      <div className="bg-white border border-gray-200 max-w-5xl w-full h-[90vh] overflow-hidden flex flex-col md:flex-row shadow-2xl animate-rise">
        {/* Image Section - Adjusted for Mobile/Desktop Split */}
        <div className="w-full h-[40%] md:w-1/2 md:h-full bg-gray-50 relative group flex items-center justify-center p-8 border-b md:border-b-0 md:border-r border-gray-100">
          <img
            src={product.imageUrl}
            alt={product.title}
            className="w-full h-full object-contain mix-blend-multiply filter grayscale hover:grayscale-0 transition-all duration-700"
          />

          {/* Say More Button */}
          <div className="absolute bottom-6 left-6 z-20">
            {!isSayMoreActive ? (
              <button
                onClick={() => setIsSayMoreActive(true)}
                className="bg-white border border-gray-200 px-4 py-2 flex items-center gap-2 shadow-sm hover:shadow-md hover:border-black transition-all"
              >
                <Sparkles className="w-3 h-3 text-black" />
                <span className="text-xs font-bold uppercase tracking-widest text-black">
                  Ask AI
                </span>
              </button>
            ) : (
              <form
                onSubmit={handleSayMoreSubmit}
                className="bg-white border border-black p-1 pl-3 flex items-center gap-2 shadow-lg animate-fade w-72"
              >
                <input
                  autoFocus
                  className="bg-transparent border-none outline-none text-xs text-black flex-1 min-w-0 placeholder-gray-400 font-normal"
                  placeholder="Ask about details, sizing..."
                  value={sayMoreInput}
                  onChange={(e) => setSayMoreInput(e.target.value)}
                  onBlur={() => !sayMoreInput && setIsSayMoreActive(false)}
                />
                <button
                  type="submit"
                  className="p-1.5 bg-black text-white hover:opacity-80"
                >
                  <ChevronRight className="w-3 h-3" />
                </button>
              </form>
            )}
          </div>
        </div>

        {/* Details Section */}
        {/* FIX APPLIED: Using flex-col and explicit heights to manage scrolling area */}
        <div className="w-full h-[60%] md:w-1/2 md:h-full flex flex-col bg-white relative">
          {/* Header (Pinned Top) */}
          <div className="px-8 py-6 border-b border-gray-100 flex justify-between items-start flex-shrink-0">
            <div className="pr-8">
              <span className="inline-block text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400 mb-2">
                {product.brand}
              </span>
              <h2 className="text-xl font-light text-black leading-snug">
                {product.title}
              </h2>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-black"
            >
              <X className="w-6 h-6" strokeWidth={1} />
            </button>
          </div>

          {/* Scrollable Content (Fills Middle) */}
          <div className="flex-1 overflow-y-auto p-8 space-y-8 no-scrollbar">
            <div>
              <div className="flex items-baseline gap-2 mb-2">
                <span className="text-4xl font-light text-black">
                  {parseFloat(product.price).toFixed(3)}
                </span>
                <span className="text-sm text-gray-400">KWD</span>
              </div>
              <p className="text-xs text-green-600 font-medium flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-green-600 rounded-full" /> In
                Stock
              </p>
            </div>

            {/* Size Selector */}
            <div className="space-y-3">
              <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                Select Size
              </label>
              <div className="flex flex-wrap gap-2">
                {["S", "M", "L", "XL"].map((size) => (
                  <button
                    key={size}
                    onClick={() => setSelectedSize(size)}
                    className={`w-10 h-10 border text-sm font-medium transition-colors ${
                      selectedSize === size
                        ? "border-black bg-black text-white"
                        : "border-gray-200 text-gray-600 hover:border-black"
                    }`}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>

            {specs.length > 0 && (
              <div className="pt-6 border-t border-gray-100">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-4">
                  Specifications
                </h3>
                <dl className="grid grid-cols-1 gap-y-3">
                  {specs.map(([k, v], i) => (
                    <div
                      key={i}
                      className="grid grid-cols-3 text-sm border-b border-gray-50 pb-2 last:border-0"
                    >
                      <dt className="text-gray-500 capitalize">
                        {formatSpecKey(k)}
                      </dt>
                      <dd className="col-span-2 text-black font-medium text-right">
                        {formatSpecValue(v)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}

            {product.description && (
              <div className="pt-6 border-t border-gray-100">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">
                  Description
                </h3>
                <p className="text-sm text-gray-600 leading-relaxed">
                  {product.description}
                </p>
              </div>
            )}
          </div>

          {/* Footer (Pinned Bottom) */}
          <div className="p-8 border-t border-gray-100 bg-gray-50 flex-shrink-0">
            <a
              href={product.productUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full bg-black text-white py-4 text-xs font-bold uppercase tracking-[0.15em] flex items-center justify-center gap-3 hover:bg-gray-800 transition-colors"
            >
              Proceed to Checkout <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

function LoadingIndicator() {
  return (
    <div className="flex gap-1 pl-1">
      <div
        className="w-1.5 h-1.5 bg-black rounded-full loader-dot"
        style={{ animationDelay: "0s" }}
      />
      <div
        className="w-1.5 h-1.5 bg-black rounded-full loader-dot"
        style={{ animationDelay: "0.2s" }}
      />
      <div
        className="w-1.5 h-1.5 bg-black rounded-full loader-dot"
        style={{ animationDelay: "0.4s" }}
      />
    </div>
  );
}

function formatStoreName(storeName) {
  const names = {
    XCITE: "Xcite",
    BEST: "Best Al-Yousifi",
    BEST_KW: "Best",
    NOON: "Noon",
    EUREKA: "Eureka",
    DIESEL: "Diesel",
    "H&M": "H&M",
    HM: "H&M",
  };
  return names[storeName] || storeName.replace(/_/g, " ");
}

function formatSpecKey(key) {
  return key.replace(/_/g, " ").toLowerCase();
}

function formatSpecValue(value) {
  return typeof value === "string" ? value : value;
}

export default App;
