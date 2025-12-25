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

// SIMPLIFIED TOOLS - LLM does the heavy lifting
const TOOLS = [
  {
    type: "function",
    function: {
      name: "search_product_database",
      description:
        "Search for products. The AI should extract specifications and send them as database-ready values. See System Prompt for category vocabulary and extraction rules.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Full natural language search query from user.",
          },
          category: {
            type: "string",
            description:
              "Database category code (e.g., MOBILEPHONES, LAPTOPS, AUDIO). See System Prompt for complete vocabulary.",
          },
          brand: {
            type: "string",
            description: "Brand name (lowercase, no suffixes).",
          },
          variant: {
            type: "string",
            description:
              "Model variant: 'base', 'pro', 'pro_max', '+', 'ultra', 'mini', 'air'. See System Prompt for extraction rules.",
          },
          color: { type: "string", description: "Color if mentioned." },
          storage: {
            type: "string",
            description: "Storage capacity (e.g., '256gb', '1tb').",
          },
          ram: { type: "string", description: "RAM size (e.g., '16gb')." },
          size: {
            type: "string",
            description: "For clothes/shoes (e.g., 'M', '42').",
          },
          gender: {
            type: "string",
            description: "For clothes (e.g., 'Men', 'Women').",
          },
          max_price: {
            type: "number",
            description: "Maximum price in KWD.",
          },
          min_price: {
            type: "number",
            description: "Minimum price in KWD.",
          },
          store_name: {
            type: "string",
            description:
              "Database store code: XCITE, BEST_KW, EUREKA, NOON. See System Prompt for mapping.",
          },
          model_number: {
            type: "string",
            description:
              "Full model identifier (e.g., 'iphone 15', 'galaxy s24+').",
          },
          megapixels: { type: "string", description: "Camera megapixels." },
          screen_size: { type: "string", description: "Screen size." },
          refresh_rate: {
            type: "string",
            description: "Display refresh rate.",
          },
          resolution: { type: "string", description: "Screen resolution." },
          processor: { type: "string", description: "CPU/Processor." },
          gpu: { type: "string", description: "Graphics card." },
          battery: { type: "string", description: "Battery capacity." },
          weight: { type: "string", description: "Product weight." },
          material: { type: "string", description: "Build material." },
          connectivity: {
            type: "string",
            description: "Connectivity options.",
          },
          ports: { type: "string", description: "Available ports." },
          operating_system: {
            type: "string",
            description: "Operating system.",
          },
          warranty: { type: "string", description: "Warranty period." },
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
        "Search the web for current information, trends, news, reviews, or general knowledge.",
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

async function getQueryEmbedding(text) {
  console.log("\n🧠 [EMBEDDING] Generating embedding for query:", text);

  const embeddingRes = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  });
  const embedding = embeddingRes.data[0]?.embedding;
  if (!embedding) throw new Error("Failed to generate embedding");

  const vectorLiteral =
    "[" + embedding.map((x) => Number(x).toFixed(6)).join(",") + "]";

  console.log("✅ [EMBEDDING] Successfully generated");
  console.log("   📊 Dimensions:", embedding.length);

  return { embedding, vectorLiteral };
}

function normalizeStorage(storageValue) {
  if (!storageValue) return null;

  const storageLower = storageValue.toLowerCase().trim();

  console.log("💾 [STORAGE NORMALIZATION]");
  console.log("   Input:", storageValue);

  const tbMatch = storageLower.match(/^(\d+(?:\.\d+)?)\s*tb$/);
  if (tbMatch) {
    const tbValue = parseFloat(tbMatch[1]);
    const gbValue = Math.round(tbValue * 1024);
    const normalized = `${gbValue}gb`;
    console.log("   ✅ Converted TB to GB:", normalized);
    return normalized;
  }

  const gbMatch = storageLower.match(/^(\d+)\s*gb$/);
  if (gbMatch) {
    const normalized = `${gbMatch[1]}gb`;
    console.log("   ✅ Normalized GB:", normalized);
    return normalized;
  }

  console.log("   ⚠️  No normalization applied, using as-is:", storageLower);
  return storageLower;
}

// CORE DATABASE COLUMNS - These are direct table columns, not JSONB specs
// Handle both camelCase and snake_case from LLM
const CORE_COLUMNS = [
  "category",
  "brand",
  "storeName",
  "store_name", // snake_case variant
  "minPrice",
  "min_price", // snake_case variant
  "maxPrice",
  "max_price", // snake_case variant
  "modelNumber",
  "model_number", // snake_case variant
];

// EXACT MATCH SPECS - These require exact matching in JSONB
const EXACT_MATCH_SPECS = ["variant", "storage"];

// SCALABLE PASS-THROUGH FILTER BUILDER
function buildPushDownFilters(filters = {}, rawQuery = "") {
  console.log("\n🔍 [FILTER BUILDER] Building WHERE clause (Scalable Mode)");
  console.log("   📥 Input filters:", JSON.stringify(filters, null, 2));

  const conditions = [];

  // Always filter for IN_STOCK
  conditions.push(`"stock" = 'IN_STOCK'`);
  console.log("   📦 Stock filter: ENABLED");

  // Process all filters dynamically
  Object.keys(filters).forEach((key) => {
    const value = filters[key];

    // Skip null/undefined/empty values
    if (!value || value === null || value === undefined) return;

    // Handle core table columns
    if (key === "minPrice" && value > 0) {
      const condition = `"price" >= ${parseFloat(value)}`;
      conditions.push(condition);
      console.log(`   💰 Min price: ${condition}`);
    } else if (key === "maxPrice" && value < Infinity) {
      const condition = `"price" <= ${parseFloat(value)}`;
      conditions.push(condition);
      console.log(`   💰 Max price: ${condition}`);
    } else if (key === "category") {
      // LLM sends database-ready code (e.g., "MOBILEPHONES")
      const condition = `"category" = '${value.toUpperCase()}'`;
      conditions.push(condition);
      console.log(`   📂 Category: ${condition}`);
    } else if (key === "brand") {
      const brandLower = value.toLowerCase().replace(/'/g, "''");
      const condition = `LOWER("brand") ILIKE '%${brandLower}%'`;
      conditions.push(condition);
      console.log(`   🏷️  Brand: ${condition}`);
    } else if (key === "storeName" || key === "store_name") {
      // LLM sends database-ready code (e.g., "BEST_KW")
      // Handle both camelCase (storeName) and snake_case (store_name)
      const condition = `"storeName" = '${value.toUpperCase()}'`;
      conditions.push(condition);
      console.log(`   🏪 Store: ${condition}`);
    } else if (key === "modelNumber" || key === "model_number") {
      // Handle both camelCase and snake_case
      const modelNum = value.replace(/'/g, "''");
      const condition = `LOWER("title") LIKE '%${modelNum}%'`;
      conditions.push(condition);
      console.log(`   🔢 Model: ${condition}`);
    }
    // Handle JSONB specs (everything else)
    else if (key !== "query") {
      const specValue = value.toString().toLowerCase().replace(/'/g, "''");

      // Check if this is an exact-match spec
      if (EXACT_MATCH_SPECS.includes(key)) {
        const condition = `LOWER("specs"->>'${key}') = '${specValue}'`;
        conditions.push(condition);
        console.log(`   🎯 EXACT spec [${key}]: ${condition}`);
      } else {
        // All other specs use flexible matching
        const condition = `LOWER("specs"->>'${key}') ILIKE '%${specValue}%'`;
        conditions.push(condition);
        console.log(`   🔄 FLEXIBLE spec [${key}]: ${condition}`);
      }
    }
  });

  const whereClause = conditions.length > 0 ? conditions.join(" AND ") : "1=1";

  console.log("   ✅ Final WHERE clause:");
  console.log("   ", whereClause);
  console.log("   📊 Total conditions:", conditions.length);

  return whereClause;
}

async function vectorSearch(
  vectorLiteral,
  filters = {},
  limit = 100,
  rawQuery = ""
) {
  console.log("\n🎯 [VECTOR SEARCH] Starting vector search");
  console.log("   🔢 Limit:", limit);

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
    const results = await prisma.$queryRawUnsafe(query);
    console.log("   ✅ Vector search completed");
    console.log("   📊 Results found:", results.length);

    if (results.length > 0) {
      console.log("   🔝 Top 3 results:");
      results.slice(0, 3).forEach((r, i) => {
        console.log(`      ${i + 1}. ${r.title}`);
        console.log(
          `         Price: ${r.price} KWD | Store: ${r.storeName} | Category: ${r.category}`
        );
        console.log(`         Similarity: ${r.similarity?.toFixed(4)}`);
      });
    }

    return results;
  } catch (error) {
    console.error("   ❌ [Vector Search] Error:", error.message);
    return [];
  }
}

async function fulltextSearch(searchQuery, filters = {}, limit = 100) {
  console.log("\n📝 [FULLTEXT SEARCH] Starting fulltext search");
  console.log("   🔍 Search term:", searchQuery);

  const whereClause = buildPushDownFilters(filters, searchQuery);
  const searchTerm = searchQuery.toLowerCase().trim().replace(/'/g, "''");

  if (!searchTerm) {
    console.log("   ⚠️  Empty search term");
    return [];
  }

  try {
    await prisma.$executeRawUnsafe(`SET pg_trgm.similarity_threshold = 0.5;`);

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

    let results = await prisma.$queryRawUnsafe(query);
    console.log("   📊 Primary search results:", results.length);

    if (results.length === 0) {
      console.log("   🔄 Trying fallback search...");

      const words = searchTerm
        .split(/\s+/)
        .filter(
          (word) =>
            word.length > 2 &&
            !["the", "and", "for", "with", "from"].includes(word)
        );

      if (words.length > 0) {
        const likeConditions = words
          .map((word) => `LOWER("title") LIKE '%${word}%'`)
          .join(" AND ");

        const fallbackQuery = `
            SELECT 
              "title", "price", "storeName", "productUrl", "category", 
              "imageUrl", "stock", "description", "brand", "specs",
              0.5 as rank
            FROM "Product"
            WHERE ${likeConditions}
              AND ${whereClause}
            LIMIT ${limit};
          `;

        results = await prisma.$queryRawUnsafe(fallbackQuery);
        console.log("   📊 Fallback results:", results.length);
      }
    }

    return results;
  } catch (error) {
    console.error("   ❌ [Fulltext Search] Error:", error.message);
    return [];
  }
}

function reciprocalRankFusion(vectorResults, fulltextResults, k = 60) {
  console.log("\n🔀 [RRF FUSION] Starting Reciprocal Rank Fusion");
  console.log("   📊 Vector results:", vectorResults.length);
  console.log("   📊 Fulltext results:", fulltextResults.length);

  const scores = new Map();

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

  const fulltextMatches = Array.from(scores.values()).filter(
    (item) => item.fulltextRank !== null
  );

  const vectorOnlyMatches = Array.from(scores.values()).filter(
    (item) => item.fulltextRank === null
  );

  console.log("   📊 Fulltext matches:", fulltextMatches.length);
  console.log("   📊 Vector-only matches:", vectorOnlyMatches.length);

  let finalResults;

  if (fulltextMatches.length > 0) {
    finalResults = fulltextMatches.map((item) => ({
      finalScore: item.fulltextScore * 0.95 + item.vectorScore * 0.05,
      ...item,
    }));
    console.log("   ✅ Using fulltext-weighted scoring (95/5)");
  } else {
    finalResults = vectorOnlyMatches.map((item) => ({
      finalScore: item.vectorScore * 0.02,
      ...item,
    }));
    console.log("   ✅ Using vector-only scoring (2%)");
  }

  finalResults.sort((a, b) => b.finalScore - a.finalScore);

  const fused = finalResults.map((item) => ({
    ...item.product,
    rrfScore: item.finalScore,
  }));

  console.log("   📊 Total fused results:", fused.length);

  return fused;
}

async function hybridSearch(
  searchQuery,
  vectorLiteral,
  filters = {},
  limit = 50
) {
  console.log("\n🚀 [HYBRID SEARCH] Starting hybrid search");
  console.log("   🔍 Query:", searchQuery);
  console.log("   🎛️  Filters:", JSON.stringify(filters, null, 2));

  const [vectorResults, fulltextResults] = await Promise.all([
    vectorSearch(vectorLiteral, filters, limit * 2, searchQuery),
    fulltextSearch(searchQuery, filters, limit * 2),
  ]);

  if (vectorResults.length > 0 || fulltextResults.length > 0) {
    const fusedResults = reciprocalRankFusion(vectorResults, fulltextResults);
    const finalResults = fusedResults.slice(0, limit);
    console.log("   ✅ Search completed:", finalResults.length, "results");
    return finalResults;
  }

  console.log("   ⚠️  No results, trying RELAXED search...");

  // Only keep core filters for relaxed search
  const relaxedFilters = {
    minPrice: filters.minPrice || filters.min_price,
    maxPrice: filters.maxPrice || filters.max_price,
    storeName: filters.storeName || filters.store_name,
    category: filters.category,
    brand: filters.brand,
    modelNumber: filters.modelNumber || filters.model_number,
    storage: filters.storage,
    ram: filters.ram,
  };

  const [relaxedVector, relaxedFulltext] = await Promise.all([
    vectorSearch(vectorLiteral, relaxedFilters, limit * 2, searchQuery),
    fulltextSearch(searchQuery, relaxedFilters, limit * 2),
  ]);

  const fusedResults = reciprocalRankFusion(relaxedVector, relaxedFulltext);
  const finalResults = fusedResults.slice(0, limit);

  console.log("   ✅ Relaxed search:", finalResults.length, "results");

  return finalResults;
}

async function searchWebTool(query) {
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

async function executeSearchDatabase(args) {
  console.log("\n" + "=".repeat(80));
  console.log("🔧 [TOOL: search_product_database] EXECUTION STARTED");
  console.log("=".repeat(80));
  console.log("📥 Raw arguments received:");
  console.log(JSON.stringify(args, null, 2));

  const { query } = args;

  if (!query || query === "undefined" || query.trim() === "") {
    console.error(`❌ Invalid query: "${query}"`);
    return {
      success: false,
      error: "Invalid search query",
      count: 0,
      products: [],
    };
  }

  console.log("✅ Query validation passed:", query);

  // Normalize storage if present
  if (args.storage) {
    args.storage = normalizeStorage(args.storage);
  }

  // Build filters object - EVERYTHING the LLM sends becomes a filter
  const filters = {};
  Object.keys(args).forEach((key) => {
    if (key !== "query" && args[key] !== null && args[key] !== undefined) {
      filters[key] = args[key];
    }
  });

  console.log("✨ Final filters:");
  console.log(JSON.stringify(filters, null, 2));

  try {
    const { vectorLiteral } = await getQueryEmbedding(query);
    const results = await hybridSearch(query, vectorLiteral, filters, 50);

    const productsToReturn = results.slice(0, 5);

    console.log("\n📦 [PRODUCTS TO FRONTEND]");
    console.log("   Total results:", results.length);
    console.log("   Sending to frontend:", productsToReturn.length);

    if (productsToReturn.length > 0) {
      console.log("\n   📋 Product list:");
      productsToReturn.forEach((p, i) => {
        console.log(`\n   ${i + 1}. ${p.title}`);
        console.log(`      Price: ${p.price} KWD | Store: ${p.storeName}`);
        console.log(`      Category: ${p.category} | Brand: ${p.brand}`);
      });
    }

    console.log("\n" + "=".repeat(80));
    console.log("✅ [TOOL EXECUTION] COMPLETED");
    console.log("=".repeat(80) + "\n");

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
  } catch (error) {
    console.error(`❌ Search error:`, error.message);
    return {
      success: false,
      error: `Search failed: ${error.message}`,
      count: 0,
      products: [],
    };
  }
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

app.post("/chat", async (req, res) => {
  let { query: message, sessionId } = req.body;

  console.log("\n" + "█".repeat(80));
  console.log("📨 NEW CHAT REQUEST");
  console.log("█".repeat(80));
  console.log("User message:", message);

  if (!message || typeof message !== "string" || message.trim() === "") {
    return res.status(400).json({
      error: "Valid message is required",
    });
  }

  message = message.trim();

  if (!sessionId) {
    sessionId = uuidv4();
    console.log("Generated session ID:", sessionId);
  }

  try {
    const history = await getMemory(sessionId);
    console.log("📚 Chat history:", history.length, "messages");

    const messages = [
      {
        role: "system",
        content: `You are Omnia AI, a helpful shopping assistant for electronics in Kuwait.

**═══════════════════════════════════════════════════════════════════════**
**CRITICAL: TOOL SELECTION - READ THIS FIRST**
**═══════════════════════════════════════════════════════════════════════**

You have access to TWO tools. Choose the RIGHT tool for each query:

**1. search_product_database** - Use for:
   - Finding products to buy (phones, laptops, headphones, etc.)
   - Price comparisons between stores
   - Product availability checks
   - Specific product specifications
   - Shopping recommendations
   Examples: "iPhone 15", "gaming laptops under 500 KWD", "wireless headphones"

**2. search_web** - Use for:
   - General facts and information ("what is", "who is", "when did")
   - Product reviews and comparisons ("iPhone 15 vs Samsung S24")
   - Tech news and announcements ("latest iPhone features")
   - How-to questions ("how to transfer data to new phone")
   - Historical information ("when was iPhone released")
   - Specifications explanations ("what is 5G", "difference between OLED and LCD")
   Examples: "what is the best phone in 2024", "iPhone 15 reviews", "how to reset iPhone"

**DECISION TREE:**
- User wants to BUY/FIND/PURCHASE → search_product_database
- User asks WHAT/WHY/HOW/WHEN about general knowledge → search_web
- User asks for REVIEWS/COMPARISONS/OPINIONS → search_web
- User asks for FACTS/NEWS/INFORMATION → search_web

**═══════════════════════════════════════════════════════════════════════**
**CATEGORY VOCABULARY - Database Codes**
**═══════════════════════════════════════════════════════════════════════**

When extracting the 'category' parameter, you MUST use these EXACT database codes:

**Electronics:**
- Smartphones/Phones/Mobile → "MOBILEPHONES"
- Laptops/Notebooks → "LAPTOPS"
- Tablets → "TABLETS"
- Headphones/Earphones/Earbuds/Audio → "AUDIO"
- Smartwatches/Watches → "SMARTWATCHES"
- Accessories/Cases/Covers/Chargers/Cables → "ACCESSORIES"
- Speakers/Soundbars → "AUDIO"
- Displays/Monitors/TVs → "DISPLAYS"
- Cameras → "CAMERAS"
- Desktops/PCs/Towers → "DESKTOPS"

**Fashion (Coming Soon):**
- Clothing/Clothes/Apparel → "CLOTHING"
- Shoes/Footwear/Sneakers → "SHOES"
- Bags/Handbags/Backpacks → "BAGS"
- Jewelry/Accessories → "JEWELRY"

**CATEGORY INFERENCE RULES:**

ALWAYS infer category from model names or keywords to prevent cross-category contamination.

Examples:
- "iPhone 15" → category: "MOBILEPHONES"
- "MacBook Air" → category: "LAPTOPS"
- "iPad Pro" → category: "TABLETS"
- "AirPods Max" → category: "AUDIO"
- "wireless headphones" → category: "AUDIO"
- "iPhone case" → category: "ACCESSORIES"
- "phone charger" → category: "ACCESSORIES"
- "bluetooth speaker" → category: "AUDIO"
- "gaming desktop" → category: "DESKTOPS"
- "4K monitor" → category: "DISPLAYS"

**WHY THIS IS CRITICAL:**
Without category filtering, searching for "iPhone 15" could return "MacBook Air 15.3-inch" because:
- Both are Apple products
- Both have "15" in the name
- Without category, the system can't distinguish them

**═══════════════════════════════════════════════════════════════════════**
**STORE NAME VOCABULARY - Database Codes**
**═══════════════════════════════════════════════════════════════════════**

When extracting 'store_name', use these EXACT database codes:

- "xcite" or "Xcite" → "XCITE"
- "best" or "Best" or "Best Electronics" → "BEST_KW"
- "eureka" or "Eureka" → "EUREKA"
- "noon" or "Noon" → "NOON"

**═══════════════════════════════════════════════════════════════════════**
**MODEL NUMBER EXTRACTION - CRITICAL FOR ACCURACY**
**═══════════════════════════════════════════════════════════════════════**

The 'model_number' parameter is the KEY to finding exact products across ANY brand.

**RULES:**
1. Extract the FULL model string as users would say it
2. Include brand/series + model identifier
3. Examples:
   - "iPhone 15" → model_number: "iphone 15"
   - "Galaxy S24" → model_number: "galaxy s24" or "s24"
   - "Pixel 8 Pro" → model_number: "pixel 8 pro"
   - "XPS 13" → model_number: "xps 13"
   - "ThinkPad T14" → model_number: "thinkpad t14"
   - "ROG Strix" → model_number: "rog strix"
   - "MacBook Air M2" → model_number: "macbook air m2"

4. DO NOT include storage/RAM/color in model_number
5. Keep it concise and lowercase

**WHY THIS IS CRITICAL:**
Without model_number, searching "Samsung S24 Plus 512GB" could match "iPhone 15 Plus 512GB" 
because both have "Plus" variant and "512GB" storage. The model_number ensures we ONLY 
match Samsung S24 models, preventing cross-model contamination.

**═══════════════════════════════════════════════════════════════════════**
**VARIANT EXTRACTION RULES**
**═══════════════════════════════════════════════════════════════════════**

1. **Base models (NO variant keywords mentioned):**
   - If user says just the model number WITHOUT Pro/Plus/Max/Ultra/Mini keywords → SET variant: "base"
   - Examples: 
     * "iPhone 17" → variant: "base"
     * "iPhone 15" → variant: "base"
     * "Samsung S24" → variant: "base"
     * "Pixel 8" → variant: "base"
   - This ensures ONLY base models are shown, NOT Pro/Plus/Max variants

2. **"Plus" MUST BE CONVERTED TO "+":**
   - "Samsung S24 Plus" → variant: "+"
   - "iPhone 15 Plus" → variant: "+"

3. **Other variants - EXTRACT EXACTLY AS MENTIONED:**
   - "Pro Max" → variant: "pro_max"
   - "Pro" → variant: "pro"
   - "Ultra" → variant: "ultra"
   - "Mini" → variant: "mini"
   - "Air" → variant: "air"

4. **Detection Logic:**
   - Check if query contains variant keywords: "pro", "plus", "+", "max", "ultra", "mini"
   - If NO variant keywords found → variant: "base"
   - If variant keywords found → extract the exact variant

**CRITICAL: Variant matching behavior:**
- If variant is NOT mentioned (just model number) → Automatically set to "base"
- If variant IS mentioned → Extract and match exactly

Examples:
- User: "iPhone 15" → variant: "base" → Shows ONLY base model
- User: "iPhone 15 Pro" → variant: "pro" → Shows ONLY Pro variant
- User: "iPhone 15 Plus" → variant: "+" → Shows ONLY Plus variant
- User: "Samsung S24" → variant: "base" → Shows ONLY base S24

This ensures users get EXACTLY what they ask for!

**═══════════════════════════════════════════════════════════════════════**
**RAM vs STORAGE EXTRACTION**
**═══════════════════════════════════════════════════════════════════════**

1. **RAM Extraction (only when explicitly mentioned):**
   - Extract RAM ONLY if the query contains "RAM" or "memory" keywords
   - Examples:
     * "16gb ram phone" → ram: "16gb", storage: null
     * "8gb ram laptop" → ram: "8gb", storage: null
     * "8gb memory" → ram: "8gb"

2. **Storage Extraction (default for capacity numbers):**
   - Extract as storage if >= 64GB WITHOUT "RAM" keyword
   - Examples:
     * "256gb phone" → ram: null, storage: "256gb"
     * "512gb storage" → ram: null, storage: "512gb"
     * "16gb ram 256gb" → ram: "16gb", storage: "256gb"
     * "1tb laptop" → ram: null, storage: "1tb"
     * "2tb storage" → ram: null, storage: "2tb"

**IMPORTANT: Storage format flexibility:**
You can use EITHER "TB" or "GB" format - the system automatically converts:
- "1tb" → "1024gb"
- "2tb" → "2048gb"
- "512gb" → "512gb"

**═══════════════════════════════════════════════════════════════════════**
**DYNAMIC SPEC EXTRACTION - Works for ANY Product**
**═══════════════════════════════════════════════════════════════════════**

The system supports ANY specification automatically! Extract ANY spec from the user query 
and the system will filter it. No code changes needed for new product types.

**Examples of Dynamic Specs:**

**Cameras:**
- "24mp Sony camera" → megapixels: "24mp"
- "4K video camera" → resolution: "4K"

**TVs/Monitors:**
- "27 inch monitor" → screen_size: "27"
- "144hz gaming monitor" → refresh_rate: "144hz"
- "4K TV" → resolution: "4K"

**Laptops:**
- "i7 laptop" → processor: "i7"
- "RTX 4060 laptop" → gpu: "RTX 4060"
- "15.6 inch laptop" → screen_size: "15.6"

**Smartwatches:**
- "titanium apple watch" → material: "titanium"
- "5G watch" → connectivity: "5G"

**ANY Product:**
- "5000mah battery" → battery: "5000mah"
- "aluminum build" → material: "aluminum"
- "USB-C port" → ports: "USB-C"
- "WiFi 6" → connectivity: "WiFi 6"

**═══════════════════════════════════════════════════════════════════════**
**SMART ALTERNATIVE HANDLING**
**═══════════════════════════════════════════════════════════════════════**

If strict search returns 0 results, the system automatically tries relaxed search:
- Relaxed search drops: variant, storage, RAM, color
- Relaxed search keeps: category, brand, model_number

Example:
User: "iPhone 15 Pro"
Strict search: variant="pro" → 0 results
Relaxed search: Drops variant → Finds "iPhone 15 Pro Max"
Your response: "I don't have the iPhone 15 Pro in stock right now, but I found the iPhone 15 Pro Max which is similar!"

**DO NOT claim exact match when showing alternatives:**
❌ "I found iPhone 15 Pro!" (when showing Pro Max)
✅ "I don't have iPhone 15 Pro, but I found iPhone 15 Pro Max!"

**═══════════════════════════════════════════════════════════════════════**
**NO RESULTS HANDLING - CRITICAL**
**═══════════════════════════════════════════════════════════════════════**

If search_product_database returns 0 products:
- DO NOT suggest products from different categories
- DO NOT mention alternatives from other categories
- Simply say: "I don't have [specific product] in my database right now."

**CRITICAL: Never claim products are something they're not!**
If user asks for "iPhone case" and tool returns iPhones (not cases), say:
"I don't have iPhone cases in my database right now."

DO NOT say:
❌ "I found iPhone cases" (when showing phones)
❌ "Here are some options for cases" (when showing phones)

Examples:

User: "iPhone 17"
Tool returns: 0 products
Your response: "I don't have the iPhone 17 in my database right now."

User: "iPhone case"
Tool returns: 0 products
Your response: "I don't have iPhone cases in my database right now."

User: "Samsung charger"
Tool returns: 0 products  
Your response: "I don't have Samsung chargers in my database right now."

User: "AirPods case"
Tool returns: AirPods (not cases)
Your response: "I don't have AirPods cases in my database right now."

DO NOT SAY:
❌ "I couldn't find iPhone cases, but here are some phones"
❌ "Would you like to see other Apple products?"
❌ "Let me show you alternatives from different categories"

**ALWAYS verify the category matches what the user asked for!**

**═══════════════════════════════════════════════════════════════════════**
**CRITICAL FORMATTING INSTRUCTIONS**
**═══════════════════════════════════════════════════════════════════════**

- You MUST respond in PLAIN TEXT ONLY
- NEVER use Markdown syntax (no **, no *, no #, no -, no numbered lists)
- NO asterisks, NO bold formatting, NO bullet points
- Write naturally as if speaking to someone
- Use actual newlines (line breaks) to separate thoughts, NOT formatting characters

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
- Keep responses concise (2-4 sentences)

**FORMATTING EXAMPLES:**

❌ WRONG (Markdown with asterisks):
"I found several iPhone 17 models:
**1. iPhone 17 256GB in Black**
**2. iPhone 17 512GB in Lavender**
Would you like more details?"

✅ CORRECT (Plain text with newlines):
"I found several iPhone 17 models available at Best! The prices range from 278 to 439 KWD.

Would you like to see specific colors or storage options?"

❌ WRONG (Listing products):
"Here are the options:
- iPhone 17 256GB Black (278 KWD)
- iPhone 17 512GB Lavender (369 KWD)
- iPhone 17 Pro 256GB Orange (364 KWD)"

✅ CORRECT (Brief summary):
"I found iPhone 17 models with storage options from 256GB to 512GB. Prices start at 278 KWD.

What storage capacity are you interested in?"

**═══════════════════════════════════════════════════════════════════════**
**TOOL CALL EXAMPLES**
**═══════════════════════════════════════════════════════════════════════**

**CRITICAL: ALWAYS call search_product_database BEFORE responding about products!**
NEVER claim to have found products without actually calling the search tool first.
NEVER make up prices, specifications, or product details.

**CRITICAL TOOL CALL INSTRUCTION:**
When the user sends you a message, you MUST call the search_product_database tool with:
1. The FULL user message in the 'query' parameter
2. The extracted filters in their respective parameters
3. The MODEL NUMBER in the 'model_number' parameter
4. The DATABASE-READY category code (e.g., "MOBILEPHONES", not "smartphone")

**Smartphones:**

User: "iPhone 15 from Best"
{
  "query": "iPhone 15 from Best",
  "category": "MOBILEPHONES",
  "brand": "apple",
  "model_number": "iphone 15",
  "variant": "base",
  "store_name": "BEST_KW"
}

User: "Samsung S24 Plus 512GB"
{
  "query": "Samsung S24 Plus 512GB",
  "category": "MOBILEPHONES",
  "brand": "samsung",
  "model_number": "galaxy s24+",
  "variant": "+",
  "storage": "512gb"
}

User: "iPhone 15 Pro Max"
{
  "query": "iPhone 15 Pro Max",
  "category": "MOBILEPHONES",
  "brand": "apple",
  "model_number": "iphone 15 pro max",
  "variant": "pro_max"
}

User: "iPhone 17"
{
  "query": "iPhone 17",
  "category": "MOBILEPHONES",
  "brand": "apple",
  "model_number": "iphone 17",
  "variant": "base"
}

User: "Samsung S24"
{
  "query": "Samsung S24",
  "category": "MOBILEPHONES",
  "brand": "samsung",
  "model_number": "galaxy s24",
  "variant": "base"
}

**Laptops:**

User: "MacBook Air M2"
{
  "query": "MacBook Air M2",
  "category": "LAPTOPS",
  "brand": "apple",
  "model_number": "macbook air m2",
  "variant": "air",
  "processor": "m2"
}

User: "ThinkPad X1 Carbon"
{
  "query": "ThinkPad X1 Carbon",
  "category": "LAPTOPS",
  "brand": "lenovo",
  "model_number": "thinkpad x1 carbon"
}

User: "i7 laptop with RTX 4060"
{
  "query": "i7 laptop with RTX 4060",
  "category": "LAPTOPS",
  "processor": "i7",
  "gpu": "RTX 4060"
}

**Audio:**

User: "wireless headphones"
{
  "query": "wireless headphones",
  "category": "AUDIO"
}

User: "bluetooth speaker"
{
  "query": "bluetooth speaker",
  "category": "AUDIO"
}

User: "AirPods Pro"
{
  "query": "AirPods Pro",
  "category": "AUDIO",
  "brand": "apple",
  "model_number": "airpods pro",
  "variant": "pro"
}

**Displays:**

User: "144hz gaming monitor"
{
  "query": "144hz gaming monitor",
  "category": "DISPLAYS",
  "refresh_rate": "144hz"
}

User: "4K monitor under 300 KWD"
{
  "query": "4K monitor under 300 KWD",
  "category": "DISPLAYS",
  "resolution": "4K",
  "max_price": 300
}

**Cameras:**

User: "24mp Sony camera"
{
  "query": "24mp Sony camera",
  "category": "CAMERAS",
  "brand": "sony",
  "megapixels": "24mp"
}

**Desktops:**

User: "gaming desktop"
{
  "query": "gaming desktop",
  "category": "DESKTOPS"
}

**Smartwatches:**

User: "titanium Apple Watch"
{
  "query": "titanium Apple Watch",
  "category": "SMARTWATCHES",
  "brand": "apple",
  "material": "titanium"
}

**═══════════════════════════════════════════════════════════════════════**
**RESPONSE EXAMPLES**
**═══════════════════════════════════════════════════════════════════════**

User: "iPhone 15 from Best"
Tool call: [as shown above]
Your response: "I found several iPhone 15 base models at Best with different storage options and colors. Prices range from 250 to 350 KWD. What storage capacity would you prefer?"

User: "Samsung S24 Plus 512GB"
Tool call: [as shown above]
Your response: "I found Samsung Galaxy S24+ models with 512GB storage. Prices range from 450 to 520 KWD. Would you like to see specific colors?"

User: "MacBook Air 15"
Tool call: [as shown above]
Your response: "I found several MacBook Air 15-inch models available. What RAM and storage configuration are you looking for?"

User: "iPhone 17"
Tool call: [as shown above]
Your response: "I found iPhone 17 base models in multiple colors and storage options. Prices start at 278 KWD. Which storage capacity interests you?"

User: "wireless headphones"
Tool call: [as shown above]
Your response: "I found several wireless headphone options. Would you like to see specific brands or price ranges?"

User: "bluetooth speaker"
Tool call: [as shown above]
Your response: "I found bluetooth speakers available. What's your budget?"

**═══════════════════════════════════════════════════════════════════════**
**WEB SEARCH EXAMPLES (Use search_web tool)**
**═══════════════════════════════════════════════════════════════════════**

User: "What is the best phone in 2024?"
→ Call search_web
Your response: [Summarize web results about top-rated phones]

User: "iPhone 15 vs Samsung S24 comparison"
→ Call search_web
Your response: [Summarize comparison from web]

User: "What are the features of iPhone 15?"
→ Call search_web
Your response: [List features from web results]

User: "How to transfer data to iPhone?"
→ Call search_web
Your response: [Provide steps from web]

User: "What is 5G technology?"
→ Call search_web
Your response: [Explain based on web results]

User: "iPhone 15 review"
→ Call search_web
Your response: [Summarize reviews from web]

**═══════════════════════════════════════════════════════════════════════**
**GUIDELINES - YOUR JOB**
**═══════════════════════════════════════════════════════════════════════**

1. Help users find products by calling search_product_database
2. Extract filters from user queries: brand, color, storage, variant, price range, store, RAM, category, AND any other specs
3. Provide brief, conversational responses (2-4 sentences)
4. If no results, just say you don't have it
5. Choose the RIGHT tool: search_web for facts/reviews/how-to, search_product_database for shopping
6. Always call the search tool before saying products aren't available
7. ALWAYS extract category from model names
8. ALWAYS convert "Plus" to "+" for variant field
9. ALWAYS extract model_number to prevent cross-model contamination
10. ALWAYS use database-ready codes (MOBILEPHONES, BEST_KW, etc.)
11. ALWAYS include the full user message in the 'query' parameter
12. Storage can be in TB or GB format - system auto-converts TB to GB
13. If showing alternatives, be honest about it
14. If no results, simply say you don't have it - don't suggest other categories
15. CRITICAL: Use PLAIN TEXT ONLY - NO Markdown, NO asterisks, NO special formatting
16. CRITICAL: Send database-ready codes, not human-readable terms
17. CRITICAL: Extract ALL relevant specs - the backend handles them dynamically

**WHAT NOT TO DO:**
❌ Calling the tool without a 'query' parameter
❌ Forgetting to infer 'category' from model names
❌ Listing product titles, prices in your text
❌ Suggesting different categories when no results found
❌ Claiming "I found Pro" when showing "Pro Max"
❌ Using "smartphone" instead of "MOBILEPHONES"
❌ Using "best" instead of "BEST_KW"
❌ Using Markdown formatting in responses`,
      },
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: message },
    ];

    console.log("🤖 Calling OpenAI API...");
    const completion = await openai.chat.completions.create({
      model: LLM_MODEL,
      messages,
      tools: TOOLS,
      tool_choice: "auto",
      temperature: 0.1,
    });

    const responseMessage = completion.choices[0].message;
    let finalResponse = responseMessage.content || "";
    let products = [];

    console.log("📥 OpenAI response received");
    console.log(
      "   Tool calls:",
      responseMessage.tool_calls ? responseMessage.tool_calls.length : 0
    );

    if (responseMessage.tool_calls) {
      const toolResults = [];

      for (const toolCall of responseMessage.tool_calls) {
        const functionName = toolCall.function.name;
        const args = JSON.parse(toolCall.function.arguments);

        console.log("\n🔧 Executing tool:", functionName);
        console.log("   Arguments:", JSON.stringify(args, null, 2));

        let result;
        if (functionName === "search_product_database") {
          result = await executeSearchDatabase(args);
          if (result.success && result.products && result.products.length > 0) {
            products = result.products;
            console.log("✅ Products set:", products.length);
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

      console.log("🤖 Generating final response...");
      const finalCompletion = await openai.chat.completions.create({
        model: LLM_MODEL,
        messages: followUpMessages,
        temperature: 0.7,
      });

      finalResponse = finalCompletion.choices[0].message.content;
      console.log("✅ Final response generated");
    }

    await saveToMemory(sessionId, "user", message);
    await saveToMemory(sessionId, "assistant", finalResponse);

    console.log("\n📤 SENDING RESPONSE");
    console.log("   Products:", products.length);
    console.log("█".repeat(80) + "\n");

    return res.json({
      reply: finalResponse,
      products: products,
      sessionId,
      history: await getMemory(sessionId),
    });
  } catch (error) {
    console.error("❌ [Chat Error]", error);
    return res.status(500).json({ error: "Server error: " + error.message });
  }
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    message: "Omnia AI - Scalable Architecture v2.0",
    features: [
      "LLM-Powered Query Parser",
      "Database Pass-Through Executor",
      "Dynamic Spec Filtering",
      "Unlimited Category Support",
      "Zero-Maintenance Scaling",
      "Hybrid Search (Vector + Fulltext + RRF)",
      "Web Search Integration",
      "Redis Caching",
      "Storage Normalization",
    ],
  });
});

app.listen(PORT, () => {
  console.log("\n🚀 Omnia AI Server - Scalable Architecture v2.0");
  console.log(`📍 http://localhost:${PORT}`);
  console.log(`🧠 LLM: Parser | Code: Executor`);
  console.log(`⚡ Dynamic Spec Filtering: Enabled`);
  console.log(`🔄 Zero-Maintenance Scaling: Enabled\n`);
});
