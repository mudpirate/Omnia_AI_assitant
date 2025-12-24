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

const TOOLS = [
  {
    type: "function",
    function: {
      name: "search_product_database",
      description:
        "Search for products. Extract all specifications accurately from the user query.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Full natural language search query from user. REQUIRED. This must be the complete user message.",
          },
          category: {
            type: "string",
            description: `Product category. CRITICAL: ALWAYS infer category from model names to prevent cross-category contamination.
              
  INFERENCE RULES:
  - "iPhone", "Galaxy S/Note/Z", "Pixel" → "smartphone"
  - "MacBook", "ThinkPad", "XPS", "Pavilion", "IdeaPad" → "laptop"
  - "iPad", "Galaxy Tab", "Surface" → "tablet"
  - "AirPods", "WH-", "QuietComfort", "Buds", "headphone", "headphones", "earbuds", "earphones" → "headphone"
  - "Apple Watch", "Galaxy Watch" → "smartwatch"
  - "case", "cover", "screen protector" → "accessory"
  - "charger", "cable", "adapter" → "accessory"
  - "power bank", "battery" → "accessory"
  - "mouse", "keyboard" → "accessory"
  - "speaker", "speakers", "soundbar" → "speaker"
  - "TV", "television", "monitor" → "display"
  - "camera", "DSLR", "mirrorless" → "camera"
  - "desktop", "PC", "tower" → "desktop"

  Examples:
  - "iPhone 15" → category: "smartphone"
  - "MacBook Air" → category: "laptop"
  - "iPad Pro" → category: "tablet"
  - "AirPods Max" → category: "headphone"
  - "iPhone case" → category: "accessory"
  - "phone charger" → category: "accessory"
  - "wireless mouse" → category: "accessory"
  - "bluetooth speaker" → category: "speaker"
  - "gaming desktop" → category: "desktop"
  - "wireless headphones" → category: "headphone"

  If user explicitly mentions a category, use that. Otherwise, ALWAYS infer from product name.
  This prevents showing phones when searching for cases!`,
          },
          brand: {
            type: "string",
            description:
              "Brand name. CRITICAL: Infer the brand if the model name implies it (e.g. 'iPhone' -> 'Apple', 'Galaxy' -> 'Samsung', 'Pixel' -> 'Google', 'Air Jordan' -> 'Nike', 'XPS' -> 'Dell', 'ThinkPad' -> 'Lenovo'). Extract the CORE brand name only, without suffixes like 'Inc', 'Corp', 'Ltd'.",
          },
          variant: {
            type: "string",
            description:
              "Model variant. CRITICAL RULES: (1) If user says ONLY model number WITHOUT variant keywords (Pro/Plus/Max/Ultra/Mini) → SET to 'base' (e.g. 'iPhone 17' → 'base', 'Samsung S24' → 'base'). (2) If user says 'Plus' → convert to '+' symbol. (3) Extract EXACTLY as mentioned: 'Pro Max' → 'pro_max', 'Pro' → 'pro', 'Ultra' → 'ultra', 'Mini' → 'mini'. (4) Database stores 'Plus' as '+' symbol for exact matching. (5) Setting 'base' prevents showing Pro/Plus/Max variants when user just wants the standard model.",
          },
          color: {
            type: "string",
            description: "Color if mentioned (e.g., black, blue, silver)",
          },
          storage: {
            type: "string",
            description:
              "Storage/ROM/SSD capacity ONLY. CRITICAL RULES: (1) Only extract if user mentions 'storage', 'ROM', 'SSD', or uses numbers >= 64GB WITHOUT the word 'RAM'. (2) If query is '256gb phone' or '512gb storage' -> extract the storage value. (3) If query is '16gb ram and 256gb' -> storage is '256gb' (NOT 16gb). (4) Common storage values: 64gb, 128gb, 256gb, 512gb, 1tb, 2tb. (5) IMPORTANT: You can use EITHER 'TB' or 'GB' format - the system will automatically convert '1TB' to '1024GB' for accurate matching. Examples: '256gb iphone' -> '256gb', '1tb laptop' -> '1tb', '16gb ram 512gb phone' -> '512gb'",
          },
          ram: {
            type: "string",
            description:
              "RAM/Memory size ONLY. CRITICAL RULES: (1) Only extract if user explicitly mentions 'RAM' or 'memory'. (2) If query is '16gb ram phone' -> extract '16gb'. (3) If query is '8gb memory laptop' -> extract '8gb'. (4) If query is just '256gb phone' with NO 'RAM' keyword -> DO NOT extract as RAM (it's storage). (5) Common RAM values: 4gb, 8gb, 12gb, 16gb, 32gb, 64gb. Examples: '16gb ram iphone' -> '16gb', '8gb ram and 256gb storage' -> '8gb', '12gb memory phone' -> '12gb'",
          },
          size: {
            type: "string",
            description: "For clothes/shoes (e.g. 'M', 'L', '42', '10', 'XL')",
          },
          gender: {
            type: "string",
            description: "For clothes (e.g. 'Men', 'Women', 'Kids')",
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
            description:
              "Store name if specified. Use these EXACT lowercase values: 'xcite', 'best', 'noon', 'eureka'. The system will map them to database values automatically.",
          },
          model_number: {
            type: "string",
            description: `The SPECIFIC model identifier to search for. Extract the complete model designation that uniquely identifies this product.

  CRITICAL: Extract the FULL model string as it would appear in product titles, NOT just numbers.

  Examples:
  - "iPhone 15" → "iphone 15"
  - "Samsung S24" → "galaxy s24" or "s24"
  - "Galaxy S24 Plus" → "galaxy s24+" or "s24+"
  - "Pixel 8 Pro" → "pixel 8 pro"
  - "MacBook Air M2" → "macbook air m2"
  - "ThinkPad X1" → "thinkpad x1"
  - "XPS 13" → "xps 13"
  - "AirPods Pro 2" → "airpods pro 2"

  RULES:
  1. Include brand/series name + model number/identifier
  2. Include variant if it's part of the model name (Pro, Plus, Ultra, etc.)
  3. Do NOT include storage (512gb), RAM (16gb), or color
  4. Keep it concise - just the model identification string
  5. Lowercase format preferred

  This helps find exact product matches and prevents confusion with storage/RAM numbers.`,
          },
          megapixels: {
            type: "string",
            description: "Camera megapixels (e.g., '24mp', '48mp', '108mp')",
          },
          screen_size: {
            type: "string",
            description: "Screen/display size (e.g., '6.7', '15.6', '27')",
          },
          refresh_rate: {
            type: "string",
            description:
              "Display refresh rate (e.g., '120hz', '144hz', '240hz')",
          },
          resolution: {
            type: "string",
            description: "Screen resolution (e.g., '4K', '1080p', 'QHD', '8K')",
          },
          processor: {
            type: "string",
            description:
              "CPU/Processor (e.g., 'i7', 'i9', 'M2', 'Snapdragon 8 Gen 3')",
          },
          gpu: {
            type: "string",
            description:
              "Graphics card (e.g., 'RTX 4060', 'RTX 4090', 'AMD Radeon')",
          },
          battery: {
            type: "string",
            description:
              "Battery capacity (e.g., '5000mah', '10000mah', '100wh')",
          },
          weight: {
            type: "string",
            description: "Product weight (e.g., '1.5kg', '200g', '15kg')",
          },
          material: {
            type: "string",
            description:
              "Build material (e.g., 'aluminum', 'titanium', 'plastic', 'glass')",
          },
          connectivity: {
            type: "string",
            description:
              "Connectivity options (e.g., '5G', 'WiFi 6', 'Bluetooth 5.3')",
          },
          ports: {
            type: "string",
            description:
              "Available ports (e.g., 'USB-C', 'HDMI', 'Thunderbolt 4')",
          },
          operating_system: {
            type: "string",
            description:
              "OS (e.g., 'Windows 11', 'macOS', 'Android 14', 'iOS 17')",
          },
          warranty: {
            type: "string",
            description:
              "Warranty period (e.g., '1 year', '2 years', 'AppleCare')",
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
  console.log("   📏 Vector literal length:", vectorLiteral.length, "chars");

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

function buildPushDownFilters(filters = {}, rawQuery = "") {
  console.log("\n🔍 [FILTER BUILDER] Building WHERE clause");
  console.log("   📥 Input filters:", JSON.stringify(filters, null, 2));
  console.log("   📝 Raw query:", rawQuery);

  const conditions = [];

  const CORE_FIELDS = {
    minPrice: (value) => {
      if (value && value > 0) {
        const condition = `"price" >= ${parseFloat(value)}`;
        conditions.push(condition);
        console.log("   💰 Min price filter:", condition);
      }
    },
    maxPrice: (value) => {
      if (value && value < Infinity && value !== null) {
        const condition = `"price" <= ${parseFloat(value)}`;
        conditions.push(condition);
        console.log("   💰 Max price filter:", condition);
      }
    },
    storeName: (value) => {
      if (value && value !== "all") {
        const storeLower = value.toLowerCase().replace(/'/g, "''");
        const storeMapping = {
          best: "BEST_KW",
          xcite: "XCITE",
          eureka: "EUREKA",
          noon: "NOON",
        };
        const dbStoreName =
          storeMapping[storeLower] || value.toUpperCase().replace(/\./g, "_");
        const condition = `"storeName" = '${dbStoreName}'`;
        conditions.push(condition);
        console.log(
          "   🏪 Store filter:",
          condition,
          `(${storeLower} → ${dbStoreName})`
        );
      }
    },
    category: (value) => {
      if (value) {
        const catLower = value.toLowerCase().replace(/'/g, "''");
        const categoryMapping = {
          phone: "MOBILEPHONES",
          smartphone: "MOBILEPHONES",
          mobile: "MOBILEPHONES",
          laptop: "LAPTOPS",
          notebook: "LAPTOPS",
          tablet: "TABLETS",
          headphone: "AUDIO",
          headphones: "AUDIO",
          earphones: "AUDIO",
          earbuds: "AUDIO",
          smartwatch: "SMARTWATCHES",
          watch: "SMARTWATCHES",
          accessory: "ACCESSORIES",
          accessories: "ACCESSORIES",
          case: "ACCESSORIES",
          cover: "ACCESSORIES",
          charger: "ACCESSORIES",
          cable: "ACCESSORIES",
          adapter: "ACCESSORIES",
          speaker: "AUDIO",
          speakers: "AUDIO",
          display: "DISPLAYS",
          monitor: "DISPLAYS",
          tv: "DISPLAYS",
          camera: "CAMERAS",
          desktop: "DESKTOPS",
          pc: "DESKTOPS",
          tower: "DESKTOPS",
        };
        const dbCategory = categoryMapping[catLower] || catLower.toUpperCase();
        const condition = `"category" = '${dbCategory}'`;
        conditions.push(condition);
        console.log(
          "   📂 Category filter:",
          condition,
          `(${catLower} → ${dbCategory})`
        );
      }
    },
    brand: (value) => {
      if (value) {
        const brandLower = value.toLowerCase().replace(/'/g, "''");
        const condition = `LOWER("brand") ILIKE '%${brandLower}%'`;
        conditions.push(condition);
        console.log("   🏷️  Brand filter:", condition);
      }
    },
    modelNumber: (value) => {
      if (value) {
        const modelNum = value.replace(/'/g, "''");
        const condition = `LOWER("title") LIKE '%${modelNum}%'`;
        conditions.push(condition);
        console.log("   🔢 Model number filter:", condition);
      }
    },
  };

  const EXACT_MATCH_SPECS = ["variant", "storage"];
  const FLEXIBLE_MATCH_SPECS = [
    "color",
    "ram",
    "size",
    "gender",
    "megapixels",
    "screen_size",
    "refresh_rate",
    "resolution",
    "processor",
    "gpu",
    "battery",
    "weight",
    "material",
    "connectivity",
    "ports",
    "operating_system",
    "warranty",
  ];

  const stockCondition = `"stock" = 'IN_STOCK'`;
  conditions.push(stockCondition);
  console.log("   📦 Stock filter:", stockCondition);

  Object.keys(filters).forEach((key) => {
    const value = filters[key];

    if (!value || value === null || value === undefined) return;

    if (CORE_FIELDS[key]) {
      CORE_FIELDS[key](value);
    } else if (EXACT_MATCH_SPECS.includes(key)) {
      const specValue = value.toString().toLowerCase().replace(/'/g, "''");
      const condition = `LOWER("specs"->>'${key}') = '${specValue}'`;
      conditions.push(condition);
      console.log(`   🎯 EXACT MATCH spec [${key}]:`, condition);
    } else if (FLEXIBLE_MATCH_SPECS.includes(key)) {
      const specValue = value.toString().toLowerCase().replace(/'/g, "''");
      const condition = `LOWER("specs"->>'${key}') ILIKE '%${specValue}%'`;
      conditions.push(condition);
      console.log(`   🔄 FLEXIBLE MATCH spec [${key}]:`, condition);
    } else if (key !== "query") {
      const specValue = value.toString().toLowerCase().replace(/'/g, "''");
      const condition = `LOWER("specs"->>'${key}') ILIKE '%${specValue}%'`;
      conditions.push(condition);
      console.log(`   ❓ OTHER spec [${key}]:`, condition);
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

  console.log("   📝 SQL Query (truncated):", query.substring(0, 500) + "...");

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
        if (r.specs) {
          console.log(
            `         Specs:`,
            JSON.stringify(r.specs).substring(0, 100)
          );
        }
      });
    }

    return results;
  } catch (error) {
    console.error("   ❌ [Vector Search] Error:", error.message);
    console.error("   Full error:", error);
    return [];
  }
}

async function fulltextSearch(searchQuery, filters = {}, limit = 100) {
  console.log("\n📝 [FULLTEXT SEARCH] Starting fulltext search");
  console.log("   🔍 Search term:", searchQuery);
  console.log("   🔢 Limit:", limit);

  const whereClause = buildPushDownFilters(filters, searchQuery);
  const searchTerm = searchQuery.toLowerCase().trim().replace(/'/g, "''");

  if (!searchTerm) {
    console.log("   ⚠️  Empty search term, returning no results");
    return [];
  }

  try {
    await prisma.$executeRawUnsafe(`SET pg_trgm.similarity_threshold = 0.5;`);
    console.log("   ⚙️  Set similarity threshold to 0.5");

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

    console.log(
      "   📝 Primary SQL Query (truncated):",
      query.substring(0, 500) + "..."
    );

    let results = await prisma.$queryRawUnsafe(query);
    console.log("   📊 Primary search results:", results.length);

    if (results.length === 0) {
      console.log("   🔄 No results from primary search, trying fallback...");

      const words = searchTerm
        .split(/\s+/)
        .filter(
          (word) =>
            word.length > 2 &&
            !["the", "and", "for", "with", "from"].includes(word)
        );

      console.log("   📝 Extracted keywords:", words);

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

        console.log(
          "   📝 Fallback SQL Query (truncated):",
          fallbackQuery.substring(0, 500) + "..."
        );
        results = await prisma.$queryRawUnsafe(fallbackQuery);
        console.log("   📊 Fallback search results:", results.length);
      }
    }

    if (results.length > 0) {
      console.log("   🔝 Top 3 fulltext results:");
      results.slice(0, 3).forEach((r, i) => {
        console.log(`      ${i + 1}. ${r.title}`);
        console.log(
          `         Price: ${r.price} KWD | Store: ${r.storeName} | Category: ${r.category}`
        );
        console.log(`         Rank: ${r.rank?.toFixed(4)}`);
      });
    }

    return results;
  } catch (error) {
    console.error("   ❌ [Fulltext Search] Error:", error.message);
    console.error("   Full error:", error);
    return [];
  }
}

function reciprocalRankFusion(vectorResults, fulltextResults, k = 60) {
  console.log("\n🔀 [RRF FUSION] Starting Reciprocal Rank Fusion");
  console.log("   📊 Vector results:", vectorResults.length);
  console.log("   📊 Fulltext results:", fulltextResults.length);
  console.log("   ⚙️  K parameter:", k);

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
  console.log("   ✅ Processed vector results");

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
  console.log("   ✅ Processed fulltext results");

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
    console.log(
      "   ✅ Using fulltext-weighted scoring (95% fulltext, 5% vector)"
    );
  } else {
    finalResults = vectorOnlyMatches.map((item) => ({
      finalScore: item.vectorScore * 0.02,
      ...item,
    }));
    console.log("   ✅ Using vector-only scoring (2% weight)");
  }

  finalResults.sort((a, b) => b.finalScore - a.finalScore);

  const fused = finalResults.map((item) => ({
    ...item.product,
    rrfScore: item.finalScore,
  }));

  console.log("   📊 Total fused results:", fused.length);
  if (fused.length > 0) {
    console.log("   🏆 Top 5 fused results:");
    fused.slice(0, 5).forEach((r, i) => {
      console.log(`      ${i + 1}. ${r.title}`);
      console.log(`         RRF Score: ${r.rrfScore?.toFixed(6)}`);
      console.log(`         Price: ${r.price} KWD | Category: ${r.category}`);
    });
  }

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
  console.log("   🔢 Limit:", limit);
  console.log("   🎛️  Filters:", JSON.stringify(filters, null, 2));

  const [vectorResults, fulltextResults] = await Promise.all([
    vectorSearch(vectorLiteral, filters, limit * 2, searchQuery),
    fulltextSearch(searchQuery, filters, limit * 2),
  ]);

  if (vectorResults.length > 0 || fulltextResults.length > 0) {
    const fusedResults = reciprocalRankFusion(vectorResults, fulltextResults);
    const finalResults = fusedResults.slice(0, limit);
    console.log(
      "   ✅ Hybrid search completed with",
      finalResults.length,
      "results"
    );
    return finalResults;
  }

  console.log("   ⚠️  No results found, trying RELAXED search...");

  const relaxedFilters = {
    minPrice: filters.minPrice,
    maxPrice: filters.maxPrice,
    storeName: filters.storeName,
    category: filters.category,
    brand: filters.brand,
    modelNumber: filters.modelNumber,
    storage: filters.storage,
    ram: filters.ram,
  };

  console.log(
    "   🎛️  Relaxed filters:",
    JSON.stringify(relaxedFilters, null, 2)
  );

  const [relaxedVector, relaxedFulltext] = await Promise.all([
    vectorSearch(vectorLiteral, relaxedFilters, limit * 2, searchQuery),
    fulltextSearch(searchQuery, relaxedFilters, limit * 2),
  ]);

  const fusedResults = reciprocalRankFusion(relaxedVector, relaxedFulltext);
  const finalResults = fusedResults.slice(0, limit);

  console.log(
    "   ✅ Relaxed search completed with",
    finalResults.length,
    "results"
  );

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
    ram,
    size,
    gender,
    model_number,
  } = args;

  if (!query || query === "undefined" || query.trim() === "") {
    console.error(
      `❌ [Tool: search_product_database] Invalid query: "${query}"`
    );
    return {
      success: false,
      error: "Invalid search query. Please provide a valid search term.",
      count: 0,
      products: [],
    };
  }

  console.log("✅ Query validation passed:", query);

  const normalizedStorage = storage ? normalizeStorage(storage) : null;

  const mergedFilters = {
    minPrice: min_price || 0,
    maxPrice: max_price || null,
    storeName: store_name || null,
    brand: brand || null,
    color: color || null,
    storage: normalizedStorage,
    variant: variant || null,
    category: category || null,
    ram: ram || null,
    size: size || null,
    gender: gender || null,
    modelNumber: model_number || null,
  };

  console.log("🔄 Merged filters (before cleanup):");
  console.log(JSON.stringify(mergedFilters, null, 2));

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

  console.log("✨ Final filters (after cleanup):");
  console.log(JSON.stringify(finalFilters, null, 2));

  try {
    const { vectorLiteral } = await getQueryEmbedding(query);
    const results = await hybridSearch(query, vectorLiteral, finalFilters, 50);

    const actualCount = Math.min(results.length, 5);
    const productsToReturn = results.slice(0, actualCount);

    console.log("\n📦 [PRODUCTS TO FRONTEND]");
    console.log("   Total results from search:", results.length);
    console.log("   Products being sent to frontend:", productsToReturn.length);

    if (productsToReturn.length > 0) {
      console.log("\n   📋 Detailed product list:");
      productsToReturn.forEach((p, i) => {
        console.log(`\n   Product ${i + 1}:`);
        console.log(`   ├─ Title: ${p.title}`);
        console.log(`   ├─ Price: ${p.price} KWD`);
        console.log(`   ├─ Store: ${p.storeName}`);
        console.log(`   ├─ Category: ${p.category}`);
        console.log(`   ├─ Brand: ${p.brand}`);
        console.log(`   ├─ RRF Score: ${p.rrfScore?.toFixed(4)}`);
        console.log(`   ├─ URL: ${p.productUrl}`);
        console.log(`   ├─ Image: ${p.imageUrl ? "Yes" : "No"}`);
        if (p.specs) {
          console.log(
            `   └─ Specs: ${JSON.stringify(p.specs).substring(0, 150)}...`
          );
        }
      });
    } else {
      console.log("   ⚠️  NO PRODUCTS TO SEND TO FRONTEND");
    }

    console.log("\n" + "=".repeat(80));
    console.log("✅ [TOOL: search_product_database] EXECUTION COMPLETED");
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
    console.error(`❌ [Tool: search_product_database] Error:`, error);
    console.error("Full error stack:", error.stack);
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
  console.log("📨 NEW CHAT REQUEST RECEIVED");
  console.log("█".repeat(80));
  console.log("User message:", message);
  console.log("Session ID:", sessionId || "NEW SESSION");

  if (!message || typeof message !== "string" || message.trim() === "") {
    return res.status(400).json({
      error: "Valid message is required",
      details: "The 'query' field must be a non-empty string",
    });
  }

  message = message.trim();

  if (!sessionId) {
    sessionId = uuidv4();
    console.log("Generated new session ID:", sessionId);
  }

  try {
    const history = await getMemory(sessionId);
    console.log("📚 Retrieved chat history:", history.length, "messages");

    const messages = [
      {
        role: "system",
        content: `You are Omnia AI, a helpful shopping assistant for electronics in Kuwait.

  **CRITICAL: TOOL SELECTION - READ THIS FIRST:**
  You have access to TWO tools. Choose the RIGHT tool for each query:

  1. **search_product_database** - Use for:
     - Finding products to buy (phones, laptops, headphones, etc.)
     - Price comparisons between stores
     - Product availability checks
     - Specific product specifications
     - Shopping recommendations
     Examples: "iPhone 15", "gaming laptops under 500 KWD", "wireless headphones"

  2. **search_web** - Use for:
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

  **CRITICAL FORMATTING INSTRUCTION - READ THIS FIRST:**
  - You MUST respond in PLAIN TEXT ONLY
  - NEVER use Markdown syntax (no **, no *, no #, no -, no numbered lists)
  - NO asterisks, NO bold formatting, NO bullet points
  - Write naturally as if speaking to someone
  - Use actual newlines (line breaks) to separate thoughts, NOT formatting characters

  **CRITICAL: ALWAYS CALL search_product_database BEFORE RESPONDING ABOUT PRODUCTS!**
  NEVER claim to have found products without actually calling the search tool first.
  NEVER make up prices, specifications, or product details.

  **CRITICAL TOOL CALL INSTRUCTION:**
  When the user sends you a message, you MUST call the search_product_database tool with:
  1. The FULL user message in the 'query' parameter
  2. The extracted filters in their respective parameters
  3. The MODEL NUMBER in the 'model_number' parameter

  Example of CORRECT tool call:
  User message: "iPhone 15 from xcite"
  Your tool call:
  {
    "query": "iPhone 15 from xcite",
    "brand": "apple",
    "category": "smartphone",
    "model_number": "iphone 15",
    "variant": "base",
    "store_name": "xcite"
  }

  User message: "samsung s24 plus 512gb"
  Your tool call:
  {
    "query": "samsung s24 plus 512gb",
    "brand": "samsung",
    "category": "smartphone",
    "model_number": "galaxy s24+",
    "variant": "+",
    "storage": "512gb"
  }

  User message: "iPhone 15 Pro Max"
  Your tool call:
  {
    "query": "iPhone 15 Pro Max",
    "brand": "apple",
    "category": "smartphone",
    "model_number": "iphone 15 pro max",
    "variant": "pro_max"
  }

  User message: "iPhone 17"
  Your tool call:
  {
    "query": "iPhone 17",
    "brand": "apple",
    "category": "smartphone",
    "model_number": "iphone 17",
    "variant": "base"
  }

  User message: "Samsung S24"
  Your tool call:
  {
    "query": "Samsung S24",
    "brand": "samsung",
    "category": "smartphone",
    "model_number": "galaxy s24",
    "variant": "base"
  }

  User message: "macbook air m2"
  Your tool call:
  {
    "query": "macbook air m2",
    "brand": "apple",
    "category": "laptop",
    "model_number": "macbook air m2"
  }

  User message: "thinkpad x1 carbon"
  Your tool call:
  {
    "query": "thinkpad x1 carbon",
    "brand": "lenovo",
    "category": "laptop",
    "model_number": "thinkpad x1 carbon"
  }

  User message: "wireless headphones"
  Your tool call:
  {
    "query": "wireless headphones",
    "category": "headphone"
  }

  User message: "bluetooth speaker"
  Your tool call:
  {
    "query": "bluetooth speaker",
    "category": "speaker"
  }

  User message: "gaming desktop"
  Your tool call:
  {
    "query": "gaming desktop",
    "category": "desktop"
  }

  **CRITICAL MODEL NUMBER EXTRACTION:**

  The 'model_number' parameter is the KEY to finding exact products across ANY brand.

  RULES:
  1. Extract the FULL model string as users would say it
  2. Include brand/series + model identifier
  3. Examples:
    - "iPhone 15" → model_number: "iphone 15"
    - "Galaxy S24" → model_number: "galaxy s24" or "s24"
    - "Pixel 8 Pro" → model_number: "pixel 8 pro"
    - "XPS 13" → model_number: "xps 13"
    - "ThinkPad T14" → model_number: "thinkpad t14"
    - "ROG Strix" → model_number: "rog strix"

  4. DO NOT include storage/RAM/color in model_number
  5. Keep it concise and lowercase

  **WHY THIS IS CRITICAL:**
  Without model_number, searching "Samsung S24 Plus 512GB" could match "iPhone 15 Plus 512GB" 
  because both have "Plus" variant and "512GB" storage. The model_number ensures we ONLY 
  match Samsung S24 models.

  **CRITICAL CATEGORY INFERENCE - PREVENTS CROSS-CATEGORY CONTAMINATION:**

  You MUST ALWAYS infer the category from model names. This prevents showing laptops when searching for phones!

  INFERENCE RULES:
  1. **Smartphones:**
    - "iPhone" → category: "smartphone"
    - "Galaxy S/Note/Z" → category: "smartphone"
    - "Pixel" → category: "smartphone"

  2. **Laptops:**
    - "MacBook" → category: "laptop"
    - "ThinkPad", "XPS", "Pavilion" → category: "laptop"

  3. **Tablets:**
    - "iPad" → category: "tablet"
    - "Galaxy Tab" → category: "tablet"

  4. **Headphones/Audio:**
    - "AirPods", "headphones", "headphone", "earbuds", "earphones" → category: "headphone"
    - "WH-", "QuietComfort", "Buds" → category: "headphone"

  5. **Speakers:**
    - "speaker", "speakers", "soundbar" → category: "speaker"

  6. **Desktops:**
    - "desktop", "PC", "tower", "gaming pc" → category: "desktop"

  **WHY THIS IS CRITICAL:**
  Without category filtering, searching for "iPhone 15" could return "MacBook Air 15.3-inch" because:
  - Both are Apple products
  - Both have "15" in the name
  - Without category, the system can't distinguish them

  **CRITICAL RAM vs STORAGE EXTRACTION RULES:**

  1. **RAM Extraction (only when explicitly mentioned):**
    - Extract RAM ONLY if the query contains "RAM" or "memory" keywords
    - Examples:
      * "16gb ram phone" → ram: "16gb", storage: null
      * "8gb ram laptop" → ram: "8gb", storage: null

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

  **CRITICAL VARIANT EXTRACTION RULES:**
  
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

  **SMART ALTERNATIVE HANDLING:**
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

  **CRITICAL STORE NAME EXTRACTION:**
  Use these EXACT lowercase values:
  - "xcite"
  - "best"
  - "eureka"
  - "noon"

  **DYNAMIC SPEC EXTRACTION (AUTOMATIC FOR ALL CATEGORIES):**

  The system now supports ANY specification automatically! You don't need special instructions for new categories.

  **How it works:**
  - You extract ANY spec from the user query
  - The system automatically adds it to the search filters
  - No code changes needed for new product types

  **Examples of Dynamic Specs:**

  Cameras:
  - "24mp Sony camera" → megapixels: "24mp"
  - "4K video camera" → resolution: "4K"

  TVs/Monitors:
  - "27 inch monitor" → screen_size: "27"
  - "144hz gaming monitor" → refresh_rate: "144hz"
  - "4K TV" → resolution: "4K"

  Laptops:
  - "i7 laptop" → processor: "i7"
  - "RTX 4060 laptop" → gpu: "RTX 4060"
  - "15.6 inch laptop" → screen_size: "15.6"

  Smartwatches:
  - "titanium apple watch" → material: "titanium"
  - "5G watch" → connectivity: "5G"

  ANY Product:
  - "5000mah battery" → battery: "5000mah"
  - "aluminum build" → material: "aluminum"
  - "USB-C port" → ports: "USB-C"
  - "WiFi 6" → connectivity: "WiFi 6"

  **Tool Call Examples with Dynamic Specs:**

  User: "24mp Sony camera"
  Tool call: {
    query: "24mp Sony camera",
    brand: "sony",
    category: "camera",
    megapixels: "24mp"
  }

  User: "144hz gaming monitor under 300 KWD"
  Tool call: {
    query: "144hz gaming monitor under 300 KWD",
    category: "display",
    refresh_rate: "144hz",
    max_price: 300
  }

  User: "i7 laptop with RTX 4060"
  Tool call: {
    query: "i7 laptop with RTX 4060",
    category: "laptop",
    processor: "i7",
    gpu: "RTX 4060"
  }

  User: "titanium Apple Watch"
  Tool call: {
    query: "titanium Apple Watch",
    brand: "apple",
    category: "smartwatch",
    material: "titanium"
  }

  **CRITICAL NO RESULTS HANDLING:**

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
  ❌ "I found several options for iPhone cases" (when showing phones)

  **ALWAYS verify the category matches what the user asked for!**

  **YOUR JOB:**
  1. Help users find products by calling search_product_database
  2. Extract filters from user queries: brand, color, storage, variant, price range, store, RAM, AND CATEGORY
  3. Provide brief, conversational responses
  4. If no results, just say you don't have it

  **CRITICAL RESPONSE RULE:**
  When you call search_product_database and get results:
  - DO NOT list product details in your text response
  - DO NOT format products with titles, prices, or specifications
  - The frontend will automatically display product cards with all details

  **CRITICAL FORMATTING RULES:**
  - NEVER use Markdown formatting (no ** for bold, no * for bullets, no # for headers)
  - Write in plain text only
  - If listing multiple items, use ACTUAL NEWLINES between each item
  - DO NOT use asterisks (*) or any special characters for formatting
  - Keep text natural and conversational

  **CORRECT RESPONSE FORMAT:**
  After calling the tool and getting products, respond with:
  - A brief introduction (1-2 sentences)
  - Optional helpful context about the results
  - Questions to help narrow down choices (if applicable)

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

  **EXAMPLES:**

  User: "iPhone 15 from Best"
  Tool call: {
    query: "iPhone 15 from Best",
    brand: "apple",
    category: "smartphone",
    variant: "base",
    store_name: "best"
  }
  Your response: "I found several iPhone 15 base models at Best with different storage options and colors. Prices range from 250 to 350 KWD. What storage capacity would you prefer?"

  User: "Samsung S24 Plus 512GB"
  Tool call: {
    query: "Samsung S24 Plus 512GB",
    brand: "samsung",
    category: "smartphone",
    variant: "+",
    storage: "512gb"
  }
  Your response: "I found Samsung Galaxy S24+ models with 512GB storage. Prices range from 450 to 520 KWD. Would you like to see specific colors?"

  User: "MacBook Air 15"
  Tool call: {
    query: "MacBook Air 15",
    brand: "apple",
    category: "laptop",
    variant: "air"
  }
  Your response: "I found several MacBook Air 15-inch models available. What RAM and storage configuration are you looking for?"

  User: "iPhone 17"
  Tool call: {
    query: "iPhone 17",
    brand: "apple",
    category: "smartphone",
    model_number: "iphone 17",
    variant: "base"
  }
  Your response: "I found iPhone 17 base models in multiple colors and storage options. Prices start at 278 KWD. Which storage capacity interests you?"

  User: "iPhone 15 Pro Max 1TB"
  Tool call: {
    query: "iPhone 15 Pro Max 1TB",
    brand: "apple",
    category: "smartphone",
    model_number: "iphone 15 pro max",
    variant: "pro_max",
    storage: "1tb"
  }
  Your response: "I found iPhone 15 Pro Max models with 1TB storage. Prices range from 550 to 620 KWD. Would you like to see the available colors?"

  User: "iPhone 15 Pro"
  Tool call: {
    query: "iPhone 15 Pro",
    brand: "apple",
    category: "smartphone",
    model_number: "iphone 15 pro",
    variant: "pro"
  }
  Tool returns: 0 strict results, but relaxed search finds Pro Max models
  Your response: "I don't have the iPhone 15 Pro in stock right now, but I found the iPhone 15 Pro Max which is similar! Would you like to see those options?"

  User: "iPhone 14"
  Tool call: {
    query: "iPhone 14",
    brand: "apple",
    category: "smartphone",
    model_number: "iphone 14",
    variant: "base"
  }
  Tool returns: Base iPhone 14 models only
  Your response: "I found iPhone 14 base models! What storage capacity would you prefer?"

  User: "iPhone case"
  Tool call: {
    query: "iPhone case",
    brand: "apple",
    category: "accessory"
  }
  Tool returns: 0 products
  Your response: "I don't have iPhone cases in my database right now."

  User: "wireless headphones"
  Tool call: {
    query: "wireless headphones",
    category: "headphone"
  }
  Your response: "I found several wireless headphone options. Would you like to see specific brands or price ranges?"

  User: "bluetooth speaker"
  Tool call: {
    query: "bluetooth speaker",
    category: "speaker"
  }
  Your response: "I found bluetooth speakers available. What's your budget?"

  **WHAT NOT TO DO:**
  ❌ Calling the tool without a 'query' parameter
  ❌ Forgetting to infer 'category' from model names
  ❌ Listing product titles, prices in your text
  ❌ Suggesting different categories when no results found
  ❌ Claiming "I found Pro" when showing "Pro Max"

  **GUIDELINES:**
  - Keep responses concise (2-4 sentences)
  - Be conversational and helpful
  - Choose the RIGHT tool: web_search for facts/reviews/how-to, product_database for shopping
  - Always call the search tool before saying products aren't available
  - ALWAYS extract category from model names
  - ALWAYS convert "Plus" to "+" for variant field
  - ALWAYS extract model_number to prevent cross-model contamination
  - ALWAYS use lowercase store names
  - ALWAYS include the full user message in the 'query' parameter
  - Storage can be in TB or GB format - system auto-converts TB to GB
  - If showing alternatives, be honest about it
  - If no results, simply say you don't have it - don't suggest other categories
  - CRITICAL: Use PLAIN TEXT ONLY - NO Markdown, NO asterisks, NO special formatting

  **WEB SEARCH EXAMPLES (Use search_web tool):**

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

  **PRODUCT SEARCH EXAMPLES (Use search_product_database):**

  User: "Show me iPhone 15"
  → Call search_product_database
  Your response: [Brief intro, products display automatically]

  User: "Gaming laptop under 800 KWD"
  → Call search_product_database
  Your response: [Brief intro, products display automatically]

  User: "Do you have AirPods Pro?"
  → Call search_product_database
  Your response: [Brief intro, products display automatically]`,
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
            console.log("✅ Products set for frontend:", products.length);
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

      console.log("🤖 Calling OpenAI API for final response...");
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

    console.log("\n📤 SENDING RESPONSE TO FRONTEND");
    console.log("   Reply length:", finalResponse.length, "chars");
    console.log("   Products count:", products.length);
    console.log("█".repeat(80) + "\n");

    return res.json({
      reply: finalResponse,
      products: products,
      sessionId,
      history: await getMemory(sessionId),
    });
  } catch (error) {
    console.error("❌ [Chat Error]", error);
    console.error("Full stack:", error.stack);
    return res.status(500).json({ error: "Server error: " + error.message });
  }
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    message: "Omnia AI - Production-Ready Hybrid Search WITH DETAILED LOGGING",
    features: [
      "Push-Down Filtering",
      "Scalable Query Analysis",
      "Semantic Vector Search",
      "Multi-Strategy Fulltext Search",
      "JSONB Specs Filtering",
      "Fulltext-Only RRF Mode",
      "Dynamic Result Limiting",
      "Web Search Integration",
      "Redis Caching",
      "Exact Model Number Matching",
      "Unlimited Brand Support",
      "Advanced RAM/Storage Separation",
      "EXACT Variant Matching",
      "Store Name Mapping",
      "Flexible Brand Matching",
      "Category Inference",
      "No Cross-Category Contamination",
      "Smart Model Number Detection",
      "Storage Normalization",
      "COMPREHENSIVE LOGGING",
    ],
  });
});

app.listen(PORT, () => {
  console.log("\n🚀 Omnia AI Server Running - PRODUCTION READY WITH LOGGING");
  console.log(`📍 http://localhost:${PORT}`);
  console.log(`🔥 Production-Ready for 500k+ Products`);
  console.log(`📊 Hybrid Search: Vector + Fulltext + RRF`);
  console.log(`⚡ Push-Down Filtering: Enabled`);
  console.log(`🧠 Scalable Query Analysis: Enabled`);
  console.log(`✅ Multi-Strategy Fulltext: Enabled`);
  console.log(`🎯 Fulltext-Only Mode: Enabled`);
  console.log(`💽 Storage Normalization: Enabled`);
  console.log(`📝 DETAILED LOGGING: ENABLED\n`);
});
