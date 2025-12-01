import "dotenv/config";
import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { PrismaClient } from "@prisma/client";

// --- INITIALIZATION ---
const app = express();
const PORT = process.env.PORT || 4000;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const prisma = new PrismaClient();

// --- MIDDLEWARE ---
app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ limit: "20mb", extended: true }));

// --- CATEGORY DEFINITIONS ---
const PRODUCT_CATEGORIES = {
  MOBILE_PHONE: {
    name: "mobile_phone",
    keywords: [
      "phone",
      "mobile",
      "smartphone",
      "cell phone",
      "cellular",
      "samsung",
      "galaxy",
      "android",
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
    ],
    specs: ["gb", "ram", "camera", "mp", "mah", "inch", "display", "5g", "4g"],
    exclude: [
      "case",
      "cover",
      "protector",
      "screen guard",
      "tempered glass",
      "charger",
      "cable",
      "holder",
      "stand",
      "adapter",
      "pouch",
      "headphone",
      "earphone",
      "earbuds",
      "airpods",
      "earpods",
      "speaker",
      "tablet",
      "tab",
      "controller",
      "microphone",
      "mic",
      "watch",
      "smartwatch",
      "band",
      "strap",
      "shell",
      "bumper",
      "skin",
      "sticker",
      "mount",
      "cradle",
      "dock",
    ],
    required: [
      "phone",
      "smartphone",
      "mobile",
      "galaxy",
      "pixel",
      "android",
      "5g phone",
      "4g phone",
    ],
  },
  LAPTOP: {
    name: "laptop",
    keywords: [
      "laptop",
      "notebook",
      "ultrabook",
      "chromebook",
      "macbook",
      "gaming laptop",
      "workstation",
      "2-in-1 laptop",
    ],
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
      "alienware",
      "thinkpad",
      "pavilion",
      "predator",
      "rog",
      "legion",
      "ideapad",
    ],
    specs: [
      "intel",
      "amd",
      "ryzen",
      "core i",
      "processor",
      "cpu",
      "ssd",
      "hdd",
      "ram",
      "gb",
      "tb",
      "nvidia",
      "rtx",
      "gtx",
      "graphics",
      "gpu",
      "display",
      "inch",
      "hz",
      "fhd",
      "4k",
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
      "cooler",
      "cooling pad",
      "skin",
      "sticker",
      "backpack",
      "cable",
      "dock",
    ],
    required: [
      "laptop",
      "notebook",
      "ultrabook",
      "chromebook",
      "macbook",
      "workstation",
    ],
  },
  HEADPHONE: {
    name: "headphone",
    keywords: [
      "headphone",
      "headphones",
      "headset",
      "over-ear",
      "on-ear",
      "gaming headset",
      "studio headphones",
      "wireless headphones",
    ],
    brands: [
      "sony",
      "bose",
      "jbl",
      "sennheiser",
      "beats",
      "anker",
      "soundcore",
      "jabra",
      "skullcandy",
      "audio-technica",
      "logitech",
      "hyperx",
      "razer",
      "corsair",
      "steelseries",
    ],
    specs: [
      "wireless",
      "bluetooth",
      "noise cancelling",
      "anc",
      "bass",
      "mic",
      "microphone",
      "battery",
      "playtime",
      "hours",
      "driver",
      "mm",
      "over-ear",
      "on-ear",
    ],
    exclude: [
      "case only",
      "pouch only",
      "stand only",
      "holder only",
      "adapter only",
      "cable only",
      "replacement pads",
      "cushion only",
      "foam tips",
      "earbuds",
      "earpods",
      "in-ear",
    ],
    required: ["headphone", "headphones", "headset", "over-ear", "on-ear"],
  },
  EARPHONE: {
    name: "earphone",
    keywords: [
      "earphone",
      "earphones",
      "earbuds",
      "earpods",
      "airpods",
      "tws",
      "wireless earbuds",
      "true wireless",
      "in-ear",
    ],
    brands: [
      "apple",
      "samsung",
      "sony",
      "jbl",
      "anker",
      "soundcore",
      "jabra",
      "beats",
      "bose",
      "xiaomi",
      "realme",
      "oppo",
      "oneplus",
      "nothing",
      "huawei",
    ],
    specs: [
      "wireless",
      "bluetooth",
      "tws",
      "true wireless",
      "anc",
      "noise cancelling",
      "battery",
      "playtime",
      "hours",
      "in-ear",
      "bass",
      "mic",
    ],
    exclude: [
      "case only",
      "pouch only",
      "holder only",
      "adapter only",
      "cable only",
      "replacement tips",
      "foam tips only",
      "headphone",
      "headset",
      "over-ear",
      "on-ear",
    ],
    required: [
      "earphone",
      "earbuds",
      "earpods",
      "airpods",
      "tws",
      "wireless earbuds",
      "in-ear",
      "true wireless",
    ],
  },
  DESKTOP: {
    name: "desktop",
    keywords: [
      "desktop",
      "pc",
      "computer",
      "gaming pc",
      "workstation pc",
      "tower",
      "mini pc",
      "all-in-one",
    ],
    brands: [
      "dell",
      "hp",
      "lenovo",
      "asus",
      "acer",
      "msi",
      "alienware",
      "cyberpowerpc",
      "corsair",
      "nzxt",
      "apple",
      "imac",
    ],
    specs: [
      "intel",
      "amd",
      "ryzen",
      "core i",
      "processor",
      "cpu",
      "ssd",
      "hdd",
      "ram",
      "gb",
      "tb",
      "nvidia",
      "rtx",
      "gtx",
      "graphics",
      "gpu",
      "tower",
      "atx",
    ],
    exclude: [
      "monitor",
      "keyboard",
      "mouse",
      "speaker",
      "case only",
      "cable",
      "adapter",
      "stand",
      "riser",
      "pad",
    ],
    required: ["desktop", "pc", "computer", "tower", "all-in-one", "mini pc"],
  },
  TABLET: {
    name: "tablet",
    keywords: ["tablet", "ipad", "tab", "galaxy tab", "surface tablet"],
    brands: [
      "apple",
      "samsung",
      "microsoft",
      "lenovo",
      "huawei",
      "xiaomi",
      "amazon",
      "fire",
      "surface",
    ],
    specs: [
      "inch",
      "display",
      "storage",
      "gb",
      "wifi",
      "cellular",
      "lte",
      "5g",
      "stylus",
      "pencil",
    ],
    exclude: [
      "case",
      "cover",
      "protector",
      "screen guard",
      "tempered glass",
      "stand",
      "holder",
      "keyboard only",
      "stylus only",
      "charger",
      "cable",
      "adapter",
    ],
    required: ["tablet", "ipad", "tab"],
  },
};

// Store names to search for (case-insensitive)
const STORE_NAMES = ["xcite", "best.kw", "noon.kw", "noon", "best"];

// --- HELPER FUNCTIONS ---

function extractStoreName(userMessage) {
  const msg = userMessage.toLowerCase();
  for (const store of STORE_NAMES) {
    const pattern = new RegExp(`\\b${store}(?:\\s+store|\\s+shop|\\b)`, "i");
    if (pattern.test(msg)) {
      console.log(`[Store Extraction] Found store: ${store}`);
      if (store.startsWith("noon")) return "Noon.kw";
      if (store.startsWith("best")) return "Best.kw";
      return store;
    }
  }
  const fromMatch = msg.match(/from\s*(\S+)/i);
  if (fromMatch) {
    const wordAfterFrom = fromMatch[1].toLowerCase().replace(/[.,]/g, "");
    for (const store of STORE_NAMES) {
      if (wordAfterFrom.includes(store.split(".")[0])) {
        console.log(`[Store Extraction] Found store via 'from': ${store}`);
        if (store.startsWith("noon")) return "Noon.kw";
        if (store.startsWith("best")) return "Best.kw";
        return store;
      }
    }
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
      /\b(android|smartphone|smart phone|cell phone|iphone|galaxy phone)\b/i,
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
    category.specs.forEach((spec) => {
      if (msg.includes(spec)) categoryScores[category.name] += 3;
    });
  });
  const detectedCategory = Object.entries(categoryScores).reduce(
    (max, [cat, score]) => (score > max.score ? { category: cat, score } : max),
    { category: null, score: 0 }
  );
  return detectedCategory.score > 0 ? detectedCategory.category : null;
}

function extractSmartKeywords(userMessage, detectedCategory) {
  const msg = userMessage.toLowerCase().trim();
  const keywords = [];
  if (!detectedCategory) {
    const words = msg
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
          ].includes(w)
      );
    return words.slice(0, 5);
  }
  const category = Object.values(PRODUCT_CATEGORIES).find(
    (c) => c.name === detectedCategory
  );
  if (!category) return ["product"];
  keywords.push(category.keywords[0]);
  category.brands.forEach((brand) => {
    if (msg.includes(brand)) keywords.push(brand);
  });
  const modelMatch = msg.match(/\b(\d+)\b/g);
  if (modelMatch) modelMatch.forEach((num) => keywords.push(num));
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
  const storageMatch = msg.match(/(\d+)(gb|tb)/gi);
  if (storageMatch) storageMatch.forEach((s) => keywords.push(s.toLowerCase()));
  if (detectedCategory === "laptop") {
    const processors = [
      "intel",
      "amd",
      "ryzen",
      "core i3",
      "core i5",
      "core i7",
      "core i9",
    ];
    processors.forEach((proc) => {
      if (msg.includes(proc)) keywords.push(proc);
    });
  }
  if (keywords.length < 3) {
    category.specs.forEach((spec) => {
      if (msg.includes(spec) && keywords.length < 5) keywords.push(spec);
    });
  }
  return keywords.length > 0 ? keywords : [category.keywords[0]];
}

// --- DB SEARCH ---
async function execute_db_search(
  keywords,
  max_results = 30,
  category = null,
  priceRange = null,
  storeName = null
) {
  const safeTake = Number.isInteger(max_results) ? max_results : 30;
  const cleanedKeywords = keywords
    .map((k) => k.trim())
    .filter(
      (k) =>
        k.length > 0 &&
        !["cheapest", "cheap", "budget", "best", "the", "kwd"].includes(
          k.toLowerCase()
        )
    );

  if (cleanedKeywords.length === 0) return JSON.stringify([]);
  const categoryConfig = category
    ? Object.values(PRODUCT_CATEGORIES).find((c) => c.name === category)
    : null;
  if (!categoryConfig) return JSON.stringify([]);

  try {
    const whereConditions = {
      AND: [
        {
          OR: cleanedKeywords.flatMap((keyword) => [
            { title: { contains: keyword, mode: "insensitive" } },
            { category: { contains: keyword, mode: "insensitive" } },
          ]),
        },
        {
          OR: categoryConfig.required.map((term) => ({
            title: { contains: term, mode: "insensitive" },
          })),
        },
        ...categoryConfig.exclude.map((term) => ({
          NOT: { title: { contains: term, mode: "insensitive" } },
        })),
        ...(priceRange
          ? [
              ...(priceRange.min > 0
                ? [{ price: { gte: priceRange.min } }]
                : []),
              ...(priceRange.max < Infinity
                ? [{ price: { lte: priceRange.max } }]
                : []),
            ]
          : []),
        ...(storeName
          ? [{ storeName: { contains: storeName, mode: "insensitive" } }]
          : []),
      ],
    };

    const results = await prisma.product.findMany({
      where: whereConditions,
      select: {
        title: true,
        price: true,
        storeName: true,
        productUrl: true,
        category: true,
        imageUrl: true,
        stock: true,
        description: true,
      },
      orderBy: { price: "desc" },
      take: Math.min(safeTake, 100),
    });

    console.log(`[DB Search] Found ${results.length} products`);
    return JSON.stringify(results);
  } catch (dbError) {
    console.error("Prisma DB Error:", dbError);
    return JSON.stringify({ error: "Database search failed." });
  }
}

async function classifyIntent(userMessage) {
  const msg = userMessage.toLowerCase();
  const hasSpecificModel =
    /\b(iphone|galaxy|pixel)\s*\d+/i.test(msg) ||
    /\b\d+gb\b/i.test(msg) ||
    /(pro max|pro|plus|ultra|fold|flip)/i.test(msg);
  const hasBrandAndType =
    /(samsung|apple|iphone|dell|hp|sony|bose).*(phone|laptop|headphone|earphone|tablet)/i.test(
      msg
    ) ||
    /(phone|laptop|headphone|earphone|tablet).*(samsung|apple|iphone|dell|hp|sony|bose)/i.test(
      msg
    );
  const isGeneral =
    /what|how|which|tell me|recommend|advice|trend|should i|best for/i.test(
      msg
    ) && !hasSpecificModel;

  if (isGeneral && !hasSpecificModel) return "LOW";
  if (hasSpecificModel) return "HIGH";
  if (hasBrandAndType) return "MEDIUM";
  return "MEDIUM";
}

// --- FILTERING (Strict Stock Check) ---
function filterAndRankProducts(
  products,
  userQuery,
  productCount,
  category,
  priceRange = null,
  storeName = null
) {
  const query = userQuery.toLowerCase();
  const hasCheapest =
    query.includes("cheapest") ||
    query.includes("cheap") ||
    query.includes("budget");
  const categoryConfig = category
    ? Object.values(PRODUCT_CATEGORIES).find((c) => c.name === category)
    : null;
  let outOfStockFound = false;

  let filteredProducts = products.filter((product) => {
    const title = product.title.toLowerCase();
    const productStore = product.storeName.toLowerCase();
    let hasRequiredTerm = true;
    let hasExcludedTerm = false;
    if (categoryConfig) {
      hasRequiredTerm = categoryConfig.required.some((term) =>
        title.includes(term.toLowerCase())
      );
      hasExcludedTerm = categoryConfig.exclude.some((term) =>
        title.includes(term.toLowerCase())
      );
    }
    let withinPriceRange = true;
    if (priceRange)
      withinPriceRange =
        product.price >= priceRange.min && product.price <= priceRange.max;
    let matchesStore = true;
    if (storeName)
      matchesStore = productStore.includes(storeName.toLowerCase());

    const isRelevant =
      hasRequiredTerm && !hasExcludedTerm && withinPriceRange && matchesStore;
    if (!isRelevant) return false;

    // 4. STOCK CHECK (Strict)
    // Only return products that are IN_STOCK
    if (product.stock !== "IN_STOCK") {
      outOfStockFound = true;
      return false; // Remove OOS items
    }
    return true;
  });

  console.log(
    `[Filtering] In-Stock: ${filteredProducts.length}, OOS matches found: ${outOfStockFound}`
  );

  const scoredProducts = filteredProducts.map((product) => {
    let score = 0;
    const title = product.title.toLowerCase();
    if (title.includes(query)) score += 100;
    if (hasCheapest) score += 10000 / (product.price + 1);
    else score += product.price / 10;
    return { ...product, score };
  });

  scoredProducts.sort((a, b) => {
    if (Math.abs(a.score - b.score) > 50) return b.score - a.score;
    return hasCheapest ? a.price - b.price : b.price - a.price;
  });

  let selectedProducts = [];
  if (storeName) {
    selectedProducts = scoredProducts.slice(0, productCount);
  } else {
    // Diversity logic simplified for snippet
    const storeCount = { xcite: 0, jarir: 0, "best.kw": 0, "noon.kw": 0 };
    const maxPerStore = Math.ceil(productCount / 4);
    for (const product of scoredProducts) {
      const productStoreName = product.storeName
        ? product.storeName.toLowerCase()
        : "";
      const storeKey = productStoreName.includes("xcite")
        ? "xcite"
        : productStoreName.includes("jarir")
        ? "jarir"
        : productStoreName.includes("best")
        ? "best.kw"
        : productStoreName.includes("noon")
        ? "noon.kw"
        : null;
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

  return { products: selectedProducts, outOfStockFound };
}

// LLM Helper
const createLlmMessages = (
  userMessage,
  systemInstruction,
  initialAssistantMessage = null,
  toolResponses = []
) => {
  const messages = [{ role: "system", content: systemInstruction }];
  if (initialAssistantMessage) messages.push(initialAssistantMessage);
  toolResponses.forEach((res) => messages.push(res));
  messages.push({ role: "user", content: userMessage });
  return messages;
};

// Tool Schema
const product_search_tool_schema = {
  type: "function",
  function: {
    name: "search_products",
    description: "Searches the product database.",
    parameters: {
      type: "object",
      properties: {
        keywords: { type: "array", items: { type: "string" } },
        max_results: { type: "integer", default: 50 },
        category: {
          type: "string",
          enum: Object.values(PRODUCT_CATEGORIES).map((c) => c.name),
        },
        store_name: {
          type: "string",
          enum: ["xcite", "best.kw", "noon.kw"],
        },
      },
      required: ["keywords", "max_results"],
    },
  },
};

// --- MAIN CHAT ROUTE ---
app.post("/chat", async (req, res) => {
  const { query: message, history = [] } = req.body;
  if (!message) return res.status(400).json({ error: "Message is required." });

  const userMessageObject = { role: "user", content: message };
  const responseHistory = [userMessageObject];

  try {
    const detectedCategory = detectProductCategory(message);
    const intent = await classifyIntent(message);
    const priceRange = extractPriceRange(message);
    const storeName = extractStoreName(message);

    if (intent === "LOW") {
      const lowIntentSystem = `You are Omnia AI... (Short friendly advice).`;
      const lowIntentResponse = await openai.chat.completions.create({
        model: "gpt-5.1-2025-11-13",
        messages: createLlmMessages(message, lowIntentSystem),
        temperature: 0.5,
      });
      const finalContent = lowIntentResponse.choices[0].message.content;
      responseHistory.push({ role: "assistant", content: finalContent });
      return res.json({
        reply: finalContent,
        history: [...history, ...responseHistory],
        intent: "LOW",
        category: detectedCategory,
      });
    }

    const smartKeywords = extractSmartKeywords(message, detectedCategory);
    const searchSystemPrompt = `You are a keyword extraction expert... 
    Query: "${message}". Category: ${detectedCategory}. Store: ${storeName}
    Extract keywords. Pass specific store to store_name param if present.`;

    let initialResponse = await openai.chat.completions.create({
      model: "gpt-5.1-2025-11-13",
      messages: createLlmMessages(message, searchSystemPrompt),
      tools: [product_search_tool_schema],
      tool_choice: { type: "function", function: { name: "search_products" } },
      temperature: 0.2,
    });

    const initialResponseMessage = initialResponse.choices[0].message;
    let toolOutput;

    if (
      !initialResponseMessage.tool_calls ||
      initialResponseMessage.tool_calls.length === 0
    ) {
      toolOutput = await execute_db_search(
        smartKeywords,
        intent === "HIGH" ? 50 : 30,
        detectedCategory,
        priceRange,
        storeName
      );
      responseHistory.push(
        { role: "assistant", content: "" },
        {
          role: "tool",
          tool_call_id: "fallback",
          name: "search_products",
          content: toolOutput,
        }
      );
    } else {
      const toolCall = initialResponseMessage.tool_calls[0];
      const functionArgs = JSON.parse(toolCall.function.arguments);
      toolOutput = await execute_db_search(
        functionArgs.keywords,
        functionArgs.max_results,
        functionArgs.category || detectedCategory,
        priceRange,
        functionArgs.store_name || storeName
      );
      responseHistory.push(initialResponseMessage, {
        role: "tool",
        tool_call_id: toolCall.id,
        name: "search_products",
        content: toolOutput,
      });
    }

    const productCount = intent === "MEDIUM" ? 30 : 50;
    const lastToolResponse = responseHistory[responseHistory.length - 1];
    let allProducts = [];
    try {
      allProducts = JSON.parse(lastToolResponse.content);
      if (allProducts.error) throw new Error(allProducts.error);
    } catch (e) {
      return res.status(500).json({ error: "Failed to retrieve products." });
    }

    const finalStoreName =
      initialResponse.choices[0].message.tool_calls &&
      initialResponse.choices[0].message.tool_calls.length > 0
        ? JSON.parse(
            initialResponse.choices[0].message.tool_calls[0].function.arguments
          ).store_name || storeName
        : storeName;

    // --- FILTER & RANK (IN_STOCK only) ---
    const { products: filteredProducts, outOfStockFound } =
      filterAndRankProducts(
        allProducts,
        message,
        productCount,
        detectedCategory,
        priceRange,
        finalStoreName
      );

    const categoryName = detectedCategory
      ? detectedCategory.replace("_", " ")
      : "products";
    let finalSystemPrompt = "";

    // --- STRICT RULES FOR RESPONSE ---
    if (filteredProducts.length === 0) {
      if (outOfStockFound) {
        // Case 1: Items matched keywords but were Out Of Stock
        finalSystemPrompt = `You are Omnia AI.
            The user searched for "${message}".
            We found matching products ${
              finalStoreName ? `for store ${finalStoreName}` : ""
            }, BUT **ALL of them are currently OUT OF STOCK**.
            
            Create a JSON response with:
            1. An empty "products" array (Do NOT invent products).
            2. A "message" containing a polite 2-line apology stating that the requested item is currently out of stock.
            
            {
              "message": "I apologize, but...",
              "intent_level": "${intent}",
              "products": []
            }`;
      } else {
        // Case 2: No items matched at all
        finalSystemPrompt = `You are Omnia AI.
            The user searched for "${message}".
            We could not find any products matching this query in our database.
            
            Create a JSON response with:
            1. An empty "products" array.
            2. A "message" stating we couldn't find what they are looking for.
            
            {
              "message": "I couldn't find any products...",
              "intent_level": "${intent}",
              "products": []
            }`;
      }
    } else {
      // Case 3: Success (In Stock items found)
      finalSystemPrompt = `You are Omnia AI for Kuwait electronics.
      
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
      - "product_description": Write a detailed 4-5 line paragraph highlighting the technical specifications (Processor, RAM, Storage, Screen, Battery, etc.). 
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
            "product_description": "Detailed 4-5 line specs paragraph..." 
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
          db_description: p.description, // Passing scraped description for LLM usage
        }))
      )}`;
    }

    const finalResponse = await openai.chat.completions.create({
      model: "gpt-5.1-2025-11-13",
      messages: [
        { role: "system", content: finalSystemPrompt },
        { role: "user", content: "Create JSON" },
      ],
      response_format: { type: "json_object" },
    });

    const finalContent = finalResponse.choices[0].message.content;
    const parsedJson = JSON.parse(finalContent);

    responseHistory.push({ role: "assistant", content: finalContent });

    res.json({
      reply: JSON.stringify(parsedJson, null, 2),
      history: [...history, ...responseHistory],
      intent,
      category: detectedCategory,
      productCount: parsedJson.products ? parsedJson.products.length : 0,
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "An error occurred." });
  }
});

app.get("/health", (req, res) =>
  res.json({ status: "ok", message: "Shopping assistant running" })
);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
