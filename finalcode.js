// server.js
import "dotenv/config";
import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { PrismaClient } from "@prisma/client";

const app = express();
const PORT = process.env.PORT || 4000;
const LLM_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const EMBEDDING_MODEL =
  process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const prisma = new PrismaClient();

app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ limit: "20mb", extended: true }));

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

const STORE_NAMES = ["xcite", "best.kw", "best", "noon.kw", "noon", "jarir"];

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

// -------------------- HELPERS --------------------
function extractStoreName(userMessage) {
  const msg = userMessage.toLowerCase();
  for (const store of STORE_NAMES) {
    const pattern = new RegExp(`\\b${store}(?:\\s+store|\\s+shop|\\b)`, "i");
    if (pattern.test(msg)) {
      if (store === "noon.kw" || store === "noon") return "noon.kw";
      if (store === "best.kw" || store === "best") return "best.kw";
      if (store === "xcite") return "xcite";
      if (store === "jarir") return "jarir";
      return store;
    }
  }
  const fromMatch = msg.match(/from\s*(\S+)/i);
  if (fromMatch) {
    const wordAfterFrom = fromMatch[1].toLowerCase().replace(/[.,]/g, "");
    if (wordAfterFrom.includes("xcite")) return "xcite";
    if (wordAfterFrom.includes("noon")) return "noon.kw";
    if (wordAfterFrom.includes("best")) return "best.kw";
    if (wordAfterFrom.includes("jarir")) return "jarir";
  }
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

function classifyIntent(userMessage) {
  const msg = userMessage.toLowerCase();
  const hasPrice = /(\d+)\s*(kwd|kd|dinar|budget|under|below|between)/i.test(
    msg
  );
  const hasSpecificModel =
    /\b(iphone|galaxy|pixel)\s*\d+/i.test(msg) ||
    /\b\d+gb\b/i.test(msg) ||
    /(pro max|pro|plus|ultra|fold|flip|rtx|ryzen)/i.test(msg);
  const hasBrandAndType =
    /(samsung|apple|iphone|dell|hp|sony|bose|lenovo|asus|acer).*(phone|laptop|headphone|earphone|tablet|desktop)/i.test(
      msg
    ) ||
    /(phone|laptop|headphone|earphone|tablet|desktop).*(samsung|apple|iphone|dell|hp|sony|bose|lenovo|asus|acer)/i.test(
      msg
    );

  if (hasSpecificModel || (hasBrandAndType && hasPrice)) return "HIGH";
  if (hasBrandAndType || hasPrice) return "MEDIUM";
  return "LOW";
}

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

// -------------------- DB SEARCH (UPDATED TO FETCH DESCRIPTION) --------------------
async function executeEmbeddingSearch(vectorLiteral, maxResults) {
  try {
    console.log(`[Embedding Search] Fetching top ${maxResults} products...`);
    const query = `
      SELECT
        "title",
        "price",
        "storeName",
        "productUrl",
        "category",
        "imageUrl",
        "stock",
        "description"
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

// -------------------- FILTER + RANK --------------------
function filterAndRankProducts(
  products,
  userQuery,
  productCount,
  category,
  priceRange = null,
  storeName = null
) {
  const query = userQuery.toLowerCase();
  const hasCheapest = query.includes("cheapest") || query.includes("cheap");
  const queryWords = query.split(/\s+/).filter((w) => w.length > 2);

  // **NEW: Extract specific model numbers from query**
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

  let filteredProducts = products.filter((product) => {
    const title = (product.title || "").toLowerCase();
    if (!product.title || product.price == null) return false;
    if (
      product.stock &&
      /out[_\s-]*of[_\s-]*stock/i.test(String(product.stock))
    )
      return false;
    if (
      priceRange &&
      (product.price < priceRange.min || product.price > priceRange.max)
    )
      return false;
    if (
      storeName &&
      !(product.storeName || "").toLowerCase().includes(storeName.toLowerCase())
    )
      return false;
    if (categoryConfig) {
      const isAccessory = categoryConfig.exclude.some((term) =>
        title.includes(term.toLowerCase())
      );
      if (isAccessory) return false;
    }
    return true;
  });

  const scoredProducts = filteredProducts.map((product) => {
    let score = 0;
    const title = (product.title || "").toLowerCase();
    const categoryField = (product.category || "").toLowerCase();

    // **NEW: Massive boost for exact model match**
    if (requestedModel) {
      // Extract model from product title
      const productModelMatch = title.match(
        /\b(iphone|galaxy|pixel|macbook)\s*(\d+)(\s*pro)?(\s*max)?(\s*plus)?(\s*ultra)?/i
      );
      if (productModelMatch) {
        const productModel = productModelMatch[0].toLowerCase();

        // Exact match gets huge boost
        if (productModel === requestedModel) {
          score += 500; // Very high score for exact match
        } else {
          // Penalize different model numbers
          const requestedNum = requestedModel.match(/\d+/)?.[0];
          const productNum = productModel.match(/\d+/)?.[0];
          if (requestedNum !== productNum) {
            score -= 300; // Heavy penalty for wrong model number
          }
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
      if (new RegExp(`\\b${word}\\b`).test(title)) score += 25;
    });

    const hasAppleBrand = APPLE_TERMS.some((t) => title.includes(t));
    const hasAndroidBrand = ANDROID_TERMS.some((t) => title.includes(t));

    if (isAppleQuery) {
      if (hasAppleBrand) score += 80;
      if (hasAndroidBrand && !hasAppleBrand) score -= 60;
    }
    if (isAndroidQuery) {
      if (hasAndroidBrand) score += 80;
      if (hasAppleBrand && !hasAndroidBrand) score -= 60;
    }

    // **MODIFIED: Only boost year if no specific model requested**
    if (!requestedModel && (title.includes("2024") || title.includes("2025"))) {
      score += 20;
    }

    if (hasCheapest) {
      score += 10000 / (product.price + 1);
    } else {
      score += Math.log(product.price + 1) * 8;
    }
    return { ...product, score };
  });

  scoredProducts.sort((a, b) => b.score - a.score);

  // Rest of the function remains the same...

  let selectedProducts = [];
  if (storeName) {
    selectedProducts = scoredProducts.slice(0, productCount);
  } else {
    const storeCount = { xcite: 0, jarir: 0, "best.kw": 0, "noon.kw": 0 };
    const maxPerStore = Math.ceil(productCount / 4);
    for (const product of scoredProducts) {
      const pStore = product.storeName ? product.storeName.toLowerCase() : "";
      let storeKey = null;
      if (pStore.includes("xcite")) storeKey = "xcite";
      else if (pStore.includes("jarir")) storeKey = "jarir";
      else if (pStore.includes("best")) storeKey = "best.kw";
      else if (pStore.includes("noon")) storeKey = "noon.kw";

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

  return selectedProducts;
}

// -------------------- MAIN CHAT ROUTE --------------------
app.post("/chat", async (req, res) => {
  const { query: message, history = [] } = req.body;

  if (!message) return res.status(400).json({ error: "Message is required." });

  const userMessageObject = { role: "user", content: message };
  // We will add the assistant response to history at the end

  try {
    const detectedCategory = detectProductCategory(message);
    const intent = classifyIntent(message);
    const priceRange = extractPriceRange(message);
    const storeName = extractStoreName(message);

    console.log(
      `[Chat] Intent: ${intent}, Category: ${detectedCategory}, Store: ${storeName}`
    );

    // --- LOW INTENT: TEXT ONLY ---
    if (intent === "LOW") {
      const lowIntentSystem = `
        You are Omnia AI, a friendly shopping assistant for Kuwait electronics.
        The user is just exploring.
        Reply in a warm, human tone (2–3 short sentences).
        Ask 1–2 smart follow-up questions about category, budget, or brand.
        Return your response in JSON format: { "message": "Your text here", "intent_level": "LOW", "products": [] }
      `;

      const lowResponse = await openai.chat.completions.create({
        model: LLM_MODEL,
        messages: [
          { role: "system", content: lowIntentSystem },
          ...history,
          userMessageObject,
        ],
        temperature: 0.7,
        response_format: { type: "json_object" },
      });

      const content = JSON.parse(
        lowResponse.choices[0].message.content || "{}"
      );

      return res.json({
        reply: content.message || "How can I help you today?",
        products: [],
        intent: "LOW",
        category: detectedCategory,
        history: [
          ...history,
          userMessageObject,
          { role: "assistant", content: content.message },
        ],
      });
    }

    // In /chat route, before calling getQueryEmbedding
    let searchQuery = message;

    // If specific model detected, emphasize it
    const modelMatch = message.match(
      /\b(iphone|galaxy|pixel)\s*(\d+)(\s*pro)?(\s*max)?/i
    );
    if (modelMatch) {
      searchQuery = `${modelMatch[0]} ${message}`;
    }

    // --- MEDIUM / HIGH INTENT: RAG + JSON STRUCTURE ---
    const { vectorLiteral } = await getQueryEmbedding(message);
    const dbProducts = await executeEmbeddingSearch(vectorLiteral, 80);

    const productCount = intent === "MEDIUM" ? 5 : 10;

    if (!dbProducts || dbProducts.length === 0) {
      return res.json({
        reply:
          "I couldn't find any products matching that description. Could you try adjusting your search?",
        products: [],
        intent,
        history: [...history, userMessageObject],
      });
    }

    const filteredProducts = filterAndRankProducts(
      dbProducts,
      message,
      productCount,
      detectedCategory,
      priceRange,
      storeName
    );
    // Add this right after filterAndRankProducts call
    if (modelMatch) {
      const exactMatches = filteredProducts.filter((p) => {
        const title = (p.title || "").toLowerCase();
        return title.includes(modelMatch[0].toLowerCase());
      });

      if (exactMatches.length > 0) {
        // Return only exact matches if found
        filteredProducts = exactMatches.slice(0, productCount);
      }
    }

    const categoryName = detectedCategory
      ? detectedCategory.replace("_", " ")
      : "products";

    // --- SYSTEM PROMPT: ENFORCING JSON & NO HALLUCINATION ---
    const finalSystemPrompt = `
      You are Omnia AI, a smart shopping assistant for Kuwait (electronics only).

      **USER QUERY**: "${message}"
      **PRODUCTS**: ${
        filteredProducts.length
      } pre-filtered ${categoryName} (All In Stock)

      **CRITICAL DATA INTEGRITY RULES**:
      1. You must **ONLY** return products listed in the 'Input Data' section below.
      2. **Do NOT invent**, hallucinate, or 'fill in' products that are not in the input list.
      3. If the input list contains 3 items, your output must contain 3 items. Do not add more.
      4. Ensure 'image_url' and 'product_url' are copied **exactly** from the input data. Do not generate fake URLs.

      **CONTENT GENERATION**:
      For each product:
      - "product_description": Write a detailed 2-3 line paragraph highlighting the technical specifications (Processor, RAM, Storage, Screen, Battery, etc.). 
      - Use the provided 'db_description' as your primary source. If 'db_description' is empty, use your internal knowledge of the specific product model to generate accurate specifications.
      
      Output JSON Structure:
      {
        "message": "Friendly intro",
        "intent_level": "${intent}",
        "products": [ 
          { 
            "product_name": "title", 
            "store_name": "store", 
            "price_kwd": number, 
            "product_url": "url", 
            "image_url": "url", 
            "product_description": "Detailed 2-3 line specs paragraph..." 
          } 
        ]
      }

      Input Data: ${JSON.stringify(
        filteredProducts.map((p) => ({
          title: p.title,
          price: p.price,
          storeName: p.storeName,
          productUrl: p.productUrl,
          imageUrl: p.imageUrl,
          db_description: p.description || "", // Passes DB description to LLM
        }))
      )}
    `;

    const finalResponse = await openai.chat.completions.create({
      model: LLM_MODEL,
      messages: [{ role: "system", content: finalSystemPrompt }], // No history needed for strict product listing usually, but can be added if context matters
      temperature: 0.5,
      response_format: { type: "json_object" }, // Forces JSON output
    });

    const finalContent = finalResponse.choices[0].message.content || "{}";
    let parsedData;

    try {
      parsedData = JSON.parse(finalContent);
    } catch (e) {
      console.error("JSON Parsing failed", e);
      // Fallback in case of malformed JSON
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

    return res.json({
      reply: parsedData.message,
      products: parsedData.products,
      intent,
      category: detectedCategory,
      priceRange,
      storeName,
      history: [
        ...history,
        userMessageObject,
        { role: "assistant", content: parsedData.message },
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
