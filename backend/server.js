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
    // accessories we want to avoid
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

// -------------------- HELPERS: STORE / PRICE / CATEGORY / KEYWORDS --------------------
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

  // Hard patterns
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
    if (pattern.test(msg)) {
      console.log(`[Category Detection] Force matched: ${category}`);
      return category;
    }
  }

  // Score-based fallback
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

  console.log(`[Category Detection] Scores:`, categoryScores);
  console.log(`[Category Detection] Selected: ${detectedCategory.category}`);
  return detectedCategory.score > 0 ? detectedCategory.category : null;
}

function extractSmartKeywords(userMessage, detectedCategory) {
  const msg = userMessage.toLowerCase().trim();
  const keywords = [];

  if (!detectedCategory) {
    return msg
      .split(/\s+/)
      .filter(
        (w) =>
          w.length > 3 &&
          ![
            "under",
            "cheapest",
            "cheap",
            "best",
            "want",
            "need",
            "looking",
            "the",
            "for",
            "with",
            "from",
            "buy",
            "get",
          ].includes(w)
      )
      .slice(0, 7);
  }

  const category = Object.values(PRODUCT_CATEGORIES).find(
    (c) => c.name === detectedCategory
  );

  const hasSamsung = msg.includes("samsung") || msg.includes("galaxy");
  if (hasSamsung) keywords.push("samsung", "galaxy");

  const isAppleQuery =
    msg.includes("iphone") ||
    msg.includes("apple") ||
    msg.includes("ios") ||
    msg.includes("mac") ||
    msg.includes("ipad");
  if (isAppleQuery) keywords.push("apple", "iphone");

  if (
    !isAppleQuery &&
    !hasSamsung &&
    (msg.includes("android") ||
      msg.includes("smart phone") ||
      msg.includes("smartphone") ||
      msg.includes("mobile phone"))
  ) {
    keywords.push("phone", "smartphone", "mobile");
  }

  // Direct brand matches
  category.brands.forEach((brand) => {
    if (msg.includes(brand) && !keywords.includes(brand)) keywords.push(brand);
  });

  // Category keywords
  category.keywords.forEach((kw) => {
    if (msg.includes(kw) && !keywords.includes(kw)) keywords.push(kw);
  });

  // Numbers in model names
  const modelMatch = msg.match(/\b(\d+)\b/g);
  if (modelMatch) modelMatch.forEach((num) => keywords.push(num));

  // Variants
  const variants = [
    "pro",
    "max",
    "plus",
    "ultra",
    "fold",
    "flip",
    "mini",
    "air",
    "gaming",
    "lite",
  ];
  variants.forEach((variant) => {
    if (msg.includes(variant)) keywords.push(variant);
  });

  // Storage
  const storageMatch = msg.match(/(\d+)(gb|tb)/gi);
  if (storageMatch) storageMatch.forEach((s) => keywords.push(s.toLowerCase()));

  if (keywords.length === 0) keywords.push(category.keywords[0]);

  console.log(`[Smart Keywords] Extracted: ${keywords.join(", ")}`);
  return [...new Set(keywords)];
}

// -------------------- INTENT CLASSIFICATION --------------------
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

// -------------------- EMBEDDING HELPER --------------------
async function getQueryEmbedding(text) {
  const embeddingRes = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  });

  const embedding = embeddingRes.data[0]?.embedding;
  if (!embedding) {
    throw new Error("Failed to generate embedding for query");
  }

  // Convert JS array -> pgvector literal: "[0.123456,0.654321,...]"
  const vectorLiteral =
    "[" + embedding.map((x) => Number(x).toFixed(6)).join(",") + "]";

  return { embedding, vectorLiteral };
}

// -------------------- DB SEARCH USING EMBEDDINGS (RAG STYLE) --------------------
// Assumes Postgres + pgvector and a `descriptionEmbedding` column of type `vector` in "Product".
async function executeEmbeddingSearch(vectorLiteral, maxResults) {
  try {
    console.log(
      `[Embedding Search] Fetching top ${maxResults} products by vector similarity`
    );

    // Using $queryRawUnsafe because we need to inject the vector literal + LIMIT number.
    // The vector literal is generated from OpenAI numbers, not user text, so SQL injection risk is negligible.
    const query = `
      SELECT
        "title",
        "price",
        "storeName",
        "productUrl",
        "category",
        "imageUrl",
        "stock"
      FROM "Product"
      WHERE "descriptionEmbedding" IS NOT NULL
      ORDER BY "descriptionEmbedding" <#> '${vectorLiteral}'::vector ASC
      LIMIT ${maxResults};
    `;

    const results = await prisma.$queryRawUnsafe(query);

    console.log(
      `[Embedding Search] Raw candidates from DB: ${results.length} products`
    );
    return results;
  } catch (err) {
    console.error("Embedding DB Search Error:", err);
    return [];
  }
}

// -------------------- FILTER + RANK (STORE BALANCE, SCORE, ACCESSORIES, BRAND) --------------------
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

  const categoryConfig = category
    ? Object.values(PRODUCT_CATEGORIES).find((c) => c.name === category)
    : null;

  const isAppleQuery = APPLE_TERMS.some((t) => query.includes(t));
  const isAndroidQuery = ANDROID_TERMS.some((t) => query.includes(t));

  console.log(
    `[Filter] Starting with ${products.length} products. Category: ${category}`
  );

  let filteredProducts = products.filter((product) => {
    const title = (product.title || "").toLowerCase();
    if (!product.title || product.price == null) return false;

    // Explicit out-of-stock filter
    if (
      product.stock &&
      /out[_\s-]*of[_\s-]*stock/i.test(String(product.stock))
    ) {
      return false;
    }

    // Price filter (safety)
    if (
      priceRange &&
      (product.price < priceRange.min || product.price > priceRange.max)
    ) {
      return false;
    }

    // Store filter (safety)
    if (
      storeName &&
      !(product.storeName || "").toLowerCase().includes(storeName.toLowerCase())
    ) {
      return false;
    }

    // Category accessory exclusion
    if (categoryConfig) {
      const lowerTitle = title.toLowerCase();
      const isAccessory = categoryConfig.exclude.some((term) =>
        lowerTitle.includes(term.toLowerCase())
      );
      if (isAccessory) return false;
    }

    return true;
  });

  console.log(`[Filter] After basic filtering: ${filteredProducts.length}`);

  // Scoring
  const scoredProducts = filteredProducts.map((product) => {
    let score = 0;
    const title = (product.title || "").toLowerCase();
    const categoryField = (product.category || "").toLowerCase();

    // Category reinforcement
    if (category) {
      if (categoryField.includes(category.split("_")[0])) score += 40;
      if (categoryConfig) {
        categoryConfig.required.forEach((term) => {
          if (title.includes(term)) score += 20;
        });
      }
    }

    // Query words match
    queryWords.forEach((word) => {
      if (title.includes(word)) score += 50;
      if (new RegExp(`\\b${word}\\b`).test(title)) score += 25;
    });

    // Brand alignment (Apple vs Android queries)
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

    // Recent models bump
    if (title.includes("2024") || title.includes("2025")) score += 20;

    // Price influence
    if (hasCheapest) {
      score += 10000 / (product.price + 1);
    } else {
      score += Math.log(product.price + 1) * 8;
    }

    return { ...product, score };
  });

  scoredProducts.sort((a, b) => b.score - a.score);

  // Store balancing
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

    // Fill remaining slots
    for (const product of scoredProducts) {
      if (
        !selectedProducts.includes(product) &&
        selectedProducts.length < productCount
      ) {
        selectedProducts.push(product);
      }
    }
  }

  console.log(`\n=== FINAL SELECTION (${selectedProducts.length} Items) ===`);
  selectedProducts.forEach((p, index) => {
    console.log(
      `${index + 1}. [${p.storeName}] ${p.title.substring(0, 60)}... | ${
        p.price
      } KWD | Score: ${p.score.toFixed(1)}`
    );
  });
  console.log("======================================================\n");

  return selectedProducts;
}

// -------------------- CONVERSATIONAL MEMORY HELPER --------------------
function buildMessages(
  systemInstruction,
  history,
  userMessage,
  extraSystem = ""
) {
  const messages = [{ role: "system", content: systemInstruction }];

  if (extraSystem) {
    messages.push({ role: "system", content: extraSystem });
  }

  // keep last ~8 history turns
  const trimmedHistory = Array.isArray(history) ? history.slice(-8) : [];

  trimmedHistory.forEach((msg) => {
    if (msg.role && msg.content) messages.push(msg);
  });

  messages.push({ role: "user", content: userMessage });
  return messages;
}

// -------------------- MAIN CHAT ROUTE --------------------
app.post("/chat", async (req, res) => {
  const { query: message, history = [] } = req.body;

  if (!message) {
    return res.status(400).json({ error: "Message is required." });
  }

  const userMessageObject = { role: "user", content: message };
  const responseHistory = [userMessageObject];

  try {
    const detectedCategory = detectProductCategory(message);
    const intent = classifyIntent(message);
    const priceRange = extractPriceRange(message);
    const storeName = extractStoreName(message);

    console.log(
      `[Chat] Intent: ${intent}, Category: ${detectedCategory}, Store: ${storeName}, PriceRange:`,
      priceRange
    );

    // ---------------- LOW INTENT: ONLY CLARIFYING QUESTIONS ----------------
    if (intent === "LOW") {
      const lowIntentSystem = `
You are Omnia AI, a friendly shopping assistant for Kuwait electronics.
The user is just exploring and not yet ready to buy a specific product.
Your job:
- Reply in a warm, human tone (2–3 short sentences).
- Do NOT list specific products yet.
- Ask 1–2 smart follow-up questions to understand:
  - Category (phones, laptops, tablets, etc.)
  - Budget (approx. KWD range)
  - Brand preferences (Apple, Samsung, etc.)
Use previous messages as conversational memory so the chat feels continuous.
`;

      const lowIntentResponse = await openai.chat.completions.create({
        model: LLM_MODEL,
        messages: buildMessages(lowIntentSystem, history, message),
        temperature: 0.7,
      });

      const finalContent = lowIntentResponse.choices[0].message.content || "";
      responseHistory.push({ role: "assistant", content: finalContent });

      return res.json({
        reply: finalContent,
        products: [],
        intent: "LOW",
        category: detectedCategory,
        priceRange,
        storeName,
        history: [...history, ...responseHistory],
      });
    }

    // ---------------- MEDIUM / HIGH INTENT: EMBEDDING SEARCH + RANK ----------------
    // 1. Get query embedding (returns both array + literal)
    const { vectorLiteral } = await getQueryEmbedding(message);

    // 2. Retrieve top N candidates purely by embedding similarity
    const dbMaxResults = 80; // candidates before our second-stage filter/rank
    const dbProducts = await executeEmbeddingSearch(
      vectorLiteral,
      dbMaxResults
    );

    const productCount = intent === "MEDIUM" ? 5 : 10;

    if (!dbProducts || dbProducts.length === 0) {
      // No products — still answer nicely
      const noResultSystem = `
You are Omnia AI, a shopping assistant for Kuwait electronics.
We tried to search the database but found no matching items in stock.
Your job:
- Apologize briefly.
- Suggest the user to adjust budget, brand, or category.
- Ask 1–2 follow-up questions to help refine the search.
Keep it short, warm, and human. Do NOT hallucinate products.
`;
      const noResultResponse = await openai.chat.completions.create({
        model: LLM_MODEL,
        messages: buildMessages(noResultSystem, history, message),
        temperature: 0.6,
      });

      const finalContent = noResultResponse.choices[0].message.content || "";
      responseHistory.push({ role: "assistant", content: finalContent });

      return res.json({
        reply: finalContent,
        products: [],
        intent,
        category: detectedCategory,
        priceRange,
        storeName,
        history: [...history, ...responseHistory],
      });
    }

    // 3. Second-stage filtering + scoring (category, price, store, accessories, brand)
    const filteredProducts = filterAndRankProducts(
      dbProducts,
      message,
      productCount,
      detectedCategory,
      priceRange,
      storeName
    );

    const minimalProductData = filteredProducts.map((p) => ({
      title: p.title,
      price: p.price,
      storeName: p.storeName,
      productUrl: p.productUrl,
      imageUrl: p.imageUrl,
    }));

    const categoryName = detectedCategory
      ? detectedCategory.replace("_", " ")
      : "products";

    const finalSystemPrompt = `
You are Omnia AI, a smart shopping assistant for Kuwait (electronics only).
You already have a curated list of products from the database.
DO NOT invent products. Only talk about the products I give you.

USER QUERY: "${message}"
CATEGORY: ${categoryName}
INTENT: ${intent} (MEDIUM = show 5 items, HIGH = show 10 items)

Guidelines:
- Tone: friendly, helpful, and human (like a sales expert in a store).
- Start with 1–2 sentences summarising what the user asked for.
- Then, show a short list of products (max ${productCount}) in a clear format:
  - Product name
  - Price in KWD
  - Store name
  - Short, 1–2 sentence description using only title + obvious info.
- If one or two products stand out for value, say which ones and why.
- If the user mentioned budget or brand, explain how these picks match it.
- End with a simple follow-up question like
  "Do you want something cheaper, more powerful, or a different brand?".
`;

    const productContext = `
Here is the product data from the database (DO NOT show this raw JSON to the user, just use it to answer):

${JSON.stringify(minimalProductData, null, 2)}
`;

    const finalResponse = await openai.chat.completions.create({
      model: LLM_MODEL,
      messages: buildMessages(
        finalSystemPrompt,
        history,
        message,
        productContext
      ),
      temperature: 0.5,
    });

    const finalText = finalResponse.choices[0].message.content || "";
    responseHistory.push({ role: "assistant", content: finalText });

    return res.json({
      reply: finalText,
      products: minimalProductData,
      intent,
      category: detectedCategory,
      priceRange,
      storeName,
      history: [...history, ...responseHistory],
    });
  } catch (error) {
    console.error("Chat Error:", error);
    return res.status(500).json({ error: "An error occurred." });
  }
});

// -------------------- HEALTH CHECK --------------------
app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "Shopping assistant running (RAG mode)" });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
