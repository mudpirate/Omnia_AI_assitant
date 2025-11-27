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
// Increase payload limit to handle larger conversation histories
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));

// --- JSON SCHEMA FOR FINAL PRODUCT OUTPUT ---
const PRODUCT_CARDS_SCHEMA = {
  type: "object",
  properties: {
    message: {
      type: "string",
      description:
        "A friendly, conversational introduction and summary of the results.",
    },
    intent_level: {
      type: "string",
      enum: ["MEDIUM", "HIGH"],
    },
    products: {
      type: "array",
      description:
        "A list of product cards. The number of items must exactly match the required product count specified in the system prompt.",
      items: {
        type: "object",
        properties: {
          product_name: { type: "string" },
          store_name: { type: "string" },
          price_kwd: {
            type: "number",
            description: "Price in Kuwaiti Dinar (KWD).",
          },
          product_url: { type: "string", description: "VALID product URL." },
          image_url: { type: "string" },
          spec_highlights: {
            type: "array",
            items: { type: "string" },
            description:
              "1-2 key features (e.g., '512GB Storage', '120Hz Display').",
          },
        },
        required: [
          "product_name",
          "store_name",
          "price_kwd",
          "product_url",
          "spec_highlights",
          "image_url",
        ],
      },
    },
    disclaimer: {
      type: "string",
      description:
        "If the requested product is missing from the results, include a brief explanation.",
    },
  },
  required: ["message", "products", "intent_level"],
};

// --- ENHANCED KEYWORD EXTRACTION ---
function extractSmartKeywords(userMessage) {
  const msg = userMessage.toLowerCase().trim();

  // Extract iPhone model numbers (iPhone 17, iPhone 15 Pro, etc.)
  const iphoneMatch = msg.match(
    /iphone\s*(\d+)\s*(pro|plus|max|pro max|mini)?/i
  );
  if (iphoneMatch) {
    const keywords = ["iphone", "apple"];
    keywords.push(iphoneMatch[1]); // model number
    if (iphoneMatch[2]) {
      keywords.push(iphoneMatch[2].toLowerCase()); // pro/max/plus
    }
    keywords.push("phone", "mobile");
    return keywords;
  }

  // Extract Samsung Galaxy models
  const samsungMatch = msg.match(
    /samsung\s*(galaxy)?\s*([a-z]\d+|[a-z]\s*\d+|fold|flip|note)/i
  );
  if (samsungMatch) {
    const keywords = ["samsung", "phone", "mobile"];
    if (samsungMatch[1]) keywords.push("galaxy");
    if (samsungMatch[2]) keywords.push(samsungMatch[2].replace(/\s/g, ""));
    return keywords;
  }

  // Generic brand + product type extraction
  const brands = [
    "samsung",
    "apple",
    "iphone",
    "xiaomi",
    "huawei",
    "oppo",
    "vivo",
    "oneplus",
    "sony",
    "lg",
    "dell",
    "hp",
    "lenovo",
    "asus",
    "acer",
    "msi",
    "razer",
    "logitech",
    "jbl",
    "bose",
    "airpods",
  ];
  const productTypes = [
    "phone",
    "mobile",
    "smartphone",
    "laptop",
    "notebook",
    "tablet",
    "ipad",
    "headphones",
    "earbuds",
    "earphones",
    "watch",
    "smartwatch",
    "gaming",
    "console",
    "ps5",
    "xbox",
    "keyboard",
    "mouse",
    "monitor",
    "display",
    "tv",
    "television",
    "speaker",
    "soundbar",
    "camera",
    "gopro",
  ];

  const words = msg.split(/\s+/);
  const keywords = [];

  // Extract brands
  brands.forEach((brand) => {
    if (msg.includes(brand)) keywords.push(brand);
  });

  // Extract product types
  productTypes.forEach((type) => {
    if (msg.includes(type)) keywords.push(type);
  });

  // Extract storage (128GB, 256GB, etc.)
  const storageMatch = msg.match(/(\d+)(gb|tb)/gi);
  if (storageMatch) {
    storageMatch.forEach((s) => keywords.push(s.toLowerCase()));
  }

  // If we found very few keywords, add some words from the query
  if (keywords.length < 2) {
    words.forEach((word) => {
      if (
        word.length > 3 &&
        ![
          "cheapest",
          "cheap",
          "best",
          "under",
          "want",
          "need",
          "looking",
        ].includes(word)
      ) {
        keywords.push(word);
      }
    });
  }

  return keywords.length > 0 ? keywords : ["phone", "mobile"];
}

// --- DATABASE TOOL IMPLEMENTATION ---
async function execute_db_search(keywords, max_results) {
  console.log(`[DB Search] Executing query for: ${keywords.join(", ")}`);

  // Clean keywords
  const cleanedKeywords = keywords
    .map((k) => k.trim())
    .filter(
      (k) =>
        k.length > 0 &&
        !["cheapest", "cheap", "budget", "best", "the"].includes(
          k.toLowerCase()
        ) &&
        k.toLowerCase().indexOf("kwd") === -1
    );

  if (cleanedKeywords.length === 0) {
    console.warn("[DB Search] No valid keywords after cleaning");
    return JSON.stringify([]);
  }

  // Build search conditions - prioritize exact matches
  const searchConditions = [];

  // Strategy 1: Try to match ALL keywords (most specific)
  if (cleanedKeywords.length >= 2) {
    const andFilters = cleanedKeywords.map((keyword) => ({
      OR: [
        { title: { contains: keyword, mode: "insensitive" } },
        { category: { contains: keyword, mode: "insensitive" } },
      ],
    }));
    searchConditions.push({ AND: andFilters });
  }

  // Strategy 2: Match ANY keyword (broader)
  const orFilters = cleanedKeywords.flatMap((keyword) => [
    { title: { contains: keyword, mode: "insensitive" } },
    { category: { contains: keyword, mode: "insensitive" } },
  ]);
  searchConditions.push({ OR: orFilters });

  try {
    let results = [];

    // Try each search strategy until we get results
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
          price: "asc",
        },
        take: Math.min(max_results, 100), // Cap at 100 for safety
      });

      if (results.length > 0) {
        console.log(`[DB Search] Found ${results.length} products`);
        break;
      }
    }

    if (results.length === 0) {
      console.warn("[DB Search] No products found with any strategy");
    }

    return JSON.stringify(results);
  } catch (dbError) {
    console.error("Prisma DB Error during search:", dbError);
    return JSON.stringify({
      error: "Database search failed. Could not retrieve product data.",
    });
  }
}

const availableTools = {
  search_products: execute_db_search,
};

// --- TOOL SCHEMA ---
const product_search_tool_schema = {
  type: "function",
  function: {
    name: "search_products",
    description:
      "Searches the product database for items to answer shopping-related queries. Extract precise keywords including brand, model number, and product type.",
    parameters: {
      type: "object",
      properties: {
        keywords: {
          type: "array",
          description:
            "Precise search keywords. CRITICAL RULES: 1) For iPhone queries, ALWAYS include both 'iPhone' AND the model number as separate keywords (e.g., ['iPhone', '17', 'Pro', 'Max']). 2) For Samsung, include ['Samsung', 'Galaxy', model]. 3) ALWAYS include product category ('phone', 'laptop', etc.). 4) Include specifications like storage ('256GB'). 5) Do NOT include: 'cheapest', 'best', 'under X KWD'. Examples: 'iPhone 17 Pro' → ['iPhone', '17', 'Pro', 'phone', 'apple'], 'cheapest Samsung phone' → ['Samsung', 'phone', 'mobile'], 'gaming laptop' → ['gaming', 'laptop']",
          items: { type: "string" },
        },
        max_results: {
          type: "integer",
          description:
            "Number of products to retrieve. Use 40 for MEDIUM intent, 60 for HIGH intent.",
          default: 40,
        },
      },
      required: ["keywords", "max_results"],
    },
  },
};

// --- INTENT CLASSIFICATION ---
async function classifyIntent(userMessage) {
  const msg = userMessage.toLowerCase();

  // Quick heuristics for better classification
  const hasSpecificModel =
    /\b(iphone|galaxy|pixel)\s*\d+/i.test(msg) ||
    /\b\d+gb\b/i.test(msg) ||
    /(pro max|pro|plus|ultra|fold|flip)/i.test(msg);

  const hasBrandAndType =
    /(samsung|apple|iphone).*(phone|mobile|laptop)/i.test(msg) ||
    /(phone|mobile|laptop).*(samsung|apple|iphone)/i.test(msg);

  const isGeneral =
    /what|how|which|tell me|recommend|advice|trend|should i|best for/i.test(
      msg
    ) && !hasSpecificModel;

  // Fast path classification
  if (isGeneral && !hasSpecificModel) {
    console.log("[Intent] Fast path: LOW (general question)");
    return "LOW";
  }

  if (hasSpecificModel) {
    console.log("[Intent] Fast path: HIGH (specific model detected)");
    return "HIGH";
  }

  const intentClassificationPrompt = `Classify this shopping query as LOW, MEDIUM, or HIGH intent:

**LOW**: General advice, browsing, "what should I buy?", comparisons without purchase intent
Examples: "What's a good laptop brand?", "Tell me about gaming consoles", "How to choose headphones?"

**MEDIUM**: Brand OR category mentioned, budget queries, "cheapest X" without specific model
Examples: "cheapest Samsung phone", "iPhone under 200 KWD", "gaming laptops", "wireless earbuds"

**HIGH**: Specific model with details (storage/color/variant) OR exact product name
Examples: "iPhone 17 Pro Max", "Samsung Galaxy S23 Ultra 256GB", "AirPods Pro 2nd gen", "PS5 disc edition"

Query: "${userMessage}"

Consider:
- Specific model mentioned: ${hasSpecificModel ? "YES" : "NO"}
- Brand + type: ${hasBrandAndType ? "YES" : "NO"}

Respond with ONLY: LOW, MEDIUM, or HIGH`;

  try {
    const intentResponse = await openai.chat.completions.create({
      model: "gpt-4o", // Use mini for faster classification
      messages: [
        {
          role: "system",
          content:
            "You are an intent classifier. Respond with ONLY one word: LOW, MEDIUM, or HIGH.",
        },
        { role: "user", content: intentClassificationPrompt },
      ],
      temperature: 0,
      max_tokens: 10,
    });

    const intent = intentResponse.choices[0].message.content
      .trim()
      .toUpperCase();
    console.log(`[Intent Classification] Query classified as: ${intent}`);
    return intent;
  } catch (error) {
    console.error("Error during intent classification:", error.message);
    return hasBrandAndType ? "MEDIUM" : "HIGH";
  }
}

// --- SMART PRODUCT FILTERING ---
function filterAndRankProducts(products, userQuery, productCount) {
  const query = userQuery.toLowerCase();
  const hasCheapest =
    query.includes("cheapest") ||
    query.includes("cheap") ||
    query.includes("budget");

  // Score each product
  const scoredProducts = products.map((product) => {
    let score = 0;
    const title = product.title.toLowerCase();

    // Extract query keywords
    const queryWords = query.split(/\s+/).filter((w) => w.length > 2);

    // Exact match bonus
    if (title.includes(query)) score += 100;

    // Keyword matching
    queryWords.forEach((word) => {
      if (title.includes(word)) score += 10;
    });

    // Model number matching (iPhone 17, S23, etc.)
    const modelMatch = query.match(/\d+/);
    if (modelMatch && title.includes(modelMatch[0])) {
      score += 50;
    }

    // Price factor (lower price = higher score for cheapest queries)
    if (hasCheapest) {
      score += (1000 - product.price) / 10;
    }

    return { ...product, score };
  });

  // Sort by score, then by price
  scoredProducts.sort((a, b) => {
    if (Math.abs(a.score - b.score) > 5) return b.score - a.score;
    return a.price - b.price;
  });

  // Ensure store diversity
  const selectedProducts = [];
  const storeCount = { xcite: 0, jarir: 0, "best.kw": 0 };
  const maxPerStore = Math.ceil(productCount / 3);

  // First pass: pick top products while ensuring diversity
  for (const product of scoredProducts) {
    const storeName = product.storeName.toLowerCase();
    const storeKey = storeName.includes("xcite")
      ? "xcite"
      : storeName.includes("jarir")
      ? "jarir"
      : "best.kw";

    if (
      storeCount[storeKey] < maxPerStore &&
      selectedProducts.length < productCount
    ) {
      selectedProducts.push(product);
      storeCount[storeKey]++;
    }
  }

  // Second pass: fill remaining slots if needed
  if (selectedProducts.length < productCount) {
    for (const product of scoredProducts) {
      if (
        !selectedProducts.includes(product) &&
        selectedProducts.length < productCount
      ) {
        selectedProducts.push(product);
      }
    }
  }

  console.log(
    `[Filtering] Selected ${selectedProducts.length} products from ${
      Object.values(storeCount).filter((c) => c > 0).length
    } stores`
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

  if (initialAssistantMessage) {
    messages.push(initialAssistantMessage);
  }

  toolResponses.forEach((res) => messages.push(res));

  messages.push({ role: "user", content: userMessage });

  return messages;
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
    // --- STEP 1: Classify Intent ---
    console.log("[Step 1] Classifying user intent...");
    const intent = await classifyIntent(message);

    // --- STEP 2: Handle LOW Intent (No DB Search) ---
    if (intent === "LOW") {
      console.log("[Step 2] LOW intent detected - Generating general response");
      const lowIntentSystem = `You are Omnia AI, an AI Shopping Assistant based in Kuwait specializing in electronics from Xcite, Jarir, and Best.kw stores.

The user has a general shopping question. Provide helpful, friendly advice about shopping, product categories, or buying tips.

Keep your response conversational, informative, and under 150 words. Do NOT mention specific products, prices, or models.`;

      const lowIntentMessages = createLlmMessages(message, lowIntentSystem);

      const lowIntentResponse = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: lowIntentMessages,
        temperature: 0.7,
        max_tokens: 250,
      });

      const finalContent = lowIntentResponse.choices[0].message.content;
      responseHistory.push({ role: "assistant", content: finalContent });

      return res.json({
        reply: finalContent,
        history: [...history, ...responseHistory],
        intent: "LOW",
      });
    }

    // --- STEP 3: Extract Keywords and Search ---
    console.log(`[Step 3] ${intent} intent - Extracting keywords`);

    const smartKeywords = extractSmartKeywords(message);
    console.log(`[Keywords] Extracted: ${smartKeywords.join(", ")}`);

    const searchSystemPrompt = `You are a keyword extraction expert for product search.

User Query: "${message}"
Suggested Keywords: ${smartKeywords.join(", ")}

Your task: Extract the BEST search keywords from the user query.

**CRITICAL RULES**:
1. For iPhone queries: MUST include ['iPhone', MODEL_NUMBER] as separate items. Example: "iPhone 17" → ['iPhone', '17']
2. For Samsung: Include ['Samsung', 'Galaxy', model] 
3. ALWAYS include product type: 'phone', 'laptop', 'headphones', etc.
4. Include specific specs: storage ('256GB'), variant ('Pro', 'Max')
5. NEVER include: 'cheapest', 'best', 'under X KWD', 'the'

Use the suggested keywords as a starting point and improve them.

Set max_results to ${intent === "HIGH" ? "60" : "40"}.

Output ONLY the tool call.`;

    const searchMessages = createLlmMessages(message, searchSystemPrompt);

    let initialResponse = await openai.chat.completions.create({
      model: "gpt-4o", // Use mini for faster keyword extraction
      messages: searchMessages,
      tools: [product_search_tool_schema],
      tool_choice: { type: "function", function: { name: "search_products" } },
      temperature: 0,
    });

    const initialResponseMessage = initialResponse.choices[0].message;

    // --- STEP 4: Execute Tool Call ---
    if (
      !initialResponseMessage.tool_calls ||
      initialResponseMessage.tool_calls.length === 0
    ) {
      console.log(
        "[Warning] No tool call generated, using smart keywords directly"
      );

      // Fallback: use smart keywords directly
      const fallbackResults = await execute_db_search(
        smartKeywords,
        intent === "HIGH" ? 60 : 40
      );

      const toolResponse = {
        role: "tool",
        tool_call_id: "fallback",
        name: "search_products",
        content: fallbackResults,
      };

      responseHistory.push({ role: "assistant", content: "" }, toolResponse);
    } else {
      console.log(`[Step 4] Executing product search...`);

      const toolCall = initialResponseMessage.tool_calls[0];
      const functionArgs = JSON.parse(toolCall.function.arguments);

      console.log(
        `[DB Query] Keywords: ${JSON.stringify(functionArgs.keywords)}, Max: ${
          functionArgs.max_results
        }`
      );

      const toolOutput = await execute_db_search(
        functionArgs.keywords,
        functionArgs.max_results
      );

      const toolResponse = {
        role: "tool",
        tool_call_id: toolCall.id,
        name: "search_products",
        content: toolOutput,
      };

      responseHistory.push(initialResponseMessage, toolResponse);
    }

    // --- STEP 5: Filter Products and Generate Response ---
    console.log("[Step 5] Filtering products and generating response...");

    const productCount = intent === "MEDIUM" ? 6 : 10;

    // Parse the tool output
    const lastToolResponse = responseHistory[responseHistory.length - 1];
    let allProducts = [];
    try {
      allProducts = JSON.parse(lastToolResponse.content);
      if (allProducts.error) {
        throw new Error(allProducts.error);
      }
    } catch (e) {
      console.error("[Error] Failed to parse product data:", e.message);
      return res.status(500).json({
        error: "Failed to retrieve products from database.",
        details: e.message,
      });
    }

    console.log(
      `[Filtering] Got ${allProducts.length} raw products, filtering to ${productCount}...`
    );

    // Filter and rank products
    const filteredProducts = filterAndRankProducts(
      allProducts,
      message,
      productCount
    );

    // Create a condensed version for LLM
    const condensedProducts = filteredProducts.map((p) => ({
      title: p.title,
      price: p.price,
      storeName: p.storeName,
      productUrl: p.productUrl,
      imageUrl: p.imageUrl,
      category: p.category,
    }));

    const finalSystemPrompt = `You are Omnia AI, an AI Shopping Assistant for Kuwait's electronics stores: Xcite, Jarir, and Best.kw.

**USER QUERY**: "${message}"
**INTENT**: ${intent}
**PRODUCTS PROVIDED**: ${filteredProducts.length} pre-filtered products

**YOUR TASK**: Create a JSON response with EXACTLY ${productCount} products.

**CRITICAL RULES**:
1. Use ALL ${
      filteredProducts.length
    } products provided (they're already filtered for diversity)
2. If fewer than ${productCount} products available, use what you have and add a disclaimer
3. Extract 1-2 spec_highlights from each product title
4. Write a friendly 2-3 sentence message acknowledging the query
5. Ensure store diversity is maintained (products are pre-filtered for this)

**JSON STRUCTURE**:
{
  "message": "Friendly intro mentioning the query and that you found products across stores",
  "intent_level": "${intent}",
  "products": [
    {
      "product_name": "Extracted from title",
      "store_name": "Exact store name from data",
      "price_kwd": price_value,
      "product_url": "exact URL from data",
      "image_url": "exact image URL from data",
      "spec_highlights": ["1-2 key specs from title"]
    }
  ],
  "disclaimer": "Only if product count < ${productCount} or specific model not found"
}

Products to use:
${JSON.stringify(condensedProducts, null, 2)}`;

    const finalMessages = [
      { role: "system", content: finalSystemPrompt },
      { role: "user", content: `Create the JSON response for: "${message}"` },
    ];

    let finalResponse = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: finalMessages,
      temperature: 0.2,
      response_format: { type: "json_object" },
    });

    const finalContent = finalResponse.choices[0].message.content;

    // Validate JSON
    let parsedJson;
    try {
      parsedJson = JSON.parse(finalContent);

      if (!parsedJson.products || !Array.isArray(parsedJson.products)) {
        throw new Error("Invalid products array");
      }

      const stores = new Set(parsedJson.products.map((p) => p.store_name));
      console.log(
        `[Success] Generated ${parsedJson.products.length} products from ${
          stores.size
        } stores: ${Array.from(stores).join(", ")}`
      );
    } catch (e) {
      console.error("JSON validation failed:", e.message);
      throw new Error("AI failed to generate valid JSON output.");
    }

    const finalReply = JSON.stringify(parsedJson, null, 2);
    responseHistory.push({ role: "assistant", content: finalContent });

    res.json({
      reply: finalReply,
      history: [...history, ...responseHistory],
      intent,
      productCount: parsedJson.products.length,
      storesRepresented: Array.from(
        new Set(parsedJson.products.map((p) => p.store_name))
      ),
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({
      error: "An error occurred while processing your request.",
      details: error.message,
    });
  }
});

// --- HEALTH CHECK ---
app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "Shopping assistant is running" });
});

// --- START SERVER ---
app.listen(PORT, () => {
  console.log(`Server listening at http://localhost:${PORT}`);
  console.log(`Ensure your OPENAI_API_KEY is set in .env`);
});
