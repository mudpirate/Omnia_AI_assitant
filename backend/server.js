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
        "Search for any product in the database. You are responsible for extracting strict filters.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Full natural language search query from user",
          },
          category: {
            type: "string",
            description:
              "Category if mentioned (e.g., smartphone, laptop, headphone, tablet)",
          },
          brand: {
            type: "string",
            description:
              "Brand name if mentioned (e.g., Apple, Samsung, Sony). Infer brand from model names (e.g. iPhone -> Apple).",
          },
          variant: {
            type: "string",
            description:
              "CRITICAL: The model variant. If user searches for a numbered model (e.g. 'iPhone 17') WITHOUT modifiers like 'Pro', 'Max', 'Plus', you MUST set this to 'base'. If 'iPhone 17 Pro', set to 'pro'. Values: 'base', 'pro', 'pro_max', 'plus', 'ultra'.",
          },
          color: {
            type: "string",
            description: "Color if mentioned (e.g., black, blue, silver)",
          },
          storage: {
            type: "string",
            description:
              "Storage capacity if mentioned (e.g., '512gb', '1tb', '256gb')",
          },
          max_price: {
            type: "number",
            description: "Maximum price in KWD if mentioned",
          },
          min_price: {
            type: "number",
            description: "Minimum price in KWD if mentioned",
          },
          store_name: {
            type: "string",
            description: "Store name if specified (xcite, best, noon, eureka)",
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
        "Search the web for current information, trends, news, reviews, or general knowledge not in product database.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Web search query" },
        },
        required: ["query"],
      },
    },
  },
];

// -------------------- EMBEDDING GENERATION --------------------
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

// -------------------- INTELLIGENT QUERY ANALYZER (SCALABLE) --------------------
function analyzeQueryForFilters(query) {
  const q = query.toLowerCase();
  const extracted = {};

  // 1. Extract Storage (512gb, 1tb, 256gb, etc.)
  // We keep this regex as a helper for numeric storage values, but rely on LLM for everything else.
  const gbMatch = q.match(/(\d+)\s*gb/i);
  const tbMatch = q.match(/(\d+)\s*tb/i);

  if (gbMatch) {
    extracted.storage = `${gbMatch[1]}gb`;
  } else if (tbMatch) {
    const gb = parseInt(tbMatch[1]) * 1024;
    extracted.storage = `${gb}gb`;
  }

  // NOTE: Manual brand/variant regex mapping has been removed.
  // We now rely 100% on the LLM Tool Definitions and System Prompt for this logic.

  console.log(`[Query Analyzer] Extracted:`, extracted);
  return extracted;
}

// -------------------- PUSH-DOWN FILTER BUILDER --------------------
/**
 * 🔥 BUILD SQL WHERE CLAUSE WITH STRICT JSON FILTERING & TITLE MATCHING
 * - REMOVED: searchKey filtering
 * - ADDED: Strict Number Matching directly in the WHERE clause (Applies to Vector Search too!)
 */
function buildPushDownFilters(filters = {}, rawQuery = "") {
  const conditions = [];

  // 1. ALWAYS filter stock (indexed column)
  conditions.push(`"stock" = 'IN_STOCK'`);

  // 2. Price Range (indexed column)
  if (filters.minPrice && filters.minPrice > 0) {
    conditions.push(`"price" >= ${parseFloat(filters.minPrice)}`);
  }
  if (
    filters.maxPrice &&
    filters.maxPrice < Infinity &&
    filters.maxPrice !== null
  ) {
    conditions.push(`"price" <= ${parseFloat(filters.maxPrice)}`);
  }

  // 3. Store Name (indexed column)
  if (filters.storeName && filters.storeName !== "all") {
    const storeValue = filters.storeName.toUpperCase().replace(/\./g, "_");
    conditions.push(`"storeName" = '${storeValue}'`);
  }

  // 4. Category (indexed column)
  if (filters.category) {
    const catLower = filters.category.toLowerCase().replace(/'/g, "''");
    conditions.push(`LOWER("category") LIKE '%${catLower}%'`);
  }

  // 5. Brand (Strict Column Match) - NO SEARCH KEY FALLBACK
  if (filters.brand) {
    const brandLower = filters.brand.toLowerCase().replace(/'/g, "''");
    conditions.push(`LOWER("brand") = '${brandLower}'`);
  }

  // 6. Variant (Strict JSON Match)
  if (filters.variant) {
    const variantLower = filters.variant.toLowerCase().replace(/'/g, "''");
    conditions.push(`"specs"->>'variant' = '${variantLower}'`);
  }

  // 7. Storage (Strict JSON Match)
  if (filters.storage) {
    const storageLower = filters.storage.toLowerCase().replace(/'/g, "''");
    conditions.push(`"specs"->>'storage' = '${storageLower}'`);
  }

  // 8. Color (Strict JSON Match)
  if (filters.color) {
    const colorLower = filters.color.toLowerCase().replace(/'/g, "''");
    conditions.push(`"specs"->>'color' ILIKE '%${colorLower}%'`);
  }

  // 9. 🔥 STRICT NUMBER MATCHING (Moved here to apply to Vector Search too)
  // If user searches "14", we enforce that the TITLE must contain "14" as a distinct number.
  if (rawQuery) {
    const q = rawQuery.toLowerCase();
    const allNumbers = q.match(/\b(\d+)\b/g) || [];

    if (allNumbers.length > 0) {
      console.log(
        `[Filter Builder] Enforcing strict numbers in TITLE: [${allNumbers.join(
          ", "
        )}]`
      );
      const numberConditions = allNumbers
        .map((num) => `LOWER("title") ~ '(^|[^0-9])${num}([^0-9]|$)'`)
        .join(" AND ");
      conditions.push(`(${numberConditions})`);
    }
  }

  const whereClause = conditions.length > 0 ? conditions.join(" AND ") : "1=1";
  console.log(`[Push-Down Filter] WHERE: ${whereClause}`);

  return whereClause;
}

// -------------------- VECTOR SEARCH WITH PUSH-DOWN --------------------
async function vectorSearch(
  vectorLiteral,
  filters = {},
  limit = 100,
  rawQuery = ""
) {
  // Pass rawQuery so strict numbers are enforced on the Title
  const whereClause = buildPushDownFilters(filters, rawQuery);

  const query = `
    SELECT
      "title", "price", "storeName", "productUrl", "category",
      "imageUrl", "stock", "description", "brand", "specs",
      1 - ("descriptionEmbedding" <=> '${vectorLiteral}'::vector) as similarity
    FROM "Product"
    WHERE "descriptionEmbedding" IS NOT NULL
      AND ${whereClause}
    ORDER BY "descriptionEmbedding" <=> '${vectorLiteral}'::vector ASC
    LIMIT ${limit};
  `;

  try {
    const startTime = Date.now();
    const results = await prisma.$queryRawUnsafe(query);
    const duration = Date.now() - startTime;
    console.log(
      `[Vector Search] Found ${results.length} products in ${duration}ms`
    );
    return results;
  } catch (error) {
    console.error("[Vector Search] Error:", error.message);
    return [];
  }
}

// -------------------- ULTRA-STRICT FULLTEXT SEARCH --------------------
/**
 * 🔥 UPDATED: Uses TITLE instead of SearchKey
 */
async function fulltextSearch(searchQuery, filters = {}, limit = 100) {
  // Pass searchQuery here too so filters match
  const whereClause = buildPushDownFilters(filters, searchQuery);
  const searchTerm = searchQuery.toLowerCase().trim().replace(/'/g, "''");

  if (!searchTerm) return [];

  try {
    // CRITICAL: Very high similarity threshold for precision
    await prisma.$executeRawUnsafe(`SET pg_trgm.similarity_threshold = 0.5;`);

    // Using "title" instead of "searchKey"
    const query = `
      SELECT 
        "title", "price", "storeName", "productUrl", "category", 
        "imageUrl", "stock", "description", "brand", "specs",
        similarity(LOWER("title"), '${searchTerm}') as rank
      FROM "Product"
      WHERE LOWER("title") % '${searchTerm}'
        AND ${whereClause}
      ORDER BY rank DESC
      LIMIT ${limit};
    `;

    const startTime = Date.now();
    const results = await prisma.$queryRawUnsafe(query);
    const duration = Date.now() - startTime;

    console.log(
      `[Fulltext Search] Found ${results.length} products in ${duration}ms`
    );

    return results;
  } catch (error) {
    console.error("[Fulltext Search] Error:", error.message);
    return [];
  }
}

// -------------------- IMPROVED RRF - FULLTEXT-ONLY MODE --------------------
function reciprocalRankFusion(vectorResults, fulltextResults, k = 60) {
  const scores = new Map();

  // Process vector results
  vectorResults.forEach((product, index) => {
    const key = product.productUrl || product.title;
    const rrfScore = 1 / (k + index + 1);
    scores.set(key, {
      product,
      vectorScore: rrfScore,
      fulltextScore: 0,
      vectorRank: index + 1,
      fulltextRank: null,
    });
  });

  // Process fulltext results
  fulltextResults.forEach((product, index) => {
    const key = product.productUrl || product.title;
    const rrfScore = 1 / (k + index + 1);

    if (scores.has(key)) {
      const existing = scores.get(key);
      existing.fulltextScore = rrfScore;
      existing.fulltextRank = index + 1;
    } else {
      scores.set(key, {
        product,
        vectorScore: 0,
        fulltextScore: rrfScore,
        vectorRank: null,
        fulltextRank: index + 1,
      });
    }
  });

  // Strict: If we have fulltext matches, ONLY use those
  const fulltextMatches = Array.from(scores.values()).filter(
    (item) => item.fulltextRank !== null
  );

  const vectorOnlyMatches = Array.from(scores.values()).filter(
    (item) => item.fulltextRank === null
  );

  let finalResults;

  if (fulltextMatches.length > 0) {
    finalResults = fulltextMatches.map((item) => ({
      finalScore: item.fulltextScore * 0.95 + item.vectorScore * 0.05,
      ...item,
    }));
    console.log(`[RRF] ✅ Using ONLY fulltext matches`);
  } else {
    finalResults = vectorOnlyMatches.map((item) => ({
      finalScore: item.vectorScore * 0.02,
      ...item,
    }));
    console.log(`[RRF] ⚠️  No fulltext matches, using vector fallback`);
  }

  // Sort by final score
  finalResults.sort((a, b) => b.finalScore - a.finalScore);

  const fused = finalResults.map((item) => ({
    ...item.product,
    rrfScore: item.finalScore,
  }));

  return fused;
}

// -------------------- HYBRID SEARCH WITH AUTOMATIC FALLBACK --------------------
async function hybridSearch(
  searchQuery,
  vectorLiteral,
  filters = {},
  limit = 50
) {
  console.log(`\n[Hybrid Search] Query: "${searchQuery}"`);
  console.log(`[Hybrid Search] Filters:`, JSON.stringify(filters, null, 2));

  const startTime = Date.now();

  // Run both searches - Pass searchQuery to vectorSearch for strict number filtering
  const [vectorResults, fulltextResults] = await Promise.all([
    vectorSearch(vectorLiteral, filters, limit * 2, searchQuery),
    fulltextSearch(searchQuery, filters, limit * 2),
  ]);

  console.log(
    `[Hybrid Search] Initial - Vector: ${vectorResults.length}, Fulltext: ${fulltextResults.length}`
  );

  if (vectorResults.length > 0 || fulltextResults.length > 0) {
    const fusedResults = reciprocalRankFusion(vectorResults, fulltextResults);
    const duration = Date.now() - startTime;
    return fusedResults.slice(0, limit);
  }

  // No results - try relaxed filters (but keep strict number matching!)
  console.log(`[Hybrid Search] No results. Trying relaxed filters...`);

  const relaxedFilters = {
    minPrice: filters.minPrice,
    maxPrice: filters.maxPrice,
    storeName: filters.storeName,
    // We KEEP brand/category strict if needed, or relax them.
    // Usually relaxed search drops complex filters but keeps price/store.
  };

  const [relaxedVector, relaxedFulltext] = await Promise.all([
    vectorSearch(vectorLiteral, relaxedFilters, limit * 2, searchQuery),
    fulltextSearch(searchQuery, relaxedFilters, limit * 2),
  ]);

  const fusedResults = reciprocalRankFusion(relaxedVector, relaxedFulltext);
  const duration = Date.now() - startTime;
  console.log(
    `[Hybrid Search] ✅ Completed in ${duration}ms with ${fusedResults.length} results (relaxed)`
  );

  return fusedResults.slice(0, limit);
}

// -------------------- WEB SEARCH --------------------
async function searchWebTool(query) {
  console.log(`[Web Search] Query: "${query}"`);

  try {
    const { vectorLiteral } = await getQueryEmbedding(query);

    const closestMatch = await prisma.$queryRawUnsafe(`
      SELECT response, 1 - (embedding <=> '${vectorLiteral}'::vector) as similarity
      FROM "WebSearchCache"
      ORDER BY similarity DESC
      LIMIT 1;
    `);

    if (closestMatch.length > 0 && closestMatch[0].similarity > 0.8) {
      return closestMatch[0].response;
    }

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

    if (data && data.organic && data.organic.length > 0) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "WebSearchCache" (id, query, response, "embedding", "createdAt")
         VALUES (gen_random_uuid(), $1, $2::jsonb, '${vectorLiteral}'::vector, NOW())`,
        query,
        JSON.stringify(data)
      );
    }

    return data;
  } catch (error) {
    console.error("[Web Search] Error:", error);
    return null;
  }
}

// -------------------- TOOL EXECUTION WITH DYNAMIC LIMITING --------------------
async function executeSearchDatabase(args) {
  const {
    query,
    max_price,
    min_price,
    store_name,
    brand,
    color,
    storage,
    variant,
    category,
  } = args;

  console.log(`\n[Tool: search_product_database] Query: "${query}"`);
  console.log(
    `[Tool: search_product_database] AI Extracted:`,
    JSON.stringify(args, null, 2)
  );

  const queryAnalysis = analyzeQueryForFilters(query);

  const mergedFilters = {
    minPrice: min_price || 0,
    maxPrice: max_price || null,
    storeName: store_name || null,
    brand: brand || queryAnalysis.brand || null,
    color: color || null,
    storage: storage || queryAnalysis.storage || null,
    variant: variant || null,
    category: category || null,
  };

  const finalFilters = {};
  Object.keys(mergedFilters).forEach((key) => {
    if (
      mergedFilters[key] !== null &&
      mergedFilters[key] !== undefined &&
      mergedFilters[key] !== 0
    ) {
      finalFilters[key] = mergedFilters[key];
    }
  });

  console.log(
    `[Tool: search_product_database] Final Filters:`,
    JSON.stringify(finalFilters, null, 2)
  );

  const { vectorLiteral } = await getQueryEmbedding(query);
  const results = await hybridSearch(query, vectorLiteral, finalFilters, 50);

  // ⭐ DYNAMIC LIMITING: Return only what exists (max 5)
  const actualCount = Math.min(results.length, 5);
  const productsToReturn = results.slice(0, actualCount);

  console.log(
    `[Tool: search_product_database] ✅ Returning ${productsToReturn.length} products (${results.length} found)\n`
  );

  return {
    success: true,
    count: productsToReturn.length,
    products: productsToReturn.map((p) => ({
      title: p.title,
      price: p.price,
      storeName: p.storeName,
      productUrl: p.productUrl,
      imageUrl: p.imageUrl,
      description: p.description,
      category: p.category,
      brand: p.brand,
      specs: p.specs,
      rrfScore: p.rrfScore?.toFixed(4),
    })),
  };
}

async function executeSearchWeb(args) {
  const { query } = args;

  const serperData = await searchWebTool(query);

  if (!serperData || !serperData.organic) {
    return {
      success: false,
      message: "No web results found",
    };
  }

  return {
    success: true,
    results: serperData.organic.slice(0, 6).map((r) => ({
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
    console.log(`\n[New Session] ${sessionId}`);
  }

  try {
    const history = await getMemory(sessionId);

    const messages = [
      {
        role: "system",
        content: `You are Omnia AI, a helpful shopping assistant for electronics in Kuwait.

**STRICT KEYWORD EXTRACTION RULES:**
1. **VARIANTS:** If the user searches for a numbered model (e.g., "iPhone 17", "Pixel 9") and DOES NOT use modifiers like "Pro", "Max", "Plus", or "Ultra", you **MUST** set the 'variant' tool parameter to 'base'. 
   - Example: "iPhone 17" -> variant: "base"
   - Example: "iPhone 17 Pro" -> variant: "pro"
2. **BRANDS:** Infer the brand if implied (e.g. "Galaxy" -> Brand: "Samsung").

**YOUR JOB:**
1. Help users find products by calling search_product_database
2. Extract filters from user queries: brand, color, storage, variant (pro, max, base), price range, store
3. Provide brief, conversational responses
4. If no results, suggest alternatives or ask clarifying questions

**CRITICAL RESPONSE RULE:**
When you call search_product_database and get results:
- DO NOT list product details in your text response
- DO NOT format products with titles, prices, or specifications
- The frontend will automatically display product cards with all details

**CORRECT RESPONSE FORMAT:**
After calling the tool and getting products, respond with:
- A brief introduction (1-2 sentences)
- Optional helpful context about the results
- Questions to help narrow down choices (if applicable)

**EXAMPLES:**

User: "iPhone 15 Pro Max 512GB"
Tool returns: 5 products
Your response: "I found 5 iPhone 15 Pro Max models with 512GB storage! Prices range from 450 to 520 KWD across different stores and colors. Would you like me to filter by a specific store or color?"

User: "black headphones under 50"
Tool returns: 8 products
Your response: "I found 8 black headphones under 50 KWD! There's a nice variety from brands like Sony, JBL, and Anker. Any specific features you're looking for, like noise cancellation or wireless?"

User: "gaming laptop"
Tool returns: 0 products
Your response: "I couldn't find any gaming laptops with those exact specifications. Could you tell me your budget range? That would help me find better options for you."

**WHAT NOT TO DO:**
❌ "Here are the products:
1. iPhone 15 Pro Max - 450 KWD - Store: Xcite..."
❌ Listing product titles, prices, or specifications in your text
❌ Using markdown lists or numbered lists for products
❌ Including [View Product] links in your text

**GUIDELINES:**
- Keep responses concise (2-4 sentences usually)
- Be conversational and helpful
- Always call the search tool before saying products aren't available
- Extract ALL relevant filters from user queries
- Don't make assumptions - if unclear, ask the user
- Focus on helping users narrow down choices, not displaying product details`,
      },
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: message },
    ];

    const completion = await openai.chat.completions.create({
      model: LLM_MODEL,
      messages,
      tools: TOOLS,
      tool_choice: "auto",
      temperature: 0.7,
    });

    const responseMessage = completion.choices[0].message;
    let finalResponse = responseMessage.content || "";
    let products = [];

    if (responseMessage.tool_calls) {
      console.log(
        `\n[Agent] Processing ${responseMessage.tool_calls.length} tool call(s)...`
      );

      const toolResults = [];

      for (const toolCall of responseMessage.tool_calls) {
        const functionName = toolCall.function.name;
        const args = JSON.parse(toolCall.function.arguments);

        let result;
        if (functionName === "search_product_database") {
          result = await executeSearchDatabase(args);
          if (result.success && result.products && result.products.length > 0) {
            products = result.products;
          }
        } else if (functionName === "search_web") {
          result = await executeSearchWeb(args);
        }

        toolResults.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }

      const followUpMessages = [...messages, responseMessage, ...toolResults];

      const finalCompletion = await openai.chat.completions.create({
        model: LLM_MODEL,
        messages: followUpMessages,
        temperature: 0.7,
      });

      finalResponse = finalCompletion.choices[0].message.content;
    }

    await saveToMemory(sessionId, "user", message);
    await saveToMemory(sessionId, "assistant", finalResponse);

    // 🔍 DETAILED LOGGING BEFORE SENDING RESPONSE
    console.log(`\n========================================`);
    console.log(`[FINAL RESPONSE DEBUG]`);
    console.log(`========================================`);
    console.log(`Session ID: ${sessionId}`);
    console.log(`\n[AI Reply Text]:`);
    console.log(finalResponse);
    console.log(`\n[Products Count]: ${products.length}`);

    if (products.length > 0) {
      console.log(`\n[Products Data]:`);
      products.forEach((product, index) => {
        console.log(`\n--- Product #${index + 1} ---`);
        console.log(`Title: ${product.title}`);
        console.log(`Price: ${product.price} KWD`);
        console.log(`Store: ${product.storeName}`);
        console.log(`Category: ${product.category}`);
        console.log(`Brand: ${product.brand || "N/A"}`);
        console.log(`Image URL: ${product.imageUrl || "N/A"}`);
        console.log(`Product URL: ${product.productUrl}`);
        console.log(
          `Description: ${product.description?.substring(0, 100)}...`
        );
        console.log(`Specs:`, JSON.stringify(product.specs, null, 2));
        console.log(`RRF Score: ${product.rrfScore}`);
      });
    } else {
      console.log(`\n[No Products] - Empty array being sent`);
    }

    console.log(`\n========================================`);
    console.log(`[SENDING TO FRONTEND]`);
    console.log(`========================================\n`);

    return res.json({
      reply: finalResponse,
      products: products,
      sessionId,
      history: await getMemory(sessionId),
    });
  } catch (error) {
    console.error("[Chat Error]", error);
    return res.status(500).json({ error: "Server error: " + error.message });
  }
});

// -------------------- HEALTH CHECK --------------------
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    message: "Omnia AI - Production-Ready Hybrid Search v2.0",
    features: [
      "🔥 Push-Down Filtering at Database Level",
      "🧠 Scalable Query Analysis (No Hardcoded Arrays)",
      "🎯 Semantic Vector Search (HNSW Index)",
      "📝 Ultra-Strict Fulltext Search (0.5 threshold)",
      "🔗 JSONB Specs Filtering (GIN Index)",
      "⚡ Fulltext-Only RRF Mode",
      "🔄 Dynamic Result Limiting",
      "🌐 Web Search Integration",
      "💾 Redis Caching",
      "📊 Optimized for 500k+ Products",
      "✅ Exact Model Number Matching",
      "🚀 Unlimited Brand Support",
    ],
  });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Omnia AI Server Running v2.0`);
  console.log(`📍 http://localhost:${PORT}`);
  console.log(`🔥 Production-Ready for 500k+ Products`);
  console.log(`📊 Hybrid Search: Vector (HNSW) + Fulltext (GIN) + RRF`);
  console.log(`⚡ Push-Down Filtering: Enabled`);
  console.log(`🧠 Scalable Query Analysis: Enabled`);
  console.log(`✅ Ultra-Strict Matching: Enabled (0.5 threshold)`);
  console.log(`🎯 Fulltext-Only Mode: Enabled\n`);
});
