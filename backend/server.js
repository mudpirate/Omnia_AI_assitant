import "dotenv/config";
import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";
import { v4 as uuidv4 } from "uuid";

const app = express();
const PORT = process.env.PORT || 4000;
const LLM_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const EMBEDDING_MODEL =
  process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const prisma = new PrismaClient();

// Initialize Redis
// Defaults to localhost:6379 if REDIS_URL is not set
const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ limit: "20mb", extended: true }));

// -------------------- REDIS MEMORY HELPERS --------------------

// Save message to Redis List with 24h Expiry
async function saveToMemory(sessionId, role, content) {
  const key = `chat:${sessionId}`;
  const message = JSON.stringify({ role, content });
  await redis.rpush(key, message);
  await redis.ltrim(key, -20, -1); // Keep last 20 messages only
  await redis.expire(key, 86400); // TTL: 24 hours
}

// Fetch parsed history from Redis
async function getMemory(sessionId) {
  const key = `chat:${sessionId}`;
  const rawHistory = await redis.lrange(key, 0, -1);
  return rawHistory.map((item) => JSON.parse(item));
}

// -------------------- CATEGORY + BRAND CONFIG --------------------
const PRODUCT_CATEGORIES = {
  MOBILE_PHONE: {
    name: "mobile_phone",
    keywords: [
      "phone",
      "mobile",
      "smartphone",
      "android",
      "cellular",
      "5g",
      "mobilephones",
      "cellphone",
      "cell",
    ],
    brands: [
      "samsung",
      "xiaomi",
      "huawei",
      "oppo",
      "vivo",
      "oneplus",
      "realme",
      "nokia",
      "motorola",
      "google",
      "pixel",
      "honor",
      "tecno",
      "infinix",
      "redmi",
      "poco",
      "apple",
      "iphone",
    ],
    specs: ["gb", "ram", "camera", "mp", "mah", "inch", "display", "5g", "4g"],
    exclude: [
      "case",
      "cover",
      "protector",
      "screen guard",
      "glass",
      "charger",
      "cable",
      "holder",
      "stand",
      "adapter",
      "pouch",
      "headphone",
      "earphone",
      "earbuds",
      "EarPods with",
      "watch",
      "band",
      "strap",
    ],
    required: ["phone", "smartphone", "mobile", "galaxy", "pixel", "iphone"],
  },
  LAPTOP: {
    name: "laptop",
    keywords: ["laptop", "notebook", "ultrabook", "macbook", "gaming"],
    brands: [
      "dell",
      "hp",
      "lenovo",
      "asus",
      "acer",
      "msi",
      "razer",
      "apple",
      "microsoft",
      "surface",
    ],
    specs: [
      "intel",
      "amd",
      "ryzen",
      "core",
      "ssd",
      "ram",
      "nvidia",
      "rtx",
      "gtx",
    ],
    exclude: [
      "bag",
      "case",
      "sleeve",
      "charger",
      "adapter",
      "mouse",
      "keyboard",
      "stand",
      "sticker",
    ],
    required: [
      "laptop",
      "notebook",
      "macbook",
      "workstation",
      "convertible",
      "matebook",
      "surface",
    ],
  },
  HEADPHONE: {
    name: "headphone",
    keywords: ["headphone", "headphones", "headset", "over-ear"],
    brands: [
      "sony",
      "bose",
      "jbl",
      "sennheiser",
      "beats",
      "anker",
      "logitech",
      "hyperx",
      "razer",
    ],
    specs: ["wireless", "bluetooth", "noise cancelling", "anc", "mic"],
    exclude: [
      "case only",
      "pouch",
      "stand",
      "cable",
      "earbuds",
      "earpods",
      "in-ear",
    ],
    required: ["headphone", "headphones", "headset", "over-ear"],
  },
  EARPHONE: {
    name: "earphone",
    keywords: ["earphone", "earphones", "earbuds", "airpods", "tws", "buds"],
    brands: ["apple", "samsung", "sony", "jbl", "anker", "xiaomi", "huawei"],
    specs: ["wireless", "bluetooth", "tws", "anc", "noise cancelling"],
    exclude: [
      "case",
      "cover",
      "protector",
      "strap",
      "headphone",
      "headset",
      "over-ear",
    ],
    required: ["earphone", "earbuds", "earpods", "airpods", "tws", "buds"],
  },
  DESKTOP: {
    name: "desktop",
    keywords: ["desktop", "pc", "computer", "tower", "all-in-one", "aio"],
    brands: ["dell", "hp", "lenovo", "asus", "acer", "msi", "apple", "imac"],
    specs: ["intel", "amd", "ryzen", "rtx", "gtx"],
    exclude: ["monitor", "keyboard", "mouse", "speaker", "cable"],
    required: [
      "desktop",
      "pc",
      "computer",
      "tower",
      "all-in-one",
      "imac",
      "mac mini",
    ],
  },
  TABLET: {
    name: "tablet",
    keywords: ["tablet", "ipad", "tab"],
    brands: ["apple", "samsung", "lenovo", "huawei", "xiaomi"],
    specs: ["inch", "display", "wifi", "lte", "cellular"],
    exclude: ["case", "cover", "screen", "keyboard", "pen", "stylus"],
    required: ["tablet", "ipad", "tab", "pad"],
  },
};

const STORE_NAMES = [
  "xcite",
  "best.kw",
  "best",
  "noon.kw",
  "noon",
  "jarir",
  "eureka",
];

const APPLE_TERMS = [
  "iphone",
  "apple",
  "ios",
  "macbook",
  "ipad",
  "mac",
  "airpods",
];
const ANDROID_TERMS = [
  "samsung",
  "huawei",
  "xiaomi",
  "android",
  "galaxy",
  "pixel",
  "oppo",
  "vivo",
  "honor",
  "redmi",
  "realme",
  "oneplus",
  "tecno",
  "infinix",
];

// -------------------- LOGIC HELPERS --------------------

// 1. MEMORY: Query Rewriter
async function generateStandaloneQuery(userMessage, history) {
  if (!history || history.length === 0) return userMessage;

  const recentHistory = history.slice(-1); // Only look at last 2 messages

  const conversationText = recentHistory
    .map((msg) => `${msg.role === "user" ? "User" : "AI"}: ${msg.content}`)
    .join("\n");

  const systemPrompt = `
    You are a Query Refiner.
    Your job is to decide if the "Latest User Message" is a FOLLOW-UP or a NEW TOPIC.

    1. **IF FOLLOW-UP:** Merge it with the history.
    2. **IF NEW TOPIC:** Ignore history and use the user message.
    3. **NO MARKDOWN:** Do NOT use bold (**), italics, or quotes. Output clean plain text only.

    **OUTPUT:**
    Return ONLY the final search query.
  `;

  try {
    const response = await openai.chat.completions.create({
      model: LLM_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `CHAT HISTORY:\n${conversationText}\n\nLATEST USER MESSAGE: "${userMessage}"`,
        },
      ],
      temperature: 0.0,
    });

    let rewritten = response.choices[0].message.content.trim();

    // Sanitize Output
    rewritten = rewritten
      .replace(/\*\*/g, "")
      .replace(/__/g, "")
      .replace(/^"|"$/g, "");

    return rewritten || userMessage;
  } catch (error) {
    console.error("Query Rewriter Failed:", error);
    return userMessage;
  }
}

// -------------------- HELPER: Get Vector Embedding --------------------
async function getQueryEmbedding(text) {
  const embeddingRes = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  });
  const embedding = embeddingRes.data[0]?.embedding;
  if (!embedding) throw new Error("Failed to generate embedding");
  const vectorLiteral =
    "[" + embedding.map((x) => Number(x).toFixed(6)).join(",") + "]";
  return { embedding, vectorLiteral };
}

// -------------------- 2. WEB SEARCH (VECTOR CACHED) --------------------
async function searchWeb(query) {
  console.log(`[Web Search] Processing: "${query}"...`);

  try {
    // A. Generate Embedding for the Search Query
    const { vectorLiteral } = await getQueryEmbedding(query);

    // B. Check Vector Cache (Prisma/Postgres)
    const closestMatch = await prisma.$queryRawUnsafe(`
      SELECT response, 1 - (embedding <=> '${vectorLiteral}'::vector) as similarity
      FROM "WebSearchCache"
      ORDER BY similarity DESC
      LIMIT 1;
    `);

    if (closestMatch.length > 0) {
      console.log(
        `[Cache Inspection] Closest match similarity: ${closestMatch[0].similarity.toFixed(
          4
        )}`
      );
    }

    const SIMILARITY_THRESHOLD = 0.72;

    if (
      closestMatch.length > 0 &&
      closestMatch[0].similarity > SIMILARITY_THRESHOLD
    ) {
      console.log(`[Web Search] ⚡ VECTOR CACHE HIT`);
      return closestMatch[0].response;
    }

    // C. Cache Miss -> Call Serper API
    console.log(`[Web Search] 🌐 CACHE MISS. Calling Serper.dev...`);

    const myHeaders = new Headers();
    myHeaders.append("X-API-KEY", process.env.SERPER_API_KEY);
    myHeaders.append("Content-Type", "application/json");

    const response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: myHeaders,
      body: JSON.stringify({ q: query, gl: "kw", hl: "en" }),
    });

    if (!response.ok) {
      console.error("[Web Search] API Error:", response.statusText);
      return null;
    }

    const data = await response.json();

    // D. Save to Vector Cache (if valid data)
    if (data && data.organic && data.organic.length > 0) {
      await prisma.$executeRawUnsafe(
        `
      INSERT INTO "WebSearchCache" (id, query, response, "embedding", "createdAt")
      VALUES (
        gen_random_uuid(), 
        $1, 
        $2::jsonb, 
        '${vectorLiteral}'::vector, 
        NOW()
      )
    `,
        query,
        JSON.stringify(data)
      );

      console.log(`[Web Search] 💾 Saved to Vector Cache`);
    }

    return data;
  } catch (error) {
    console.error("[Web Search] Error:", error);
    return null;
  }
}

// 3. WEB SYNTHESIZER
async function synthesizeTrendReport(serperResponse, userQuery) {
  if (
    !serperResponse ||
    !serperResponse.organic ||
    serperResponse.organic.length === 0
  ) {
    return "I couldn't find any recent information on that topic from the web right now.";
  }

  const topResults = serperResponse.organic.slice(0, 5);
  const context = topResults
    .map((item) => `SOURCE: ${item.title}\nSNIPPET: ${item.snippet}`)
    .join("\n\n");

  console.log("[Web Search] Synthesizing summary...");

  const completion = await openai.chat.completions.create({
    model: LLM_MODEL,
    messages: [
      {
        role: "system",
        content: `You are Omnia AI, a helpful shopping assistant. 
        The user asked a question that required a live web search (e.g., trends, news, or general advice).
        I will provide you with search snippets.
        
        Your Job:
        1. Synthesize these snippets into a friendly, helpful paragraph answering the user.
        2. Mention specific product names found in the snippets if relevant.
        3. Do NOT output JSON. Output plain text.
        4. **NO MARKDOWN:** Do NOT use bold (**), italics, or quotes. Output clean plain text only.
        5. Ask a follow up questions like buying , any other product you want to talk about.`,
      },
      {
        role: "user",
        content: `USER QUESTION: "${userQuery}"\n\nSEARCH RESULTS:\n${context}`,
      },
    ],
    max_completion_tokens: 200,
    temperature: 0.7,
  });

  return completion.choices[0].message.content;
}

// -------------------- EXISTING EXTRACTION HELPERS --------------------
function extractStoreName(userMessage) {
  const msg = userMessage.toLowerCase();

  // 1. Check for unambiguous store names first
  if (msg.includes("noon")) return "noon.kw";
  if (msg.includes("xcite")) return "xcite";
  if (msg.includes("jarir")) return "jarir";
  if (msg.includes("eureka")) return "eureka";

  // 2. Handle "Best" carefully
  if (msg.includes("best.kw") || msg.includes("best al-yousifi"))
    return "best.kw";

  // 3. Handle "from [store]" pattern
  const fromMatch = msg.match(/from\s+(\w+)/i);
  if (fromMatch) {
    const store = fromMatch[1];
    if (store === "noon") return "noon.kw";
    if (store === "eureka") return "eureka";
    if (store === "xcite") return "xcite";
    if (store === "jarir") return "jarir";
    // Only accept "best" if it follows the word "from"
    if (store === "best") return "best.kw";
  }

  // 4. Check for "best store" or "best shop" specifically
  if (/\bbest\s+(store|shop)\b/.test(msg)) return "best.kw";

  return null;
}

function extractPriceRange(userMessage) {
  const msg = userMessage.toLowerCase();
  const underMatch = msg.match(
    /(?:under|below|less than|max|maximum)\s*(\d+)/i
  );
  if (underMatch) return { max: parseFloat(underMatch[1]), min: 0 };
  const rangeMatch = msg.match(
    /(?:between|from)\s*(\d+)\s*(?:and|to)\s*(\d+)/i
  );
  if (rangeMatch)
    return { min: parseFloat(rangeMatch[1]), max: parseFloat(rangeMatch[2]) };
  const aboveMatch = msg.match(/(?:above|over|more than|min|minimum)\s*(\d+)/i);
  if (aboveMatch) return { min: parseFloat(aboveMatch[1]), max: Infinity };
  const priceMatch = msg.match(/(\d+)\s*(?:kwd|dinar|kd)/i);
  if (priceMatch) return { max: parseFloat(priceMatch[1]), min: 0 };
  return null;
}

function detectProductCategory(userMessage) {
  const msg = userMessage.toLowerCase().trim();
  const forcePatterns = {
    mobile_phone:
      /\b(android|smartphone|smart phone|cell phone|mobile phone|iphone|galaxy phone|phone)\b/i,
    laptop: /\b(laptop|notebook|macbook|chromebook|ultrabook)\b/i,
    desktop: /\b(desktop|desktop pc|gaming pc|tower pc|all-in-one pc)\b/i,
    headphone: /\b(headphone|headphones|headset|over-ear|on-ear)\b/i,
    earphone:
      /\b(earphone|earphones|earbuds|airpods|earpods|tws|wireless earbuds)\b/i,
    tablet: /\b(tablet|ipad|galaxy tab)\b/i,
  };
  for (const [category, pattern] of Object.entries(forcePatterns)) {
    if (pattern.test(msg)) return category;
  }
  let categoryScores = {};
  Object.values(PRODUCT_CATEGORIES).forEach((category) => {
    categoryScores[category.name] = 0;
    category.keywords.forEach((keyword) => {
      if (msg.includes(keyword)) categoryScores[category.name] += 10;
    });
    category.brands.forEach((brand) => {
      if (msg.includes(brand)) categoryScores[category.name] += 5;
    });
  });
  const detectedCategory = Object.entries(categoryScores).reduce(
    (max, [cat, score]) => (score > max.score ? { category: cat, score } : max),
    { category: null, score: 0 }
  );
  return detectedCategory.score > 0 ? detectedCategory.category : null;
}

async function classifyIntent(query) {
  const systemPrompt = `
You are an intent-classification engine for an electronics ecommerce store.

Your job:  
Given the user query, classify it into EXACTLY one of the following labels:

========================================
🔵 LOW INTENT
========================================
The user is *browsing*, *exploring*, *comparing between two phones* or *asking vague/general questions*.

Examples:
- "best phones"
- "best phones in 2025/24/23"
- "best laptops/tablet/headphones in 2025/24/23"
- "what's new?"
- "trending phones"
- "show me popular items"
- "good camera phone"
- "compare between two phones for example apple iphone 17 vs apple iphone 16 "
- "compare Samsung and Apple phones"
- "is shipping free?"
- "how are your returns?"
- "do you deliver to Kuwait?"
- "store timings?"  
→ KEY: general, non-specific, window-shopping, policy questions.

========================================
🟠 MEDIUM INTENT
========================================
The user has a *clear need* but not a specific product. Usually includes:
- price ranges
- categories
- brands
- features  

Examples:
- "laptops under 300 kwd"
- "phones under 150"
- "Samsung phones"
- "Apple laptops"
- "gaming laptop with RTX"
→ KEY: direction is clear but no precise single product.

========================================
🔴 HIGH INTENT
========================================
The user is *ready to buy* or refers to **specific models/specs**.

Examples:
- "iPhone 15 Pro Max"
- "Galaxy S24 Ultra"
- "buy iphone 15 pro"
- "order macbook m3"
- "where can I buy s24 ultra?"

→ KEY: highly targeted, actionable, usually one or two exact products.

========================================
RULES:
- Output ONLY: LOW, MEDIUM, or HIGH
- "Best [Product]" or "Cheapest [Product]" is ALWAYS MEDIUM or HIGH. Never LOW.
- If query mentions a **specific model name** → ALWAYS HIGH
- If ambiguous between MEDIUM and LOW → choose MEDIUM
- If ambiguous between HIGH and MEDIUM → choose HIGH

========================================
OUTPUT FORMAT:
Only return the label: LOW / MEDIUM / HIGH.
`;

  try {
    const response = await openai.chat.completions.create({
      model: LLM_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: query },
      ],
      temperature: 0,
      max_tokens: 5,
    });

    let intent = response.choices[0].message.content.trim().toUpperCase();
    intent = intent.replace(/[^A-Z]/g, ""); // cleanup

    return ["LOW", "MEDIUM", "HIGH"].includes(intent) ? intent : "LOW";
  } catch (e) {
    console.error("Intent Classifier Error:", e);
    return "LOW";
  }
}

// -------------------- DB SEARCH (PRODUCT CATALOG) --------------------
async function executeEmbeddingSearch(vectorLiteral, maxResults) {
  try {
    console.log(`[Embedding Search] Fetching top ${maxResults} products...`);
    const query = `
      SELECT
        "title", "price", "storeName", "productUrl", "category",
        "imageUrl", "stock", "description"
      FROM "Product"
      WHERE "descriptionEmbedding" IS NOT NULL
      ORDER BY "descriptionEmbedding" <#> '${vectorLiteral}'::vector ASC
      LIMIT ${maxResults};
    `;
    const results = await prisma.$queryRawUnsafe(query);
    console.log(`[Embedding Search] Found: ${results.length} products`);
    return results;
  } catch (err) {
    console.error("Embedding DB Search Error:", err);
    return [];
  }
}

// Extract multiple models from query
function extractMultipleModels(userMessage) {
  const msg = userMessage.toLowerCase();

  // Pattern for different phone brands
  const patterns = [
    // iPhone pattern
    /\biphone\s*(\d+)(\s*pro)?(\s*max)?(\s*plus)?/gi,
    // Samsung Galaxy pattern (includes s-series)
    /\b(?:samsung\s*)?galaxy\s*s(\d+)(\s*ultra)?(\s*plus)?/gi,
    /\bs(\d+)(\s*ultra)?(\s*plus)?/gi,
    // Google Pixel
    /\bpixel\s*(\d+)(\s*pro)?(\s*xl)?/gi,
    // MacBook
    /\bmacbook\s*(air|pro)?(\s*m\d+)?/gi,
  ];

  let allMatches = [];

  patterns.forEach((pattern) => {
    const matches = msg.match(pattern);
    if (matches) {
      allMatches.push(...matches);
    }
  });

  if (allMatches.length === 0) return null;

  // Clean and normalize matches
  const normalizedMatches = allMatches.map((m) => {
    let normalized = m.toLowerCase().trim();
    // Add "galaxy" prefix if it's just "s24 ultra" format
    if (/^s\d+/.test(normalized) && !normalized.includes("galaxy")) {
      normalized = "galaxy " + normalized;
    }
    return normalized;
  });

  // Return unique models
  return [...new Set(normalizedMatches)];
}

// -------------------- FILTER + RANK (NEW LOGIC) --------------------
function filterAndRankProducts(
  products,
  userQuery,
  productCount,
  category,
  priceRange = null,
  storeName = null
) {
  const query = userQuery.toLowerCase();

  // --- NEW: Detect Sorting Intents ---
  const isBestQuery = /best|top|premium|expensive|flagship|high end/i.test(
    query
  );
  const isCheapestQuery = /cheapest|cheap|lowest price|budget/i.test(query);
  const isBudgetRange = priceRange && priceRange.max !== Infinity;

  const queryWords = query.split(/\s+/).filter((w) => w.length > 2);

  const modelNumberMatch = query.match(
    /\b(iphone|galaxy|pixel|macbook)\s*(\d+)(\s*pro)?(\s*max)?(\s*plus)?(\s*ultra)?/i
  );
  const requestedModel = modelNumberMatch
    ? modelNumberMatch[0].toLowerCase()
    : null;

  const categoryConfig = category
    ? Object.values(PRODUCT_CATEGORIES).find((c) => c.name === category)
    : null;
  const isAppleQuery = APPLE_TERMS.some((t) => query.includes(t));
  const isAndroidQuery = ANDROID_TERMS.some((t) => query.includes(t));

  // --- STEP 1: HARD FILTERING ---
  let filteredProducts = products.filter((product) => {
    const title = (product.title || "").toLowerCase();
    if (!product.title || product.price == null) return false;

    // Stock Check
    if (
      product.stock &&
      /out[_\s-]*of[_\s-]*stock/i.test(String(product.stock))
    )
      return false;

    // Price Check
    if (
      priceRange &&
      (product.price < priceRange.min || product.price > priceRange.max)
    )
      return false;

    // Store Check
    if (
      storeName &&
      !(product.storeName || "").toLowerCase().includes(storeName.toLowerCase())
    )
      return false;

    // Category Exclusion
    if (categoryConfig) {
      const isAccessory = categoryConfig.exclude.some((term) =>
        title.includes(term.toLowerCase())
      );
      if (isAccessory) return false;
    }
    return true;
  });

  // --- STEP 2: SCORING ---
  const scoredProducts = filteredProducts.map((product) => {
    let score = 0;
    const title = (product.title || "").toLowerCase();
    const categoryField = (product.category || "").toLowerCase();

    // Scoring Logic
    if (requestedModel) {
      const productModelMatch = title.match(
        /\b(iphone|galaxy|pixel|macbook)\s*(\d+)(\s*pro)?(\s*max)?(\s*plus)?(\s*ultra)?/i
      );
      if (productModelMatch) {
        const productModel = productModelMatch[0].toLowerCase();
        if (productModel === requestedModel) score += 500;
        else {
          const requestedNum = requestedModel.match(/\d+/)?.[0];
          const productNum = productModel.match(/\d+/)?.[0];
          if (requestedNum !== productNum) score -= 300;
        }
      }
    }

    if (category) {
      if (categoryField.includes(category.split("_")[0])) score += 40;
      if (categoryConfig) {
        categoryConfig.required.forEach((term) => {
          if (title.includes(term)) score += 20;
        });
      }
    }

    queryWords.forEach((word) => {
      if (title.includes(word)) score += 50;
    });

    if (isAppleQuery && APPLE_TERMS.some((t) => title.includes(t))) score += 80;
    if (isAndroidQuery && ANDROID_TERMS.some((t) => title.includes(t)))
      score += 80;

    if (!requestedModel && (title.includes("2024") || title.includes("2025")))
      score += 20;

    // Base score for relevance, specific sorting happens below
    score += Math.log(product.price + 1) * 2;

    return { ...product, score };
  });

  // --- STEP 3: SORTING (Implemented Rules) ---
  scoredProducts.sort((a, b) => {
    // Rule 1: Specific Model Match (Always Top Priority)
    if (requestedModel) {
      return b.score - a.score;
    }

    // Rule 2: "Best" / "Top" -> Descending Price (Higher specs/price)
    if (isBestQuery) {
      return b.price - a.price;
    }

    // Rule 3: Budget Range (e.g., "Under 400") -> Descending Price (399 down to 0)
    if (isBudgetRange) {
      return b.price - a.price;
    }

    // Rule 4: "Cheapest" -> Ascending Price
    if (isCheapestQuery) {
      return a.price - b.price;
    }

    // Default: Sort by Score (Relevance)
    return b.score - a.score;
  });

  // --- STEP 4: BALANCED SELECTION ---
  let selectedProducts = [];
  if (storeName) {
    selectedProducts = scoredProducts.slice(0, productCount);
  } else {
    const storeCount = {
      xcite: 0,
      "best.kw": 0,
      eureka: 0,
      jarir: 0,
      "noon.kw": 0,
    };

    const maxPerStore = Math.ceil(productCount / 5);

    for (const product of scoredProducts) {
      const pStore = product.storeName ? product.storeName.toLowerCase() : "";
      let storeKey = null;

      if (pStore.includes("xcite")) storeKey = "xcite";
      else if (pStore.includes("jarir")) storeKey = "jarir";
      else if (pStore.includes("best")) storeKey = "best.kw";
      else if (pStore.includes("noon")) storeKey = "noon.kw";
      else if (pStore.includes("eureka")) storeKey = "eureka";

      if (
        storeKey &&
        storeCount[storeKey] < maxPerStore &&
        selectedProducts.length < productCount
      ) {
        selectedProducts.push(product);
        storeCount[storeKey]++;
      }
    }

    for (const product of scoredProducts) {
      if (
        !selectedProducts.includes(product) &&
        selectedProducts.length < productCount
      ) {
        selectedProducts.push(product);
      }
    }
  }

  // Final re-sort of selected list to respect price
  if (isBestQuery || isBudgetRange) {
    selectedProducts.sort((a, b) => b.price - a.price);
  } else if (isCheapestQuery) {
    selectedProducts.sort((a, b) => a.price - b.price);
  }

  return selectedProducts;
}

// -------------------- LOW-INTENT KEYWORD → DB HELPERS (NEW) --------------------
function buildSerperKeywordContext(serperResponse) {
  if (!serperResponse || !serperResponse.organic) return "";
  try {
    return serperResponse.organic
      .slice(0, 6)
      .map((item, idx) => {
        const title = item.title || "";
        const snippet = item.snippet || "";
        return `Result ${idx + 1}: ${title} - ${snippet}`;
      })
      .join("\n");
  } catch (e) {
    console.error("[Keyword Context Builder] Error:", e);
    return "";
  }
}

async function extractProductKeywordsFromWeb(
  serperTextContext,
  webSummary,
  userQuery,
  detectedCategory
) {
  const systemPrompt = `
You are a keyword extractor for an electronics shopping assistant.

Goal:
Given the user query, a short web-summary paragraph and search result titles/snippets,
identify up to 6 highly relevant product search keywords.

Prefer:
- Specific model names (e.g. iPhone 16 Pro Max, Galaxy S24 Ultra, Pixel 9 Pro)
- Brand + series/family names (e.g. Samsung Galaxy A55, Redmi Note 13, Realme 12 Pro)
- If concrete models are not clear, return the most relevant brands for that category.

Rules:
- Only include actual devices: phones, laptops, headphones, earphones, tablets, desktops.
- Do NOT include accessories (case, cover, charger, cable, screen protector, etc.).
- Do NOT include generic words like: best, trending, popular, review, specs, feature, price.
- Each keyword should be 1–5 words long.
- Return between 1 and 6 keywords. If nothing is clear, return an empty list.

Output strict JSON only:
{
  "keywords": ["...", "..."]
}
No markdown, no comments, no extra keys.
`;

  const userContent = `
USER_QUERY:
${userQuery}

CATEGORY_HINT:
${detectedCategory || "unknown"}

WEB_SUMMARY:
${webSummary || ""}

SEARCH_RESULTS_TEXT:
${serperTextContext || ""}
`;

  try {
    const completion = await openai.chat.completions.create({
      model: LLM_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      temperature: 0.2,
      response_format: { type: "json_object" },
    });

    const raw = completion.choices[0].message.content || "{}";
    const parsed = JSON.parse(raw);
    const keywords = Array.isArray(parsed.keywords) ? parsed.keywords : [];

    return keywords
      .map((k) => String(k).trim())
      .filter((k) => k.length > 0)
      .slice(0, 6);
  } catch (e) {
    console.error("[Keyword Extractor] Error:", e);
    return [];
  }
}

// -------------------- MAIN CHAT ROUTE --------------------
app.post("/chat", async (req, res) => {
  let { query: message, sessionId } = req.body;

  if (!message) return res.status(400).json({ error: "Message is required." });

  if (!sessionId) {
    sessionId = uuidv4();
    console.log(`[New Session] Created: ${sessionId}`);
  }

  try {
    const history = await getMemory(sessionId);
    const standaloneQuery = await generateStandaloneQuery(message, history);

    const detectedCategory = detectProductCategory(standaloneQuery);
    const intent = await classifyIntent(standaloneQuery);
    const priceRange = extractPriceRange(standaloneQuery);
    const storeName = extractStoreName(standaloneQuery);

    console.log(
      `[Chat] Session: ${sessionId} | Intent: ${intent}, Category: ${detectedCategory}, Store: ${storeName}`
    );

    let finalResponsePayload = {};

    // --- BRANCH 1: LOW INTENT / WEB SEARCH ---
    if (intent === "LOW") {
      const isGreeting = /^(hi|hy|hello|hey|greetings|morning|afternoon)/i.test(
        message.trim()
      );

      if (!isGreeting) {
        console.log(
          `[Low Intent] Detected knowledge query. Triggering Web Search...`
        );
        const serperData = await searchWeb(standaloneQuery);
        const webSummary = await synthesizeTrendReport(
          serperData,
          standaloneQuery
        );

        finalResponsePayload = {
          reply: webSummary,
          products: [],
          intent: "WEB_SEARCH",
          category: detectedCategory,
        };

        // NEW FEATURE: Use web search to drive product recommendations from DB
        try {
          if (
            serperData &&
            serperData.organic &&
            serperData.organic.length > 0
          ) {
            const serperTextContext = buildSerperKeywordContext(serperData);

            const productKeywords = await extractProductKeywordsFromWeb(
              serperTextContext,
              webSummary,
              standaloneQuery,
              detectedCategory
            );

            console.log(
              "[Low Intent] Extracted product keywords from web:",
              productKeywords
            );

            if (productKeywords && productKeywords.length > 0) {
              const keywordSearchQuery = productKeywords.join(" ");

              const { vectorLiteral } = await getQueryEmbedding(
                keywordSearchQuery
              );

              // Fetch from DB using embeddings
              const dbProducts = await executeEmbeddingSearch(
                vectorLiteral,
                80
              );

              if (dbProducts && dbProducts.length > 0) {
                // Reuse ranking logic with category / price / store hints if present
                const suggestedProducts = filterAndRankProducts(
                  dbProducts,
                  keywordSearchQuery || standaloneQuery,
                  6, // show up to 6 products for low-intent web search
                  detectedCategory,
                  priceRange,
                  storeName
                );

                if (suggestedProducts && suggestedProducts.length > 0) {
                  const lowIntentProductsPayload = suggestedProducts.map(
                    (p) => ({
                      product_name: p.title,
                      store_name: p.storeName,
                      price_kwd: p.price,
                      product_url: p.productUrl,
                      image_url: p.imageUrl,
                      product_description: p.description || p.title,
                    })
                  );

                  // Override payload to ALSO return products from DB
                  finalResponsePayload = {
                    reply: webSummary,
                    products: lowIntentProductsPayload,
                    intent: "WEB_SEARCH",
                    category: detectedCategory,
                    priceRange,
                    storeName,
                  };
                }
              }
            }
          }
        } catch (e) {
          console.error("[Low Intent] Web→DB keyword product flow failed:", e);
        }
      } else {
        const lowIntentSystem = `
        You are Omnia AI, a friendly shopping assistant for Kuwait electronics.
        Reply in a warm, human tone (2–3 short sentences).
        Do NOT use markdown (NO **bold**, NO *italics*).
        Ask 1–2 smart follow-up questions about category, budget, or brand.
        Return JSON: { "message": "Your text here", "intent_level": "LOW", "products": [] }
      `;

        const lowResponse = await openai.chat.completions.create({
          model: LLM_MODEL,
          messages: [
            { role: "system", content: lowIntentSystem },
            ...history.map((m) => ({ role: m.role, content: m.content })),
            { role: "user", content: standaloneQuery },
          ],
          temperature: 0.7,
          response_format: { type: "json_object" },
        });

        const content = JSON.parse(
          lowResponse.choices[0].message.content || "{}"
        );
        finalResponsePayload = {
          reply: content.message || "How can I help you today?",
          products: [],
          intent: "LOW",
          category: detectedCategory,
        };
      }
    }
    // --- BRANCH 2: MEDIUM / HIGH INTENT ---
    else {
      let searchQuery = standaloneQuery;

      const multipleModels = extractMultipleModels(message);
      const modelMatch = message.match(
        /\b(iphone|galaxy|pixel|macbook)\s*(\d+)(\s*pro)?(\s*max)?/i
      );

      if (modelMatch) {
        searchQuery = `${modelMatch[0]} ${message}`;
      }

      const { vectorLiteral } = await getQueryEmbedding(searchQuery);

      const fetchCount = multipleModels && multipleModels.length > 1 ? 110 : 90;
      const dbProducts = await executeEmbeddingSearch(
        vectorLiteral,
        fetchCount
      );

      // CONFIG: Product Counts
      const productCount = intent === "MEDIUM" ? 6 : 10;

      if (!dbProducts || dbProducts.length === 0) {
        finalResponsePayload = {
          reply:
            "I couldn't find any products matching that description. Could you try adjusting your search?",
          products: [],
          intent,
        };
      } else {
        let filteredProducts = filterAndRankProducts(
          dbProducts,
          searchQuery,
          productCount,
          detectedCategory,
          priceRange,
          storeName
        );

        if (multipleModels && multipleModels.length > 1) {
          console.log(
            `[Multiple Models Detected]: ${multipleModels.join(", ")}`
          );

          let combinedResults = [];
          const productsPerModel = Math.ceil(
            productCount / multipleModels.length
          );

          multipleModels.forEach((requestedModel) => {
            const searchTerms = requestedModel.split(/\s+/);

            const modelProducts = dbProducts.filter((p) => {
              const title = (p.title || "").toLowerCase();
              const allTermsMatch = searchTerms.every((term) =>
                title.includes(term)
              );

              if (allTermsMatch) return true;

              if (requestedModel.includes("galaxy")) {
                const modelNum = requestedModel.match(/s\d+/i)?.[0];
                if (modelNum && title.includes(modelNum)) {
                  if (
                    requestedModel.includes("ultra") &&
                    title.includes("ultra")
                  )
                    return true;
                  if (requestedModel.includes("plus") && title.includes("plus"))
                    return true;
                  if (
                    !requestedModel.includes("ultra") &&
                    !requestedModel.includes("plus") &&
                    !title.includes("ultra") &&
                    !title.includes("plus")
                  )
                    return true;
                }
              }
              return false;
            });

            combinedResults.push(...modelProducts.slice(0, productsPerModel));
          });

          filteredProducts = combinedResults.slice(0, productCount);
        } else if (modelMatch) {
          const requestedModelName = modelMatch[0].toLowerCase();
          filteredProducts = filteredProducts.filter((p) => {
            const title = (p.title || "").toLowerCase();
            return title.includes(requestedModelName);
          });
          filteredProducts = filteredProducts.slice(0, 3);
        }

        if (filteredProducts.length === 0) {
          finalResponsePayload = {
            reply:
              "I couldn't find any products matching that exact specification. Would you like me to show you similar alternatives?",
            products: [],
            intent,
          };
        } else {
          const categoryName = detectedCategory
            ? detectedCategory.replace("_", " ")
            : "products";

          const finalSystemPrompt = `
            You are Omnia AI, a smart shopping assistant for Kuwait (electronics only).
          
            **USER QUERY**: "${searchQuery}"
            **PRODUCTS**: ${
              filteredProducts.length
            } pre-filtered ${categoryName} (All In Stock)
            ${
              multipleModels && multipleModels.length > 1
                ? `**MULTIPLE MODELS REQUESTED**: ${multipleModels.join(", ")}`
                : ""
            }
          
            **CRITICAL DATA INTEGRITY RULES**:
            1. You must **ONLY** return products listed in the 'Input Data' section below.
            2. **Do NOT invent**, hallucinate, or 'fill in' products that are not in the input list.
            3. Ensure 'image_url' and 'product_url' are copied **exactly** from the input data. Do not generate fake URLs.
            4. **OUTPUT ALL PRODUCTS**: You must output every single product provided in the input data. Do not summarize or skip items.
            ${
              multipleModels && multipleModels.length > 1
                ? "6. If multiple models were requested but only some are available, acknowledge which ones you found."
                : ""
            }
          
            **CONTENT GENERATION**:
            For each product:
            - "product_description": Write a detailed 2 line paragraph highlighting the technical specifications.
            - Use the provided 'db_description' as your primary source.
            
            Output JSON Structure:
            {
              "message": "Friendly intro matching user intent${
                multipleModels && multipleModels.length > 1
                  ? " (mention which models are available)"
                  : ""
              }",
              "intent_level": "${intent}",
              "products": [ 
                { 
                  "product_name": "title", 
                  "store_name": "store", 
                  "price_kwd": number, 
                  "product_url": "url", 
                  "image_url": "url", 
                  "product_description": "Detailed specs..." 
                } 
              ],
              "outro" : "An outro message after showing products about more products buying or exploration"
            }
          
            Input Data: ${JSON.stringify(
              filteredProducts.map((p) => ({
                title: p.title,
                price: p.price,
                storeName: p.storeName,
                productUrl: p.productUrl,
                imageUrl: p.imageUrl,
                db_description: p.description || "",
              }))
            )}
          `;
          const finalResponse = await openai.chat.completions.create({
            model: LLM_MODEL,
            messages: [{ role: "system", content: finalSystemPrompt }],
            temperature: 0.5,
            response_format: { type: "json_object" },
          });

          const finalContent = finalResponse.choices[0].message.content || "{}";
          let parsedData;

          try {
            parsedData = JSON.parse(finalContent);
          } catch (e) {
            console.error("JSON Parsing failed", e);
            parsedData = {
              message: "Here are the best matches I found.",
              intent_level: intent,
              products: filteredProducts.map((p) => ({
                product_name: p.title,
                store_name: p.storeName,
                price_kwd: p.price,
                product_url: p.productUrl,
                image_url: p.imageUrl,
                product_description: p.title,
              })),
            };
          }

          finalResponsePayload = {
            reply: parsedData.message,
            products: parsedData.products,
            intent,
            category: detectedCategory,
            priceRange,
            storeName,
            outro: parsedData.outro,
          };
        }
      }
    }

    await saveToMemory(sessionId, "user", message);
    await saveToMemory(sessionId, "assistant", finalResponsePayload.reply);

    return res.json({
      ...finalResponsePayload,
      sessionId,
      history: [
        ...history.map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content: message },
        { role: "assistant", content: finalResponsePayload.reply },
      ],
    });
  } catch (error) {
    console.error("Chat Error:", error);
    return res.status(500).json({ error: "An error occurred." });
  }
});

// -------------------- HEALTH CHECK --------------------
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    message: "Shopping assistant running (JSON/RAG mode)",
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
