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
        "Search for electronics. Extract brand, model, color, and STORAGE capacity.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Full search query" },
          brand: { type: "string", description: "e.g., Apple, Samsung" },
          model: { type: "string", description: "e.g., 17, S24, Pro Max" },
          color: { type: "string", description: "e.g., black, titanium, blue" },
          // 🔥 NEW PARAMETER
          storage: {
            type: "string",
            description:
              "Storage capacity if mentioned (e.g., '512GB', '1TB', '256'). Normalize to format like '512GB'.",
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
          },
          max_price: { type: "number" },
          min_price: { type: "number" },
          store_name: { type: "string" },
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

  const searchTerm = searchQuery.toLowerCase().trim();
  if (!searchTerm) return [];

  try {
    return await prisma.$queryRaw`
      SELECT
        "title", "price", "storeName", "productUrl", "category",
        "imageUrl", "stock", "description", "brand", "specs",
        similarity(lower("searchKey"), ${searchTerm}) as rank
      FROM "Product"
      WHERE lower("searchKey") % ${searchTerm}
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
// -------------------- PRODUCT FILTERING --------------------
function filterProducts(products, filters = {}) {
  const { category, minPrice, maxPrice, storeName, rawQuery } = filters;

  // Parse extra filters from user query
  const { capacityGb, strictQuery } = rawQuery
    ? parseStructuredFilters(rawQuery)
    : { capacityGb: null, strictQuery: "" };

  if (strictQuery) {
    console.log("[Filter] strictQuery =", strictQuery);
  }
  if (capacityGb) {
    console.log("[Filter] capacityGb =", capacityGb);
  }

  const strictTokens = strictQuery
    ? strictQuery.split(/\s+/).filter(Boolean)
    : [];

  return products.filter((product) => {
    // Stock check
    if (product.stock === "OUT_OF_STOCK") return false;

    // Price range
    if (minPrice && product.price < minPrice) return false;
    if (maxPrice && product.price > maxPrice) return false;

    // Store filter
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

    // Category filter
    if (category && category !== "all") {
      const categoryMap = {
        mobile_phone: "MOBILE_PHONE",
        laptop: "LAPTOP",
        headphone: "HEADPHONE",
        earphone: "EARPHONE",
        tablet: "TABLET",
        desktop: "WATCH", // adjust if you add desktop
        watch: "WATCH",
        accessory: "ACCESSORY",
      };
      const enumCategory = categoryMap[category.toLowerCase()];
      if (enumCategory && product.category !== enumCategory) return false;
    }

    const title = (product.title || "").toLowerCase();
    const desc = (product.description || "").toLowerCase();
    const text = title + " " + desc;

    // STRICT MODEL TOKENS — eg. "iphone 17"
    if (strictTokens.length > 0) {
      const allTokensPresent = strictTokens.every((t) => text.includes(t));
      if (!allTokensPresent) return false;
    }

    // STRICT CAPACITY — if user asked "512GB", do not show 256/1TB etc.
    if (capacityGb) {
      const patterns = [];

      // exact 512gb, "512 gb" style
      patterns.push(`${capacityGb}gb`);
      patterns.push(`${capacityGb} gb`);

      // if capacity is multiple of 1024 (1TB, 2TB), also allow "1tb" / "2tb"
      if (capacityGb % 1024 === 0) {
        const tbVal = capacityGb / 1024;
        patterns.push(`${tbVal}tb`);
        patterns.push(`${tbVal} tb`);
      }

      const hasCapacity = patterns.some((p) => text.includes(p));
      if (!hasCapacity) return false;
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

// -------------------- QUERY PARSING --------------------
function parseStructuredFilters(rawQuery) {
  const q = rawQuery.toLowerCase();

  // 1. Storage capacity
  // supports "512gb", "512 gb", "1tb", "2 tb", etc.
  let capacityGb = null;

  const gbMatch = q.match(/(\d+)\s*gb/); // 128gb, 256 gb, 512 gb
  if (gbMatch) {
    capacityGb = parseInt(gbMatch[1], 10);
  } else {
    const tbMatch = q.match(/(\d+)\s*tb/); // 1tb, 2 tb
    if (tbMatch) {
      const tb = parseInt(tbMatch[1], 10);
      capacityGb = tb * 1024;
    }
  }

  // 2. Strict model tokens (like "iphone 17", "s24 ultra")
  // You can refine this later; for now, take words that look like model tokens
  const tokens = q
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  // Very simple heuristic: keep brand / model-ish tokens
  const modelTokens = tokens.filter((t) => {
    // keep words like iphone, galaxy, s24, 17, etc.
    return t.length >= 2 && !["gb", "tb", "version", "storage"].includes(t);
  });

  const strictQuery = modelTokens.join(" ");

  return {
    capacityGb, // e.g. 512
    strictQuery, // e.g. "iphone 17"
  };
}

// -------------------- TOOL EXECUTION --------------------
async function executeSearchDatabase(args) {
  const { query, category, max_price, min_price, store_name } = args;

  console.log(`[Tool: search_product_database] Query: "${query}"`);

  const { vectorLiteral } = await getQueryEmbedding(query);

  const results = await hybridSearch(query, vectorLiteral, 80);

  const filtered = filterProducts(results, {
    category: category || "all",
    minPrice: min_price ?? 0,
    maxPrice: max_price ?? Infinity,
    storeName: store_name || "all",
    rawQuery: query, // 🔥 new
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
// -------------------- MAIN CHAT ROUTE (TEXT-ONLY MODE) --------------------
app.post("/chat", async (req, res) => {
  let { query: message, sessionId } = req.body;

  if (!message) return res.status(400).json({ error: "Message is required." });

  if (!sessionId) {
    sessionId = uuidv4();
    console.log(`[New Session] ${sessionId}`);
  }

  try {
    const history = await getMemory(sessionId);

    // ---------------------------------------------------------
    // 🔥 UPDATED SYSTEM PROMPT FOR TEXT-ONLY UI
    // ---------------------------------------------------------
    const messages = [
      {
        role: "system",
        content: `You are Omnia AI, a shopping assistant for electronics in Kuwait.

**UI MODE: TEXT-ONLY**
The user cannot see visual cards. You must list the products explicitly in your text response.

**INSTRUCTIONS:**
1. If you find products, list the **Top 3-5** matches clearly.
2. **Format each product like this:**
   
   **1. [Product Name]**
   - Price: [Price] KWD
   - Store: [Store Name]
   - Specs: [Key Specs like Storage, Color]
   - Description: [Short 1-sentence description]
   
3. **Be Concise:** Do not write huge paragraphs. Use bullet points.
4. **No Links:** Do not try to output markdown links or images, just text details.
5. If no products are found, apologize and suggest an alternative.`,
      },
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: message },
    ];

    // Call OpenAI
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
        `[Agent] Processing ${responseMessage.tool_calls.length} tools...`
      );

      for (const toolCall of responseMessage.tool_calls) {
        const functionName = toolCall.function.name;
        const args = JSON.parse(toolCall.function.arguments);

        let result;
        if (functionName === "search_product_database") {
          result = await executeSearchDatabase(args);
          if (result.success && result.products) {
            products = result.products;

            // 🔥 IMPORTANT: Pass the products back to the AI so it can read them!
            // We give it the top 5 to list out.
            result = {
              ...result,
              products: result.products.slice(0, 5),
              note: "These are the products found. Please list them for the user.",
            };
          }
        } else if (functionName === "search_web") {
          result = await executeSearchWeb(args);
        }

        toolResults.push({ tool: functionName, result });
      }

      // Send tool results back to OpenAI so it can generate the list
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

    // Save to memory
    await saveToMemory(sessionId, "user", message);
    await saveToMemory(sessionId, "assistant", finalResponse);

    // We still send the products array just in case, but your frontend ignores it
    return res.json({
      reply: finalResponse,
      products: products,
      sessionId,
      history: await getMemory(sessionId),
    });
  } catch (error) {
    console.error("[Chat Error]", error);
    return res.status(500).json({ error: "Server error" });
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
