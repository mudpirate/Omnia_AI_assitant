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
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));

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
      "iphone",
      "samsung",
      "galaxy",
      "android",
      "ios",
    ],
    brands: [
      "apple",
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
      "speaker",
      "tablet",
      "tab",
      "controller",
      "microphone",
      "mic",
      "watch",
      "smartwatch",
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
    ],
  },
  HEADPHONE: {
    name: "headphone",
    keywords: [
      "headphone",
      "headphones",
      "earphone",
      "earphones",
      "earbuds",
      "headset",
      "airpods",
      "earpods",
      "tws",
      "wireless earbuds",
      "bluetooth headphones",
      "gaming headset",
      "over-ear",
      "in-ear",
    ],
    brands: [
      "sony",
      "bose",
      "jbl",
      "apple",
      "samsung",
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
    ],
    specs: [
      "wireless",
      "bluetooth",
      "noise cancelling",
      "anc",
      "bass",
      "mic",
      "microphone",
      "tws",
      "true wireless",
      "battery",
      "playtime",
      "hours",
      "driver",
      "mm",
    ],
    exclude: [
      "case",
      "pouch",
      "stand",
      "holder",
      "adapter",
      "cable only",
      "replacement pads",
      "cushion",
      "foam tips",
    ],
  },
};

// Terms that strongly indicate accessories/earbuds
const ACCESSORY_TERMS = [
  "earbud",
  "earbuds",
  "earphone",
  "earphones",
  "in-ear",
  "tws",
  "airpods",
  "earpod",
  "wireless earbuds",
  "wireless in-ear",
  "true wireless",
  "headphone",
  "headphones",
  "charger",
  "case",
  "cover",
  "protector",
  "tempered glass",
  "screen guard",
  "cable",
  "adapter",
];

// Mobile title signals (at least one required for mobile queries)
const MOBILE_SIGNALS = [
  "phone",
  "smartphone",
  "mobile",
  "galaxy",
  "iphone",
  "pixel",
  "note",
  "redmi",
  "mi ",
  "oneplus",
  "nokia",
  "moto",
  "vivo",
  "oppo",
  "realme",
  "itel",
  "infinix",
  "tecno",
  "android",
  "ios",
];

// helper: build Prisma-insensitive 'contains' filters array
function containsFiltersFor(field, words) {
  return words.map((w) => ({ [field]: { contains: w, mode: "insensitive" } }));
}

// --- CATEGORY DETECTION ---
function detectProductCategory(userMessage) {
  const msg = userMessage.toLowerCase().trim();

  // EARLY GUARD: If the user explicitly mentions android / smartphone variants,
  // treat it as a mobile_phone query only.
  const mobileForcePattern =
    /\b(android|smartphone|smart phone|smart-phone|android phone|androids)\b/i;
  if (mobileForcePattern.test(msg)) {
    console.log(
      `[Category Detection] Forced mobile_phone due to explicit 'android'/'smartphone' mention.`
    );
    return "mobile_phone";
  }

  let categoryScores = {
    mobile_phone: 0,
    laptop: 0,
    headphone: 0,
  };

  // Score each category
  Object.entries(PRODUCT_CATEGORIES).forEach(([key, category]) => {
    // Check keywords
    category.keywords.forEach((keyword) => {
      if (msg.includes(keyword)) {
        categoryScores[category.name] += 10;
      }
    });

    // Check brands
    category.brands.forEach((brand) => {
      if (msg.includes(brand)) {
        categoryScores[category.name] += 5;
      }
    });

    // Check specs
    category.specs.forEach((spec) => {
      if (msg.includes(spec)) {
        categoryScores[category.name] += 3;
      }
    });
  });

  // Find highest scoring category
  const detectedCategory = Object.entries(categoryScores).reduce(
    (max, [cat, score]) => {
      return score > max.score ? { category: cat, score } : max;
    },
    { category: null, score: 0 }
  );

  console.log(`[Category Detection] Scores:`, categoryScores);
  console.log(
    `[Category Detection] Detected: ${detectedCategory.category} (score: ${detectedCategory.score})`
  );

  return detectedCategory.score > 0 ? detectedCategory.category : null;
}

// --- ENHANCED KEYWORD EXTRACTION ---
function extractSmartKeywords(userMessage, detectedCategory) {
  const msg = userMessage.toLowerCase().trim();
  const keywords = [];

  if (!detectedCategory) {
    // Fallback to generic extraction
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

  // Add primary category keywords
  keywords.push(category.keywords[0]); // Main keyword (phone, laptop, headphone)

  // Extract brand
  category.brands.forEach((brand) => {
    if (msg.includes(brand)) {
      keywords.push(brand);
    }
  });

  // Extract model numbers (iPhone 17, Galaxy S23, etc.)
  const modelMatch = msg.match(/\b(\d+)\b/g);
  if (modelMatch) {
    modelMatch.forEach((num) => keywords.push(num));
  }

  // Extract variants (Pro, Max, Plus, Ultra, etc.)
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
  ];
  variants.forEach((variant) => {
    if (msg.includes(variant)) {
      keywords.push(variant);
    }
  });

  // Extract storage/RAM
  const storageMatch = msg.match(/(\d+)(gb|tb)/gi);
  if (storageMatch) {
    storageMatch.forEach((s) => keywords.push(s.toLowerCase()));
  }

  // Extract processor for laptops
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
      if (msg.includes(proc)) {
        keywords.push(proc);
      }
    });
  }

  // If we have very few keywords, add some specs
  if (keywords.length < 3) {
    category.specs.forEach((spec) => {
      if (msg.includes(spec) && keywords.length < 5) {
        keywords.push(spec);
      }
    });
  }

  console.log(
    `[Keyword Extraction] Category: ${detectedCategory}, Keywords: ${keywords.join(
      ", "
    )}`
  );

  return keywords.length > 0 ? keywords : [category.keywords[0]];
}

// --- DATABASE SEARCH WITH CATEGORY FILTERING ---
async function execute_db_search(keywords, max_results, category = null) {
  console.log(
    `[DB Search] Keywords: ${keywords.join(", ")}, Category: ${
      category || "any"
    }`
  );

  // Clean keywords
  const cleanedKeywords = keywords
    .map((k) => k.trim())
    .filter(
      (k) =>
        k.length > 0 &&
        !["cheapest", "cheap", "budget", "best", "the", "kwd"].includes(
          k.toLowerCase()
        )
    );

  if (cleanedKeywords.length === 0) {
    console.warn("[DB Search] No valid keywords after cleaning");
    return JSON.stringify([]);
  }

  // Get exclusion list for the detected category
  let excludeTerms = [];
  if (category) {
    const categoryConfig = Object.values(PRODUCT_CATEGORIES).find(
      (c) => c.name === category
    );
    if (categoryConfig) {
      excludeTerms = categoryConfig.exclude;
    }
  }

  try {
    // Build search conditions with category filtering
    const searchConditions = [];

    // Strategy 1: Match ALL keywords + exclude accessories
    if (cleanedKeywords.length >= 2) {
      const andFilters = cleanedKeywords.map((keyword) => ({
        OR: [
          { title: { contains: keyword, mode: "insensitive" } },
          { category: { contains: keyword, mode: "insensitive" } },
        ],
      }));

      // Add exclusion filters (without mode in NOT clause)
      if (excludeTerms.length > 0) {
        excludeTerms.forEach((term) => {
          andFilters.push({
            NOT: {
              title: { contains: term, mode: "insensitive" },
            },
          });
        });
      }

      searchConditions.push({ AND: andFilters });
    }

    // Strategy 2: Match ANY keyword + exclude accessories
    const orFilters = cleanedKeywords.flatMap((keyword) => [
      { title: { contains: keyword, mode: "insensitive" } },
      { category: { contains: keyword, mode: "insensitive" } },
    ]);

    if (excludeTerms.length > 0) {
      const excludeFilters = excludeTerms.map((term) => ({
        NOT: {
          title: { contains: term, mode: "insensitive" },
        },
      }));

      searchConditions.push({
        AND: [{ OR: orFilters }, ...excludeFilters],
      });
    } else {
      searchConditions.push({ OR: orFilters });
    }

    // --- NEW: Strong mobile-only constraints to avoid earphone matches ---
    // When the detected category is mobile_phone, require a mobile signal in results
    if (category === "mobile_phone") {
      const mobileTitleOrCategoryFilters = [
        ...containsFiltersFor("title", MOBILE_SIGNALS),
        ...containsFiltersFor("category", ["phone", "mobile", "smartphone"]),
      ];

      // Construct a filter that requires at least one mobile signal
      // We'll add it as an AND constraint to the main search conditions below.
      // Also add accessory exclusions (earbuds/headphones)
      const accessoryNotFilters = ACCESSORY_TERMS.map((term) => ({
        NOT: { title: { contains: term, mode: "insensitive" } },
      }));

      // Apply to existing strategies: for each existing whereCondition, wrap with AND [mobileSignal OR categoryContainsPhone] + accessory NOTs
      const enhancedConditions = [];
      for (const baseCond of searchConditions) {
        enhancedConditions.push({
          AND: [
            baseCond,
            { OR: mobileTitleOrCategoryFilters },
            ...accessoryNotFilters,
          ],
        });
      }

      // If no strategies existed (cleanedKeywords < 2 was false), still push a mobile-signal fallback
      if (enhancedConditions.length === 0) {
        enhancedConditions.push({
          AND: [{ OR: mobileTitleOrCategoryFilters }, ...accessoryNotFilters],
        });
      }

      // Replace searchConditions with enhancedConditions
      searchConditions.length = 0;
      searchConditions.push(...enhancedConditions);
    }

    let results = [];

    // Try each search strategy
    for (const whereCondition of searchConditions) {
      console.log(`[DB Search] Trying search strategy...`);

      results = await prisma.product.findMany({
        where: whereCondition,
        select: {
          title: true,
          price: true,
          storeName: true,
          productUrl: true,
          category: true,
          imageUrl: true,
        },
        orderBy: {
          price: "desc", // descending so premium products appear first
        },
        take: Math.min(max_results, 100),
      });

      if (results.length > 0) {
        console.log(`[DB Search] Found ${results.length} products`);
        break;
      }
    }

    // Additional post-filter to ensure quality
    if (category && results.length > 0) {
      const categoryConfig = Object.values(PRODUCT_CATEGORIES).find(
        (c) => c.name === category
      );
      results = results.filter((product) => {
        const title = product.title.toLowerCase();
        // Must NOT contain any excluded terms (general excludes)
        const notExcluded = !categoryConfig.exclude.some((excludeTerm) =>
          title.includes(excludeTerm)
        );
        // If mobile category, also ensure it doesn't look like an accessory
        if (category === "mobile_phone") {
          const looksLikeAccessory = ACCESSORY_TERMS.some((t) =>
            title.includes(t)
          );
          if (looksLikeAccessory) return false;
          // also ensure mobile signal present (title or category)
          const hasMobileSignal =
            MOBILE_SIGNALS.some((s) => title.includes(s)) ||
            (product.category &&
              product.category.toLowerCase().includes("phone"));
          return notExcluded && hasMobileSignal;
        }
        return notExcluded;
      });
      console.log(
        `[DB Search] After post-filtering: ${results.length} products`
      );
    }

    if (results.length === 0) {
      console.warn("[DB Search] No products found");
    }

    return JSON.stringify(results);
  } catch (dbError) {
    console.error("Prisma DB Error:", dbError);
    return JSON.stringify({
      error: "Database search failed.",
    });
  }
}

// --- INTENT CLASSIFICATION ---
async function classifyIntent(userMessage) {
  const msg = userMessage.toLowerCase();

  // Fast path: Specific model = HIGH
  const hasSpecificModel =
    /\b(iphone|galaxy|pixel)\s*\d+/i.test(msg) ||
    /\b\d+gb\b/i.test(msg) ||
    /(pro max|pro|plus|ultra|fold|flip)/i.test(msg);

  const hasBrandAndType =
    /(samsung|apple|iphone|dell|hp|sony|bose).*(phone|laptop|headphone)/i.test(
      msg
    ) ||
    /(phone|laptop|headphone).*(samsung|apple|iphone|dell|hp|sony|bose)/i.test(
      msg
    );

  const isGeneral =
    /what|how|which|tell me|recommend|advice|trend|should i|best for/i.test(
      msg
    ) && !hasSpecificModel;

  if (isGeneral && !hasSpecificModel) {
    console.log("[Intent] LOW (general question)");
    return "LOW";
  }

  if (hasSpecificModel) {
    console.log("[Intent] HIGH (specific model)");
    return "HIGH";
  }

  if (hasBrandAndType) {
    console.log("[Intent] MEDIUM (brand + type)");
    return "MEDIUM";
  }

  // Default to MEDIUM for shopping queries
  return "MEDIUM";
}

// --- SMART PRODUCT FILTERING ---
function filterAndRankProducts(products, userQuery, productCount, category) {
  const query = userQuery.toLowerCase();
  const hasCheapest =
    query.includes("cheapest") ||
    query.includes("cheap") ||
    query.includes("budget");

  // Get category config
  let categoryConfig = null;
  if (category) {
    categoryConfig = Object.values(PRODUCT_CATEGORIES).find(
      (c) => c.name === category
    );
  }

  // Final safety filter: Remove accessories
  let filteredProducts = products;
  if (categoryConfig) {
    filteredProducts = products.filter((product) => {
      const title = product.title.toLowerCase();
      return !categoryConfig.exclude.some((excludeTerm) =>
        title.includes(excludeTerm)
      );
    });
  }

  // Score each product
  const scoredProducts = filteredProducts.map((product) => {
    let score = 0;
    const title = product.title.toLowerCase();
    const queryWords = query.split(/\s+/).filter((w) => w.length > 2);

    // If category is mobile_phone, strongly demote accessory-like items
    if (category === "mobile_phone") {
      const looksLikeAccessory = ACCESSORY_TERMS.some((t) => title.includes(t));
      if (looksLikeAccessory) {
        // heavy negative to push them out
        score -= 10000;
      }
    }

    // Exact phrase match
    if (title.includes(query)) score += 100;

    // Keyword matching
    queryWords.forEach((word) => {
      if (title.includes(word)) score += 10;
    });

    // Model number matching
    const modelMatch = query.match(/\d+/g);
    if (modelMatch) {
      modelMatch.forEach((num) => {
        if (title.includes(num)) score += 50;
      });
    }

    // Brand bonus
    if (categoryConfig) {
      categoryConfig.brands.forEach((brand) => {
        if (query.includes(brand) && title.includes(brand)) {
          score += 30;
        }
      });
    }

    // Mobile signal bonus (when category is mobile_phone)
    if (category === "mobile_phone") {
      if (MOBILE_SIGNALS.some((s) => title.includes(s))) score += 40;
    }

    // Price factor for budget queries
    if (hasCheapest) {
      score += (1000 - product.price) / 10;
    }

    return { ...product, score };
  });

  // Sort by score, then price (descending priority of score, then price ascending for ties or descending if you prefer premium first)
  scoredProducts.sort((a, b) => {
    if (Math.abs(a.score - b.score) > 5) return b.score - a.score;
    // If both scores are equal, prefer higher price (premium first)
    return b.price - a.price;
  });

  // Ensure store diversity
  const selectedProducts = [];
  const storeCount = { xcite: 0, jarir: 0, "best.kw": 0 };
  const maxPerStore = Math.ceil(productCount / 3);

  // First pass: diversity
  for (const product of scoredProducts) {
    const storeName = product.storeName ? product.storeName.toLowerCase() : "";
    const storeKey = storeName.includes("xcite")
      ? "xcite"
      : storeName.includes("jarir")
      ? "jarir"
      : "best.kw";

    if (
      storeCount[storeKey] < maxPerStore &&
      selectedProducts.length < productCount &&
      product.score > -9999 // avoid accessory-demoted items
    ) {
      selectedProducts.push(product);
      storeCount[storeKey]++;
    }
  }

  // Second pass: fill remaining slots
  for (const product of scoredProducts) {
    if (
      !selectedProducts.includes(product) &&
      selectedProducts.length < productCount &&
      product.score > -9999
    ) {
      selectedProducts.push(product);
    }
  }

  console.log(
    `[Filtering] Selected ${selectedProducts.length}/${productCount} products`
  );

  return selectedProducts.slice(0, productCount);
}

// --- MESSAGE CREATION ---
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

// --- TOOL SCHEMA ---
const product_search_tool_schema = {
  type: "function",
  function: {
    name: "search_products",
    description:
      "Searches the product database. Extract precise keywords matching the detected category.",
    parameters: {
      type: "object",
      properties: {
        keywords: {
          type: "array",
          description:
            "Search keywords including brand, model, specs. For phones: ['iPhone', '17', 'Pro']. For laptops: ['Dell', 'gaming', 'laptop']. For headphones: ['Sony', 'wireless', 'headphone'].",
          items: { type: "string" },
        },
        max_results: {
          type: "integer",
          description: "60 for MEDIUM intent, 80 for HIGH intent.",
          default: 80,
        },
        category: {
          type: "string",
          enum: ["mobile_phone", "laptop", "headphone"],
          description: "Detected product category for filtering.",
        },
      },
      required: ["keywords", "max_results"],
    },
  },
};

// --- MAIN CHAT ROUTE ---
app.post("/chat", async (req, res) => {
  const { query: message, history = [] } = req.body;

  if (!message) {
    return res.status(400).json({ error: "Message is required." });
  }

  const userMessageObject = { role: "user", content: message };
  const responseHistory = [userMessageObject];

  try {
    // STEP 1: Detect Category
    console.log("[Step 1] Detecting product category...");
    const detectedCategory = detectProductCategory(message);

    // STEP 2: Classify Intent
    console.log("[Step 2] Classifying intent...");
    const intent = await classifyIntent(message);

    // STEP 3: Handle LOW Intent
    if (intent === "LOW") {
      console.log("[Step 3] LOW intent - General response");
      const lowIntentSystem = `You are Omnia AI, a shopping assistant for Kuwait electronics (Xcite, Jarir, Best.kw, Noon.kw).
Provide helpful, friendly advice about shopping or product categories. Keep it under 150 words.`;

      const lowIntentMessages = createLlmMessages(message, lowIntentSystem);
      const lowIntentResponse = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: lowIntentMessages,
        temperature: 0.5,
        max_tokens: 250,
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

    // STEP 4: Extract Keywords
    console.log("[Step 4] Extracting keywords...");
    const smartKeywords = extractSmartKeywords(message, detectedCategory);

    const searchSystemPrompt = `You are a keyword extraction expert.

User Query: "${message}"
Detected Category: ${detectedCategory || "unknown"}
Suggested Keywords: ${smartKeywords.join(", ")}

Extract the BEST search keywords. Include:
- Product category (phone/laptop/headphone)
- Brand name
- Model number/name
- Specifications (storage, RAM, etc.)

NEVER include: 'cheapest', 'best', 'under X KWD'

Set category to "${detectedCategory || "mobile_phone"}"
Set max_results to ${intent === "HIGH" ? "60" : "40"}`;

    const searchMessages = createLlmMessages(message, searchSystemPrompt);

    let initialResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: searchMessages,
      tools: [product_search_tool_schema],
      tool_choice: { type: "function", function: { name: "search_products" } },
      temperature: 0.2,
    });

    const initialResponseMessage = initialResponse.choices[0].message;

    // STEP 5: Execute Search
    console.log("[Step 5] Executing search...");

    let toolOutput;
    if (
      !initialResponseMessage.tool_calls ||
      initialResponseMessage.tool_calls.length === 0
    ) {
      // Fallback
      toolOutput = await execute_db_search(
        smartKeywords,
        intent === "HIGH" ? 60 : 40,
        detectedCategory
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

      console.log(
        `[Tool Args] Keywords: ${JSON.stringify(
          functionArgs.keywords
        )}, Category: ${functionArgs.category || detectedCategory}`
      );

      toolOutput = await execute_db_search(
        functionArgs.keywords,
        functionArgs.max_results,
        functionArgs.category || detectedCategory
      );

      responseHistory.push(initialResponseMessage, {
        role: "tool",
        tool_call_id: toolCall.id,
        name: "search_products",
        content: toolOutput,
      });
    }

    // STEP 6: Filter and Generate Response
    console.log("[Step 6] Generating final response...");

    const productCount = intent === "MEDIUM" ? 9 : 13;
    const lastToolResponse = responseHistory[responseHistory.length - 1];

    let allProducts = [];
    try {
      allProducts = JSON.parse(lastToolResponse.content);
      if (allProducts.error) throw new Error(allProducts.error);
    } catch (e) {
      console.error("[Error] Failed to parse products:", e.message);
      return res
        .status(500)
        .json({ error: "Failed to retrieve products.", details: e.message });
    }

    const filteredProducts = filterAndRankProducts(
      allProducts,
      message,
      productCount,
      detectedCategory
    );

    const categoryName = detectedCategory
      ? detectedCategory.replace("_", " ")
      : "products";

    const finalSystemPrompt = `You are Omnia AI for Kuwait electronics (Xcite, Jarir, Best.kw, Noon.kw).

**USER QUERY**: "${message}"
**CATEGORY**: ${categoryName}
**INTENT**: ${intent}
**PRODUCTS**: ${filteredProducts.length} pre-filtered ${categoryName}

Create JSON with EXACTLY ${productCount} products.

{
  "message": "Friendly 2-3 sentence intro",
  "intent_level": "${intent}",
  "products": [
    {
      "product_name": "from title",
      "store_name": "exact store name",
      "price_kwd": number,
      "product_url": "exact URL",
      "image_url": "exact image URL",
      "spec_highlights": ["1-2 key specs"]
    }
  ],
  "disclaimer": "if needed"
}

Products:
${JSON.stringify(
  filteredProducts.map((p) => ({
    title: p.title,
    price: p.price,
    storeName: p.storeName,
    productUrl: p.productUrl,
    imageUrl: p.imageUrl,
  })),
  null,
  2
)}`;

    const finalMessages = [
      { role: "system", content: finalSystemPrompt },
      { role: "user", content: `Create JSON for: "${message}"` },
    ];

    const finalResponse = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: finalMessages,
      temperature: 0.3,
      response_format: { type: "json_object" },
    });

    const finalContent = finalResponse.choices[0].message.content;
    const parsedJson = JSON.parse(finalContent);

    if (!parsedJson.products || !Array.isArray(parsedJson.products)) {
      throw new Error("Invalid products array");
    }

    console.log(
      `[Success] Generated ${parsedJson.products.length} ${categoryName}`
    );

    responseHistory.push({ role: "assistant", content: finalContent });

    res.json({
      reply: JSON.stringify(parsedJson, null, 2),
      history: [...history, ...responseHistory],
      intent,
      category: detectedCategory,
      productCount: parsedJson.products.length,
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({
      error: "An error occurred.",
      details: error.message,
    });
  }
});

// --- HEALTH CHECK ---
app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "Shopping assistant running" });
});

// --- START SERVER ---
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
