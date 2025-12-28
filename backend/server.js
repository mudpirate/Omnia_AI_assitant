import "dotenv/config";
import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";
import { v4 as uuidv4 } from "uuid";
import multer from "multer";
import fs from "fs/promises";
import path from "path";
import { systemprompt } from "./systemprompt.js";

const app = express();
const PORT = process.env.PORT || 4000;
const LLM_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const VISION_MODEL = "gpt-4o-mini";
const EMBEDDING_MODEL =
  process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/png", "image/jpg", "image/webp"];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only JPEG, PNG, and WebP are allowed."));
    }
  },
});

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

// Image-to-Text Analysis Function
async function analyzeProductImage(imageBuffer, mimeType) {
  console.log("\n🖼️  [IMAGE ANALYSIS] Starting vision analysis");
  console.log("   📊 Image size:", imageBuffer.length, "bytes");
  console.log("   🎨 MIME type:", mimeType);

  try {
    const base64Image = imageBuffer.toString("base64");
    const imageUrl = `data:${mimeType};base64,${base64Image}`;

    console.log("   🤖 Calling GPT-4 Vision API...");

    const response = await openai.chat.completions.create({
      model: VISION_MODEL,
      messages: [
        {
          role: "system",
          content: `You are a product identification expert specializing in electronics and fashion items. 

Your job is to analyze product images and generate a concise search query that can be used to find the product in a database.

**IMPORTANT RULES:**

1. **Identify the product category:**
   - Electronics: phones, laptops, tablets, headphones, cameras, smartwatches, speakers, etc.
   - Fashion: clothing (shirts, pants, dresses, jackets), footwear (sneakers, boots, sandals), accessories (bags, jewelry, hats)

2. **Extract key details:**
   - Brand (if visible): Apple, Samsung, Nike, Adidas, H&M, Zara, etc.
   - Model/Product type: iPhone 15, Galaxy S24, MacBook Air, running shoes, jeans, dress, etc.
   - Color (if distinctive): Black, White, Blue, Red, etc.
   - Variant (if visible): Pro, Plus, Max, Ultra, Mini
   - For fashion: Gender (Men's, Women's, Unisex), Style (slim fit, oversized, etc.)

3. **Generate a natural search query:**
   - Format: "[Brand] [Product Type] [Key Details]"
   - Examples:
     * "iPhone 15 Pro Max Black"
     * "Samsung Galaxy S24 Plus"
     * "Apple MacBook Air 15 inch"
     * "Nike Air Max sneakers white"
     * "Adidas running shoes black"
     * "Men's slim fit jeans blue"
     * "Women's black dress"
     * "Leather backpack brown"

4. **If uncertain:**
   - Focus on the most obvious features
   - Avoid making assumptions about specific models if unclear
   - Use generic terms: "smartphone", "laptop", "sneakers", "jeans"

5. **Response format:**
   - Return ONLY the search query text
   - Keep it concise (3-8 words)
   - No explanations, just the query

**Examples:**

Image of an iPhone → "iPhone 15 Pro Black"
Image of sneakers → "Nike Air Max white sneakers"
Image of a laptop → "MacBook Air silver"
Image of jeans → "Men's blue jeans"
Image of a dress → "Women's black dress"
Image of headphones → "Sony wireless headphones black"`,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Analyze this product image and generate a search query to find this product.",
            },
            {
              type: "image_url",
              image_url: {
                url: imageUrl,
                detail: "high",
              },
            },
          ],
        },
      ],
      max_tokens: 100,
      temperature: 0.3,
    });

    const searchQuery = response.choices[0].message.content.trim();

    console.log("   ✅ Vision analysis completed");
    console.log("   🔍 Generated query:", searchQuery);
    console.log("   📊 Tokens used:", response.usage?.total_tokens);

    return {
      success: true,
      query: searchQuery,
      tokensUsed: response.usage?.total_tokens,
    };
  } catch (error) {
    console.error("   ❌ [Vision Analysis] Error:", error.message);
    return {
      success: false,
      error: error.message,
      query: null,
    };
  }
}

// LLM-powered category type detection (cached)
const categoryTypeCache = new Map();

async function getCategoryType(category) {
  if (!category) return "unknown";

  const categoryKey = category.toUpperCase();

  if (categoryTypeCache.has(categoryKey)) {
    console.log(
      `   💾 Cache hit for category: ${categoryKey} → ${categoryTypeCache.get(
        categoryKey
      )}`
    );
    return categoryTypeCache.get(categoryKey);
  }

  console.log(`   🤖 Asking LLM to categorize: ${categoryKey}`);

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a product categorization expert. Given a product category, determine if it belongs to "electronics" or "fashion".

Electronics includes: phones, laptops, tablets, headphones, cameras, monitors, TVs, smartwatches, gaming consoles, tech accessories (chargers, cables, phone cases), speakers, desktops, etc.

Fashion includes: 
- CLOTHING: All wearables (jeans, pants, shirts, dresses, jackets, coats, swimwear, underwear, activewear, sportswear, skirts, shorts, sweaters, hoodies, etc.)
- FOOTWEAR: All shoes (sneakers, boots, sandals, heels, flats, slippers, loafers, oxfords, etc.)
- ACCESSORIES: Fashion accessories (bags, handbags, backpacks, belts, scarves, hats, sunglasses, jewelry, necklaces, rings, bracelets, watches, etc.)

Respond with ONLY ONE WORD: either "electronics" or "fashion". If unsure, respond "unknown".`,
        },
        {
          role: "user",
          content: `Category: ${category}`,
        },
      ],
      temperature: 0,
      max_tokens: 10,
    });

    const result = response.choices[0].message.content.trim().toLowerCase();
    const categoryType = ["electronics", "fashion"].includes(result)
      ? result
      : "unknown";

    categoryTypeCache.set(categoryKey, categoryType);
    console.log(`   ✅ LLM categorized ${categoryKey} → ${categoryType}`);

    return categoryType;
  } catch (error) {
    console.error(`   ❌ Error categorizing ${categoryKey}:`, error.message);
    return "unknown";
  }
}

// LLM-POWERED GENDER NORMALIZATION

// LLM-POWERED TYPE NORMALIZATION

function cleanSpecs(specs) {
  if (!specs || typeof specs !== "object") return {};

  const cleaned = {};
  Object.keys(specs).forEach((key) => {
    const value = specs[key];
    if (value !== null && value !== undefined && value !== "") {
      cleaned[key] = value;
    }
  });

  return cleaned;
}

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
            description: "For clothes/shoes (e.g., 'M', '42', 'L', 'XL').",
          },
          style: {
            type: "string",
            description:
              "For clothes (e.g., 'jeans', 'dress', 'skirt', 'shirt', 'jacket'). IMPORTANT: Use consistent format - 't-shirt' NOT 't shirt', 'boxer shorts' NOT 'boxers', 'sports bra' NOT 'sport bra'.",
          },
          gender: {
            type: "string",
            description: "For clothes (e.g., 'Men', 'Women', 'Unisex').",
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

const CORE_COLUMNS = [
  "category",
  "brand",
  "storeName",
  "store_name",
  "minPrice",
  "min_price",
  "maxPrice",
  "max_price",
  "modelNumber",
  "model_number",
];

const EXACT_MATCH_SPECS = ["variant", "storage", "gender"];

async function buildPushDownFilters(filters = {}, rawQuery = "") {
  console.log("\n🔍 [FILTER BUILDER] Building WHERE clause (Scalable Mode)");
  console.log("   📥 Input filters:", JSON.stringify(filters, null, 2));

  const conditions = [];

  conditions.push(`"stock" = 'IN_STOCK'`);
  console.log("   📦 Stock filter: ENABLED");

  for (const key of Object.keys(filters)) {
    const value = filters[key];

    if (!value || value === null || value === undefined) continue;

    if (key === "minPrice" || key === "min_price") {
      const priceValue = parseFloat(value);
      if (priceValue > 0) {
        const condition = `"price" >= ${priceValue}`;
        conditions.push(condition);
        console.log(`   💰 Min price: ${condition}`);
      }
    } else if (key === "maxPrice" || key === "max_price") {
      const priceValue = parseFloat(value);
      if (priceValue > 0 && priceValue < Infinity) {
        const condition = `"price" <= ${priceValue}`;
        conditions.push(condition);
        console.log(`   💰 Max price: ${condition}`);
      }
    } else if (key === "category") {
      const condition = `"category" = '${value.toUpperCase()}'`;
      conditions.push(condition);
      console.log(`   📂 Category: ${condition}`);
    } else if (key === "brand") {
      const brandLower = value.toLowerCase().replace(/'/g, "''");
      const condition = `LOWER("brand") ILIKE '%${brandLower}%'`;
      conditions.push(condition);
      console.log(`   🏷️  Brand: ${condition}`);
    } else if (key === "storeName" || key === "store_name") {
      const condition = `"storeName" = '${value.toUpperCase()}'`;
      conditions.push(condition);
      console.log(`   🏪 Store: ${condition}`);
    } else if (key === "modelNumber" || key === "model_number") {
      const modelNum = value.replace(/'/g, "''");
      const condition = `LOWER("title") LIKE '%${modelNum}%'`;
      conditions.push(condition);
      console.log(`   🔢 Model: ${condition}`);
    } else if (key !== "query") {
      // All other keys are specs
      let specValue = value.toString().toLowerCase().replace(/'/g, "''");

      if (key === "gender") {
        // Gender is already normalized by the LLM in the system prompt
        const condition = `LOWER("specs"->>'gender') = '${specValue}'`;
        conditions.push(condition);
        console.log(`   👤 EXACT gender: ${condition}`);
      } else if (key === "type" || key === "style") {
        // Type/style is already normalized by the LLM in the system prompt
        const condition = `LOWER("specs"->>'type') ILIKE '%${specValue}%'`;
        conditions.push(condition);
        console.log(`   👕 FLEXIBLE type [${key}]: ${condition}`);
      } else if (EXACT_MATCH_SPECS.includes(key)) {
        const condition = `LOWER("specs"->>'${key}') = '${specValue}'`;
        conditions.push(condition);
        console.log(`   🎯 EXACT spec [${key}]: ${condition}`);
      } else {
        const condition = `LOWER("specs"->>'${key}') ILIKE '%${specValue}%'`;
        conditions.push(condition);
        console.log(`   🔄 FLEXIBLE spec [${key}]: ${condition}`);
      }
    }
  }

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

  const whereClause = await buildPushDownFilters(filters, rawQuery);

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

// ============================================================================
// ELECTRONICS FULLTEXT SEARCH
// ============================================================================
async function fulltextSearchElectronics(
  searchQuery,
  filters = {},
  limit = 100
) {
  console.log(
    "\n📝 [FULLTEXT - ELECTRONICS] Starting electronics fulltext search"
  );
  console.log("   🔍 Search term:", searchQuery);

  const whereClause = await buildPushDownFilters(filters, searchQuery);
  const searchTerm = searchQuery.toLowerCase().trim().replace(/'/g, "''");

  if (!searchTerm) {
    console.log("   ⚠️  Empty search term");
    return [];
  }

  try {
    // TIER 1: Strict trigram matching (0.5 threshold for electronics)
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
    console.log("   📊 Tier 1 (trigram) results:", results.length);

    if (results.length === 0) {
      // TIER 2: Word-based LIKE search (AND - all words must match)
      console.log("   🔄 Trying Tier 2 (word-based LIKE)...");

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
        console.log("   📊 Tier 2 results:", results.length);
      }
    }

    return results;
  } catch (error) {
    console.error("   ❌ [Fulltext Electronics] Error:", error.message);
    return [];
  }
}

// ============================================================================
// FASHION FULLTEXT SEARCH
// ============================================================================
async function fulltextSearchFashion(searchQuery, filters = {}, limit = 100) {
  console.log("\n📝 [FULLTEXT - FASHION] Starting fashion fulltext search");
  console.log("   🔍 Search term:", searchQuery);

  const whereClause = await buildPushDownFilters(filters, searchQuery);
  const searchTerm = searchQuery.toLowerCase().trim().replace(/'/g, "''");

  if (!searchTerm) {
    console.log("   ⚠️  Empty search term");
    return [];
  }

  try {
    // TIER 1: Looser trigram matching (0.2 threshold for fashion)
    await prisma.$executeRawUnsafe(`SET pg_trgm.similarity_threshold = 0.2;`);

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
    console.log("   📊 Tier 1 (trigram) results:", results.length);

    if (results.length === 0) {
      // TIER 2: Word-based LIKE search (OR - any word matches)
      console.log("   🔄 Fashion Tier 2: Word-based search...");

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
          .join(" OR "); // OR for fashion - any word matches

        const fallbackQuery = `
            SELECT 
              "title", "price", "storeName", "productUrl", "category", 
              "imageUrl", "stock", "description", "brand", "specs",
              0.4 as rank
            FROM "Product"
            WHERE (${likeConditions})
              AND ${whereClause}
            LIMIT ${limit};
          `;

        results = await prisma.$queryRawUnsafe(fallbackQuery);
        console.log("   📊 Tier 2 (word-based) results:", results.length);
      }
    }

    if (results.length === 0) {
      // TIER 3: Description search (fashion titles are often vague)
      console.log("   🔄 Fashion Tier 3: Description search...");

      const descQuery = `
          SELECT 
            "title", "price", "storeName", "productUrl", "category", 
            "imageUrl", "stock", "description", "brand", "specs",
            0.3 as rank
          FROM "Product"
          WHERE LOWER("description") LIKE '%${searchTerm}%'
            AND ${whereClause}
          LIMIT ${limit};
        `;

      results = await prisma.$queryRawUnsafe(descQuery);
      console.log("   📊 Tier 3 (description) results:", results.length);
    }

    return results;
  } catch (error) {
    console.error("   ❌ [Fulltext Fashion] Error:", error.message);
    return [];
  }
}

// ============================================================================
// ELECTRONICS RRF FUSION
// ============================================================================
// ============================================================================
// ELECTRONICS RRF FUSION (Dynamic Weighting)
// ============================================================================
function reciprocalRankFusionElectronics(
  vectorResults,
  fulltextResults,
  k = 60
) {
  console.log(
    "\n🔀 [RRF - ELECTRONICS] Electronics-optimized fusion (Dynamic Weighting)"
  );
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

  // ═══════════════════════════════════════════════════════════════
  // AUTOMATIC DYNAMIC WEIGHTING
  // ═══════════════════════════════════════════════════════════════
  const fulltextRatio =
    fulltextResults.length / Math.max(vectorResults.length, 1);

  let fulltextWeight, vectorWeight, modeName;

  if (fulltextResults.length === 0) {
    fulltextWeight = 0;
    vectorWeight = 0.7;
    modeName = "Vector-only (no fulltext matches)";
  } else if (fulltextRatio < 0.05) {
    // <5% fulltext - likely synonym issue (headphones vs headset)
    fulltextWeight = 0.4;
    vectorWeight = 0.6;
    modeName = `Vector-preferred (${(fulltextRatio * 100).toFixed(1)}%)`;
  } else if (fulltextRatio < 0.2) {
    // 5-20% fulltext - balanced
    fulltextWeight = 0.6;
    vectorWeight = 0.4;
    modeName = `Balanced (${(fulltextRatio * 100).toFixed(1)}%)`;
  } else {
    // >20% fulltext - trust fulltext
    fulltextWeight = 0.95;
    vectorWeight = 0.05;
    modeName = `Fulltext-preferred (${(fulltextRatio * 100).toFixed(1)}%)`;
  }

  console.log(`   🎯 Mode: ${modeName}`);
  console.log(
    `   ⚖️  Weights: Fulltext ${(fulltextWeight * 100).toFixed(0)}% / Vector ${(
      vectorWeight * 100
    ).toFixed(0)}%`
  );

  // Score and combine ALL results (both fulltext and vector-only)
  const scoredFulltext = fulltextMatches.map((item) => ({
    finalScore:
      item.fulltextScore * fulltextWeight + item.vectorScore * vectorWeight,
    ...item,
  }));

  const scoredVectorOnly = vectorOnlyMatches.map((item) => ({
    finalScore: item.vectorScore * vectorWeight,
    ...item,
  }));

  const finalResults = [...scoredFulltext, ...scoredVectorOnly];
  finalResults.sort((a, b) => b.finalScore - a.finalScore);

  const fused = finalResults.map((item) => ({
    ...item.product,
    rrfScore: item.finalScore,
  }));

  console.log("   📊 Total fused results:", fused.length);

  return fused;
}
// ============================================================================
// FASHION RRF FUSION
// ============================================================================
function reciprocalRankFusionFashion(vectorResults, fulltextResults, k = 60) {
  console.log("\n🔀 [RRF - FASHION] Fashion-optimized fusion");
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
    // Fashion: Vector gets MORE weight (60/40)
    finalResults = fulltextMatches.map((item) => ({
      finalScore: item.fulltextScore * 0.6 + item.vectorScore * 0.4,
      ...item,
    }));
    console.log("   ✅ Fashion: Balanced scoring (60/40)");
  } else {
    // Vector-only: MUCH stronger for fashion (70%)
    finalResults = vectorOnlyMatches.map((item) => ({
      finalScore: item.vectorScore * 0.7,
      ...item,
    }));
    console.log("   ✅ Fashion: Vector-dominant (70%)");
  }

  finalResults.sort((a, b) => b.finalScore - a.finalScore);

  const fused = finalResults.map((item) => ({
    ...item.product,
    rrfScore: item.finalScore,
  }));

  console.log("   📊 Total fused results:", fused.length);

  return fused;
}

// ============================================================================
// ELECTRONICS HYBRID SEARCH
// ============================================================================
async function electronicsHybridSearch(
  searchQuery,
  vectorLiteral,
  filters = {},
  limit = 50
) {
  console.log("\n⚡ [ELECTRONICS SEARCH] Using electronics-optimized pipeline");
  console.log("   🔍 Query:", searchQuery);
  console.log("   🎛️  Filters:", JSON.stringify(filters, null, 2));

  // STAGE 1: Strict search with ALL filters
  let [vectorResults, fulltextResults] = await Promise.all([
    vectorSearch(vectorLiteral, filters, limit * 2, searchQuery),
    fulltextSearchElectronics(searchQuery, filters, limit * 2),
  ]);

  if (vectorResults.length > 0 || fulltextResults.length > 0) {
    const fusedResults = reciprocalRankFusionElectronics(
      vectorResults,
      fulltextResults
    );
    const finalResults = fusedResults.slice(0, limit);
    console.log(
      "   ✅ Electronics Stage 1 (strict):",
      finalResults.length,
      "results"
    );
    return finalResults;
  }

  // STAGE 2: Relaxed search (drop variant, storage, color, RAM)
  console.log("   ⚠️  Stage 1 failed. Trying Stage 2 (relaxed)...");

  const relaxedFilters = {
    category: filters.category,
    brand: filters.brand,
    modelNumber: filters.modelNumber || filters.model_number,
    minPrice: filters.minPrice || filters.min_price,
    maxPrice: filters.maxPrice || filters.max_price,
    storeName: filters.storeName || filters.store_name,
  };

  [vectorResults, fulltextResults] = await Promise.all([
    vectorSearch(vectorLiteral, relaxedFilters, limit * 2, searchQuery),
    fulltextSearchElectronics(searchQuery, relaxedFilters, limit * 2),
  ]);

  const fusedResults = reciprocalRankFusionElectronics(
    vectorResults,
    fulltextResults
  );
  const finalResults = fusedResults.slice(0, limit);
  console.log(
    "   ✅ Electronics Stage 2 (relaxed):",
    finalResults.length,
    "results"
  );

  return finalResults;
}

// ============================================================================
// FASHION HYBRID SEARCH
// ============================================================================
async function fashionHybridSearch(
  searchQuery,
  vectorLiteral,
  filters = {},
  limit = 50
) {
  console.log("\n👗 [FASHION SEARCH] Using fashion-optimized pipeline");
  console.log("   🔍 Query:", searchQuery);
  console.log("   🎛️  Filters:", JSON.stringify(filters, null, 2));

  // STAGE 1: Try with ALL filters (gender, style, color)
  let [vectorResults, fulltextResults] = await Promise.all([
    vectorSearch(vectorLiteral, filters, limit * 3, searchQuery), // Fetch MORE for fashion
    fulltextSearchFashion(searchQuery, filters, limit * 3),
  ]);

  if (vectorResults.length >= 10 || fulltextResults.length >= 10) {
    const fusedResults = reciprocalRankFusionFashion(
      vectorResults,
      fulltextResults
    );
    const finalResults = fusedResults.slice(0, limit);
    console.log(
      "   ✅ Fashion Stage 1 (strict):",
      finalResults.length,
      "results"
    );
    return finalResults;
  }

  // STAGE 2: Drop color only (keep gender, style, category)
  console.log("   🔄 Fashion Stage 2 (drop color)...");

  const stage2Filters = {
    category: filters.category,
    brand: filters.brand,
    gender: filters.gender,
    style: filters.style,
    size: filters.size,
    minPrice: filters.minPrice || filters.min_price,
    maxPrice: filters.maxPrice || filters.max_price,
    storeName: filters.storeName || filters.store_name,
  };

  [vectorResults, fulltextResults] = await Promise.all([
    vectorSearch(vectorLiteral, stage2Filters, limit * 3, searchQuery),
    fulltextSearchFashion(searchQuery, stage2Filters, limit * 3),
  ]);

  if (vectorResults.length >= 5 || fulltextResults.length >= 5) {
    const fusedResults = reciprocalRankFusionFashion(
      vectorResults,
      fulltextResults
    );
    const finalResults = fusedResults.slice(0, limit);
    console.log(
      "   ✅ Fashion Stage 2 (no color):",
      finalResults.length,
      "results"
    );
    return finalResults;
  }

  // STAGE 3: Drop style too (keep gender and category only) - "Vibe Check" mode
  console.log("   🔄 Fashion Stage 3 (vibe check - gender + category only)...");

  const stage3Filters = {
    category: filters.category,
    gender: filters.gender, // CRITICAL: Keep gender even in vibe mode
    minPrice: filters.minPrice || filters.min_price,
    maxPrice: filters.maxPrice || filters.max_price,
  };

  [vectorResults, fulltextResults] = await Promise.all([
    vectorSearch(vectorLiteral, stage3Filters, limit * 4, searchQuery), // Fetch even MORE
    fulltextSearchFashion(searchQuery, stage3Filters, limit * 4),
  ]);

  const fusedResults = reciprocalRankFusionFashion(
    vectorResults,
    fulltextResults
  );
  const finalResults = fusedResults.slice(0, limit);
  console.log(
    "   ✅ Fashion Stage 3 (vibe check):",
    finalResults.length,
    "results"
  );

  return finalResults;
}

// ============================================================================
// MAIN HYBRID SEARCH ROUTER
// ============================================================================
async function hybridSearch(
  searchQuery,
  vectorLiteral,
  filters = {},
  limit = 50
) {
  console.log("\n🚀 [HYBRID SEARCH] Starting hybrid search");
  console.log("   🔍 Query:", searchQuery);
  console.log("   🎛️  Filters:", JSON.stringify(filters, null, 2));

  // Detect category type
  const categoryType = await getCategoryType(filters.category);
  console.log("   📂 Category type:", categoryType);

  // Route to appropriate search pipeline
  if (categoryType === "fashion") {
    return await fashionHybridSearch(
      searchQuery,
      vectorLiteral,
      filters,
      limit
    );
  } else if (categoryType === "electronics") {
    return await electronicsHybridSearch(
      searchQuery,
      vectorLiteral,
      filters,
      limit
    );
  } else {
    // Default to electronics behavior for unknown categories
    console.log("   ⚠️  Unknown category, using electronics pipeline");
    return await electronicsHybridSearch(
      searchQuery,
      vectorLiteral,
      filters,
      limit
    );
  }
}

function deduplicateProducts(products) {
  console.log("\n🔍 [DEDUPLICATION] Starting product deduplication");
  console.log("   📊 Input products:", products.length);

  const seen = new Map();
  const unique = [];

  for (const product of products) {
    const title = product.title.toLowerCase().trim();
    const price = parseFloat(product.price);

    const dedupKey = `${title}_${price.toFixed(2)}`;

    if (!seen.has(dedupKey)) {
      seen.set(dedupKey, true);
      unique.push(product);
    } else {
      console.log(
        `   ⏭️  Skipped duplicate: ${product.title} - ${product.price} KWD`
      );
    }
  }

  console.log("   ✅ Unique products:", unique.length);
  console.log("   🗑️  Duplicates removed:", products.length - unique.length);

  return unique;
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
      categoryType: "unknown",
    };
  }

  console.log("✅ Query validation passed:", query);

  if (args.storage) {
    args.storage = normalizeStorage(args.storage);
  }

  const filters = {};
  Object.keys(args).forEach((key) => {
    if (key !== "query" && args[key] !== null && args[key] !== undefined) {
      filters[key] = args[key];
    }
  });

  console.log("✨ Final filters:");
  console.log(JSON.stringify(filters, null, 2));

  const categoryType = await getCategoryType(filters.category);
  console.log("📂 Category type detected:", categoryType);

  try {
    const { vectorLiteral } = await getQueryEmbedding(query);
    const results = await hybridSearch(query, vectorLiteral, filters, 50);

    const deduplicatedResults = deduplicateProducts(results);
    const productsToReturn = deduplicatedResults.slice(0, 15);

    console.log("\n📦 [PRODUCTS TO FRONTEND]");
    console.log("   Total results:", results.length);
    console.log("   After deduplication:", deduplicatedResults.length);
    console.log("   Sending to frontend:", productsToReturn.length);
    console.log("   Category type:", categoryType);

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
      categoryType: categoryType,
      products: productsToReturn.map((p) => ({
        title: p.title,
        price: p.price,
        storeName: p.storeName,
        productUrl: p.productUrl,
        imageUrl: p.imageUrl,
        description: p.description,
        category: p.category,
        brand: p.brand,
        specs: cleanSpecs(p.specs),
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
      categoryType: "unknown",
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

// Image upload and analysis endpoint
app.post("/analyze-image", upload.single("image"), async (req, res) => {
  console.log("\n" + "🖼️ ".repeat(40));
  console.log("📸 NEW IMAGE ANALYSIS REQUEST");
  console.log("🖼️ ".repeat(40));

  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "No image file uploaded",
      });
    }

    console.log("📁 File received:");
    console.log("   Name:", req.file.originalname);
    console.log("   Size:", req.file.size, "bytes");
    console.log("   MIME:", req.file.mimetype);

    const analysisResult = await analyzeProductImage(
      req.file.buffer,
      req.file.mimetype
    );

    if (!analysisResult.success) {
      return res.status(500).json({
        success: false,
        error: analysisResult.error,
      });
    }

    console.log("\n✅ Image analysis completed successfully");
    console.log("   Generated query:", analysisResult.query);
    console.log("🖼️ ".repeat(40) + "\n");

    return res.json({
      success: true,
      query: analysisResult.query,
      tokensUsed: analysisResult.tokensUsed,
    });
  } catch (error) {
    console.error("❌ [Image Analysis] Error:", error);
    return res.status(500).json({
      success: false,
      error: "Image analysis failed: " + error.message,
    });
  }
});

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
        content: systemprompt,
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
    let categoryType = "unknown";

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
            categoryType = result.categoryType;
            console.log("✅ Products set:", products.length);
            console.log("✅ Category type:", categoryType);
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

      if (finalResponse) {
        finalResponse = finalResponse
          .replace(/\*\*/g, "")
          .replace(/\*/g, "")
          .replace(/###/g, "")
          .trim();
      }

      console.log("✅ Final response generated");
    }

    if (!responseMessage.tool_calls && finalResponse) {
      finalResponse = finalResponse
        .replace(/\*\*/g, "")
        .replace(/\*/g, "")
        .trim();
    }

    await saveToMemory(sessionId, "user", message);
    await saveToMemory(sessionId, "assistant", finalResponse);

    console.log("\n📤 SENDING RESPONSE");
    console.log("   Products:", products.length);
    console.log("   Category type:", categoryType);
    console.log("█".repeat(80) + "\n");

    return res.json({
      reply: finalResponse,
      products: products,
      categoryType: categoryType,
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
    message: "Omnia AI - Dual Pipeline Architecture (Electronics + Fashion)",
  });
});

app.listen(PORT, () => {
  console.log("\n🚀 Omnia AI Server - Dual Pipeline Architecture");
  console.log("   ⚡ Electronics: Precision matching (95/5 fulltext/vector)");
  console.log("   👗 Fashion: Vibe-based search (60/40 or 70% vector-only)");
  console.log(`   🌐 Server running on port ${PORT}`);
});
