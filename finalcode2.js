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
const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ limit: "20mb", extended: true }));

// -------------------- REDIS MEMORY --------------------
async function saveToMemory(sessionId, role, content) {
  const key = `chat:${sessionId}`;
  const message = JSON.stringify({ role, content });
  await redis.rpush(key, message);
  await redis.ltrim(key, -20, -1);
  await redis.expire(key, 86400);
}

async function getMemory(sessionId) {
  const key = `chat:${sessionId}`;
  const rawHistory = await redis.lrange(key, 0, -1);
  return rawHistory.map((item) => JSON.parse(item));
}

// -------------------- TOOL DEFINITIONS --------------------
const TOOLS = [
  {
    type: "function",
    function: {
      name: "search_product_database",
      description:
        "Search the product database for electronics (phones, laptops, tablets, headphones, etc.). Use this when user asks about specific products, prices, or wants to buy something. Returns relevant products from local stores in Kuwait.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "The refined search query for products (e.g., 'iPhone 15 Pro Max', 'gaming laptops under 500 KWD', 'Samsung Galaxy S24')",
          },
          category: {
            type: "string",
            enum: [
              "mobile_phone",
              "laptop",
              "tablet",
              "headphone",
              "earphone",
              "desktop",
              "all",
            ],
            description: "Product category to narrow search",
          },
          max_price: {
            type: "number",
            description: "Maximum price in KWD (optional)",
          },
          min_price: {
            type: "number",
            description: "Minimum price in KWD (optional)",
          },
          store_name: {
            type: "string",
            enum: ["xcite", "best.kw", "noon.kw", "jarir", "eureka", "all"],
            description: "Specific store to search in (optional)",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_web",
      description:
        "Search the web for current information, trends, news, reviews, or general knowledge not in the product database. Use this for questions about latest tech trends, product comparisons, reviews, or general electronics information.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "The web search query (e.g., 'best phones 2024', 'iPhone 16 vs Samsung S24', 'latest laptop trends')",
          },
        },
        required: ["query"],
      },
    },
  },
];

// -------------------- HYBRID SEARCH IMPLEMENTATION --------------------

// Generate embedding vector
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

// HNSW Vector Search (Semantic)
async function vectorSearch(vectorLiteral, limit = 50) {
  console.log(`[Vector Search] Using HNSW index...`);
  const query = `
    SELECT
      "title", "price", "storeName", "productUrl", "category",
      "imageUrl", "stock", "description", "brand", "specs",
      1 - ("descriptionEmbedding" <=> '${vectorLiteral}'::vector) as similarity
    FROM "Product"
    WHERE "descriptionEmbedding" IS NOT NULL
      AND "stock" = 'IN_STOCK'
    ORDER BY "descriptionEmbedding" <=> '${vectorLiteral}'::vector ASC
    LIMIT ${limit};
  `;
  return await prisma.$queryRawUnsafe(query);
}

// GIN Full-Text Search (Keyword) - Using searchKey field
async function fulltextSearch(searchQuery, limit = 50) {
  console.log(`[Fulltext Search] Using GIN index on searchKey...`);

  // Use trigram similarity for fuzzy matching
  const searchTerm = searchQuery.toLowerCase().trim();

  if (!searchTerm) return [];

  try {
    // Using pg_trgm similarity search on searchKey field
    return await prisma.$queryRaw`
      SELECT
        "title", "price", "storeName", "productUrl", "category",
        "imageUrl", "stock", "description", "brand", "specs",
        similarity("searchKey", ${searchTerm}) as rank
      FROM "Product"
      WHERE "searchKey" % ${searchTerm}
      ORDER BY rank DESC
      LIMIT ${limit};
    `;
  } catch (error) {
    console.error("[Fulltext Search] Error:", error);
    return [];
  }
}

// Reciprocal Rank Fusion (RRF)
function reciprocalRankFusion(vectorResults, fulltextResults, k = 60) {
  console.log(
    `[RRF] Fusing ${vectorResults.length} vector + ${fulltextResults.length} fulltext results...`
  );

  const scores = new Map();

  // Score vector search results
  vectorResults.forEach((product, index) => {
    const key = product.productUrl || product.title;
    const rrfScore = 1 / (k + index + 1);
    scores.set(key, {
      product,
      score: rrfScore,
      vectorRank: index + 1,
    });
  });

  // Add fulltext search results
  fulltextResults.forEach((product, index) => {
    const key = product.productUrl || product.title;
    const rrfScore = 1 / (k + index + 1);

    if (scores.has(key)) {
      const existing = scores.get(key);
      existing.score += rrfScore;
      existing.fulltextRank = index + 1;
    } else {
      scores.set(key, {
        product,
        score: rrfScore,
        fulltextRank: index + 1,
      });
    }
  });

  // Sort by combined RRF score
  const fusedResults = Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .map((item) => ({
      ...item.product,
      rrfScore: item.score,
      vectorRank: item.vectorRank || null,
      fulltextRank: item.fulltextRank || null,
    }));

  console.log(`[RRF] Fused into ${fusedResults.length} unique results`);
  return fusedResults;
}

// Hybrid Search Function
async function hybridSearch(searchQuery, vectorLiteral, limit = 50) {
  console.log(`[Hybrid Search] Query: "${searchQuery}"`);

  // Run both searches in parallel
  const [vectorResults, fulltextResults] = await Promise.all([
    vectorSearch(vectorLiteral, limit),
    fulltextSearch(searchQuery, limit),
  ]);

  // Fuse results using RRF
  const fusedResults = reciprocalRankFusion(vectorResults, fulltextResults);

  return fusedResults.slice(0, limit);
}

// -------------------- PRODUCT FILTERING --------------------
function filterProducts(products, filters = {}) {
  const { category, minPrice, maxPrice, storeName } = filters;

  return products.filter((product) => {
    // Stock check - using enum StockStatus
    if (product.stock === "OUT_OF_STOCK") {
      return false;
    }

    // Price range
    if (minPrice && product.price < minPrice) return false;
    if (maxPrice && product.price > maxPrice) return false;

    // Store filter - handle enum values (XCITE, BEST_KW, NOON_KW, EUREKA)
    if (storeName && storeName !== "all") {
      const storeMap = {
        xcite: "XCITE",
        "best.kw": "BEST_KW",
        best: "BEST_KW",
        "noon.kw": "NOON_KW",
        noon: "NOON_KW",
        eureka: "EUREKA",
      };
      const enumStore = storeMap[storeName.toLowerCase()];
      if (enumStore && product.storeName !== enumStore) return false;
    }

    // Category filter - handle enum values (MOBILE_PHONE, LAPTOP, etc.)
    if (category && category !== "all") {
      const categoryMap = {
        mobile_phone: "MOBILE_PHONE",
        laptop: "LAPTOP",
        headphone: "HEADPHONE",
        earphone: "EARPHONE",
        tablet: "TABLET",
        desktop: "WATCH", // if you have desktop, adjust enum
        watch: "WATCH",
        accessory: "ACCESSORY",
      };
      const enumCategory = categoryMap[category.toLowerCase()];
      if (enumCategory && product.category !== enumCategory) return false;
    }

    return true;
  });
}

// -------------------- WEB SEARCH --------------------
async function searchWebTool(query) {
  console.log(`[Web Search] Query: "${query}"`);

  try {
    const { vectorLiteral } = await getQueryEmbedding(query);

    // Check cache
    const closestMatch = await prisma.$queryRawUnsafe(`
      SELECT response, 1 - (embedding <=> '${vectorLiteral}'::vector) as similarity
      FROM "WebSearchCache"
      ORDER BY similarity DESC
      LIMIT 1;
    `);

    if (closestMatch.length > 0 && closestMatch[0].similarity > 0.8) {
      console.log(
        `[Web Search] Cache hit (${closestMatch[0].similarity.toFixed(3)})`
      );
      return closestMatch[0].response;
    }

    // Call Serper API
    console.log(`[Web Search] Calling Serper API...`);
    const response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": process.env.SERPER_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: query, gl: "kw", hl: "en" }),
    });

    if (!response.ok) throw new Error("Serper API failed");

    const data = await response.json();

    // Cache result
    if (data && data.organic && data.organic.length > 0) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "WebSearchCache" (id, query, response, "embedding", "createdAt")
         VALUES (gen_random_uuid(), $1, $2::jsonb, '${vectorLiteral}'::vector, NOW())`,
        query,
        JSON.stringify(data)
      );
      console.log(`[Web Search] Cached result`);
    }

    return data;
  } catch (error) {
    console.error("[Web Search] Error:", error);
    return null;
  }
}

// -------------------- TOOL EXECUTION --------------------
async function executeSearchDatabase(args) {
  const { query, category, max_price, min_price, store_name } = args;

  console.log(`[Tool: search_product_database] Query: "${query}"`);

  // Generate embedding
  const { vectorLiteral } = await getQueryEmbedding(query);

  // Hybrid search
  const results = await hybridSearch(query, vectorLiteral, 80);

  // Apply filters
  const filtered = filterProducts(results, {
    category: category || "all",
    minPrice: min_price || 0,
    maxPrice: max_price || Infinity,
    storeName: store_name || "all",
  });

  console.log(
    `[Tool: search_product_database] Found ${filtered.length} products after filtering`
  );

  return {
    success: true,
    count: filtered.length,
    products: filtered.slice(0, 10).map((p) => ({
      title: p.title,
      price: p.price,
      storeName: p.storeName,
      productUrl: p.productUrl,
      imageUrl: p.imageUrl,
      description: p.description,
      category: p.category,
      brand: p.brand,
      specs: p.specs,
      rrfScore: p.rrfScore,
    })),
  };
}

async function executeSearchWeb(args) {
  const { query } = args;

  console.log(`[Tool: search_web] Query: "${query}"`);

  const serperData = await searchWebTool(query);

  if (!serperData || !serperData.organic) {
    return {
      success: false,
      message: "No web results found",
    };
  }

  const topResults = serperData.organic.slice(0, 6);

  return {
    success: true,
    results: topResults.map((r) => ({
      title: r.title,
      snippet: r.snippet,
      link: r.link,
    })),
  };
}

// -------------------- MAIN CHAT ROUTE --------------------
app.post("/chat", async (req, res) => {
  let { query: message, sessionId } = req.body;

  if (!message) return res.status(400).json({ error: "Message is required." });

  if (!sessionId) {
    sessionId = uuidv4();
    console.log(`[New Session] ${sessionId}`);
  }

  try {
    const history = await getMemory(sessionId);

    // Build messages for OpenAI
    const messages = [
      {
        role: "system",
        content: `You are Omnia AI, a helpful shopping assistant for electronics in Kuwait.

You have access to two tools:
1. search_product_database: Search local product catalog for phones, laptops, tablets, headphones, etc.
2. search_web: Search the web for trends, reviews, comparisons, or general information.

Guidelines:
- For product searches, buying queries, price checks → use search_product_database
- For trends, "best of 2024", comparisons, reviews, general tech info → use search_web
- You can use multiple tools if needed
- Always be friendly and helpful
- Provide specific product recommendations when possible`,
      },
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: message },
    ];

    // Call OpenAI with tools
    const completion = await openai.chat.completions.create({
      model: LLM_MODEL,
      messages,
      tools: TOOLS,
      tool_choice: "auto",
      temperature: 0.7,
    });

    const responseMessage = completion.choices[0].message;
    let finalResponse = responseMessage.content || "";
    let toolResults = [];
    let products = [];

    // Handle tool calls
    if (responseMessage.tool_calls) {
      console.log(
        `[Agent] ${responseMessage.tool_calls.length} tool calls requested`
      );

      for (const toolCall of responseMessage.tool_calls) {
        const functionName = toolCall.function.name;
        const args = JSON.parse(toolCall.function.arguments);

        console.log(`[Agent] Executing ${functionName}:`, args);

        let result;
        if (functionName === "search_product_database") {
          result = await executeSearchDatabase(args);
          if (result.success && result.products) {
            products = result.products;
          }
        } else if (functionName === "search_web") {
          result = await executeSearchWeb(args);
        }

        toolResults.push({
          tool: functionName,
          result,
        });
      }

      // Get final response from OpenAI with tool results
      const followUpMessages = [
        ...messages,
        responseMessage,
        ...responseMessage.tool_calls.map((tc, idx) => ({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify(toolResults[idx].result),
        })),
      ];

      const finalCompletion = await openai.chat.completions.create({
        model: LLM_MODEL,
        messages: followUpMessages,
        temperature: 0.7,
      });

      finalResponse = finalCompletion.choices[0].message.content;
    }

    // Format products for response
    const formattedProducts = products.map((p) => ({
      product_name: p.title,
      store_name: p.storeName,
      price_kwd: p.price,
      product_url: p.productUrl,
      image_url: p.imageUrl,
      product_description: p.description || p.title,
    }));

    // Save to memory
    await saveToMemory(sessionId, "user", message);
    await saveToMemory(sessionId, "assistant", finalResponse);

    return res.json({
      reply: finalResponse,
      products: formattedProducts,
      sessionId,
      toolsUsed: toolResults.map((t) => t.tool),
      history: await getMemory(sessionId),
    });
  } catch (error) {
    console.error("[Chat Error]", error);
    return res
      .status(500)
      .json({ error: "An error occurred processing your request." });
  }
});

// -------------------- HEALTH CHECK --------------------
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    message: "Hybrid Search Assistant with RRF, GIN, HNSW",
    features: [
      "Hybrid Search",
      "RRF Fusion",
      "Tool-based Architecture",
      "OpenAI Router",
    ],
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📊 Features: Hybrid Search (HNSW + GIN) with RRF`);
  console.log(`🤖 Router: OpenAI with Tool Calling`);
});
