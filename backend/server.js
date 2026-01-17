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
import { getDynamicSystemPrompt } from "./dynamicPrompt.js";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * CRITICAL FIXES APPLIED (Based on Test 11 Feedback + Fashion Enhancement)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * FIX #1: MODAL_CLIP_URL Validation
 * - Added explicit check for undefined MODAL_CLIP_URL before fetch
 * - Prevents "Failed to parse URL from undefined" error
 * - Location: getClipImageEmbedding() function
 *
 * FIX #2: Material Filter Support
 * - Added 'material' parameter to tool schema and filter builder
 * - Enables filtering by fabric types: sateen, flannel, leather, denim, etc.
 * - Uses ILIKE for partial matches (e.g., "sateen blend")
 * - Location: buildPushDownFilters() function
 *
 * FIX #3: Detail Filter Support with Stemming
 * - Added 'detail' parameter to tool schema and filter builder
 * - Enables filtering by design details: studded, ribbed, cropped, etc.
 * - Implements simple stemming ("studded" -> "stud" to match "studs")
 * - Searches in both title and specs fields
 * - Location: buildPushDownFilters() function
 *
 * FIX #4: Improved Fashion RRF Ranking
 * - Changed from 60/40 (text/vector) to 50/50 balance
 * - Prevents generic text matches from burying specific vector matches
 * - Example: "studded t-shirt" vector match no longer buried by "black t-shirt" text match
 * - Location: reciprocalRankFusionFashion() function
 *
 * FIX #5: Enhanced Fashion Prompt Logic
 * - Updated FASHION_LOGIC to explicitly extract material and detail
 * - Added examples for: sateen, flannel, studded, ribbed, lace, etc.
 * - Marked material/detail as MANDATORY filters when mentioned
 * - Location: dynamicprompt.js FASHION_LOGIC section
 *
 * FIX #6: Comprehensive Fashion Spec Support (NEW)
 * - Added sleeveLength parameter: short, long, sleeveless, 3/4, half
 * - Added pattern parameter: striped, floral, solid, plaid, polka dot, checkered
 * - Added neckline parameter: v-neck, crew, scoop, collar, round
 * - Added length parameter: mini, midi, maxi, knee-length, ankle
 * - Added fit parameter: slim, regular, oversized, loose, tight, relaxed
 * - All fashion specs use ILIKE for flexible matching in filter builder
 * - Updated dynamicprompt.js with extraction rules and examples
 * - Location: TOOLS schema, buildPushDownFilters(), dynamicprompt.js
 *
 * ═══════════════════════════════════════════════════════════════════════
 */

// 🎨 DeepFashion Integration
const DEEPFASHION_API_URL = process.env.DEEPFASHION_API_URL;

const app = express();
const PORT = process.env.PORT || 4000;
const LLM_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const VISION_MODEL = "gpt-4o-mini";
const MODAL_CLIP_URL = process.env.MODAL_CLIP_URL;
const MODAL_CLIP_BATCH_URL = process.env.MODAL_CLIP_BATCH_URL;
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

async function getCategoryType(category, query = "") {
  if (!category) return "unknown";

  const categoryKey = category.toUpperCase();

  // 🔥 FIX: ACCESSORIES can be either - check query context FIRST
  if (categoryKey === "ACCESSORIES") {
    const lowerQuery = (query || "").toLowerCase();
    const techKeywords =
      /case|charger|cable|adapter|screen protector|stand|mount|holder|power bank|iphone|samsung|galaxy|macbook|ipad|airpods|laptop|phone|tablet|usb|lightning|magsafe/i;

    if (techKeywords.test(lowerQuery)) {
      console.log(`   🔌 ACCESSORIES detected as TECH (query: "${query}")`);
      return "electronics";
    } else {
      console.log(`   👜 ACCESSORIES detected as FASHION (query: "${query}")`);
      return "fashion";
    }
  }

  if (categoryTypeCache.has(categoryKey)) {
    console.log(
      `   💾 Cache hit for category: ${categoryKey} → ${categoryTypeCache.get(
        categoryKey,
      )}`,
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
          material: {
            type: "string",
            description:
              "Material/fabric type for fashion items (e.g., 'sateen', 'flannel', 'leather', 'denim', 'cotton', 'silk'). Extract ONLY if user explicitly mentions material.",
          },
          detail: {
            type: "string",
            description:
              "Distinctive design details for fashion items (e.g., 'studded', 'ribbed', 'cropped', 'ripped', 'embroidered', 'lace'). Extract ONLY if user explicitly mentions detail.",
          },
          sleeveLength: {
            type: "string",
            description:
              "Sleeve length for clothing (e.g., 'short', 'long', 'sleeveless', '3/4', 'half'). Extract ONLY if user explicitly mentions sleeve length.",
          },
          pattern: {
            type: "string",
            description:
              "Pattern for clothing (e.g., 'striped', 'floral', 'solid', 'plaid', 'polka dot', 'checkered'). Extract if user mentions pattern.",
          },
          neckline: {
            type: "string",
            description:
              "Neckline type for clothing (e.g., 'v-neck', 'crew', 'scoop', 'collar', 'round'). Extract if user mentions neckline.",
          },
          length: {
            type: "string",
            description:
              "Garment length for dresses/skirts (e.g., 'mini', 'midi', 'maxi', 'knee-length', 'ankle'). Extract if user mentions length.",
          },
          fit: {
            type: "string",
            description:
              "Fit style for clothing (e.g., 'slim', 'regular', 'oversized', 'loose', 'tight', 'relaxed'). Extract if user mentions fit.",
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
          sort: {
            type: "string",
            description:
              "Order of results. Use 'price_asc' for 'cheapest/budget/affordable', 'price_desc' for 'best/premium/expensive/high-end', 'newest' for 'latest/new/recent'. Default is 'relevance' (hybrid search ranking).",
            enum: ["price_asc", "price_desc", "newest", "relevance"],
          },
          exclude: {
            type: "array",
            items: { type: "string" },
            description:
              "Keywords to EXCLUDE from results. Use this to filter out unwanted product types. Examples: ['t-shirt'] when searching for formal shirts, ['case', 'charger'] when searching for phones, ['bag', 'stand'] when searching for laptops. The AI should intelligently determine what to exclude based on user intent.",
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

async function getClipImageEmbedding(imageBase64) {
  console.log("\n🖼️ [CLIP] Encoding image with Modal CLIP service");

  // 🔥 FIX #1: Validate MODAL_CLIP_URL is configured
  if (!MODAL_CLIP_URL) {
    const error = new Error(
      "MODAL_CLIP_URL is not configured. Please add MODAL_CLIP_URL to your .env file.",
    );
    console.error("   ❌ Configuration error:", error.message);
    throw error;
  }

  try {
    const response = await fetch(MODAL_CLIP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "image",
        image: imageBase64,
      }),
    });

    if (!response.ok) {
      throw new Error(`Modal CLIP service error: ${response.status}`);
    }

    const data = await response.json();
    console.log("   ✅ CLIP embedding generated, dimensions:", data.dimensions);

    return data.embedding;
  } catch (error) {
    console.error("   ❌ CLIP encoding error:", error.message);
    throw error;
  }
}

/**
 * Visual search - find products by image similarity
 */
async function visualProductSearch(imageEmbedding, filters = {}, limit = 15) {
  console.log("\n🔍 [VISUAL SEARCH] Starting image-based product search");

  const vectorLiteral =
    "[" + imageEmbedding.map((x) => x.toFixed(6)).join(",") + "]";

  // Build WHERE clause
  let whereConditions = [
    `"stock" = 'IN_STOCK'`,
    `"imageEmbedding" IS NOT NULL`,
  ];

  if (filters.category) {
    whereConditions.push(`"category" = '${filters.category.toUpperCase()}'`);
    console.log("   📂 Category filter:", filters.category);
  }
  if (filters.brand) {
    whereConditions.push(
      `LOWER("brand") ILIKE '%${filters.brand.toLowerCase()}%'`,
    );
    console.log("   🏷️ Brand filter:", filters.brand);
  }
  if (filters.maxPrice) {
    whereConditions.push(`"price" <= ${parseFloat(filters.maxPrice)}`);
    console.log("   💰 Max price filter:", filters.maxPrice);
  }

  const whereClause = whereConditions.join(" AND ");

  const query = `
    SELECT
      "title", "price", "storeName", "productUrl", "category",
      "imageUrl", "stock", "description", "brand", "specs", "scrapedAt",
      1 - ("imageEmbedding" <=> '${vectorLiteral}'::vector) as similarity
    FROM "Product"
    WHERE ${whereClause}
    ORDER BY "imageEmbedding" <=> '${vectorLiteral}'::vector ASC
    LIMIT ${limit};
  `;

  try {
    const results = await prisma.$queryRawUnsafe(query);
    console.log("   ✅ Visual search completed");
    console.log("   📊 Results found:", results.length);

    if (results.length > 0) {
      console.log("   🔝 Top 3 visual matches:");
      results.slice(0, 3).forEach((r, i) => {
        console.log(`      ${i + 1}. ${r.title}`);
        console.log(
          `         Similarity: ${(parseFloat(r.similarity) * 100).toFixed(1)}%`,
        );
      });
    }

    return results;
  } catch (error) {
    console.error("   ❌ Visual search error:", error.message);
    return [];
  }
}

/**
 * Extract fashion attributes using DeepFashion model
 */
async function extractFashionAttributesFromImage(imageBase64) {
  console.log("\n🎨 [DEEPFASHION] Extracting fashion attributes");

  if (!DEEPFASHION_API_URL) {
    console.log(
      "   ⚠️  DeepFashion API URL not configured, skipping attribute extraction",
    );
    return { success: false, attributes: {} };
  }

  try {
    const response = await fetch(DEEPFASHION_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image: imageBase64,
        mimeType: "image/jpeg",
      }),
    });

    if (!response.ok) {
      throw new Error(`DeepFashion API error: ${response.status}`);
    }

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || "DeepFashion extraction failed");
    }

    const attributes = data.attributes;

    console.log("   ✅ Attributes extracted:");
    console.log(`      📂 Category: ${attributes.category}`);
    console.log(`      🎨 Color: ${attributes.color}`);
    console.log(`      👤 Gender: ${attributes.gender}`);
    if (attributes.sleeveLength)
      console.log(`      👕 Sleeve: ${attributes.sleeveLength}`);
    if (attributes.pattern)
      console.log(`      🔲 Pattern: ${attributes.pattern}`);
    if (attributes.neckline)
      console.log(`      👔 Neckline: ${attributes.neckline}`);
    if (attributes.length) console.log(`      📏 Length: ${attributes.length}`);

    return {
      success: true,
      attributes: attributes,
    };
  } catch (error) {
    console.error("   ❌ DeepFashion extraction error:", error.message);
    return {
      success: false,
      attributes: {},
      error: error.message,
    };
  }
}

/**
 * Build enhanced filters from DeepFashion attributes
 */
function buildFashionFiltersFromAttributes(attributes) {
  const filters = {};

  // Map category
  const categoryMap = {
    dress: "CLOTHING",
    top: "CLOTHING",
    shirt: "CLOTHING",
    blouse: "CLOTHING",
    "t-shirt": "CLOTHING",
    sweater: "CLOTHING",
    hoodie: "CLOTHING",
    jacket: "CLOTHING",
    coat: "CLOTHING",
    pants: "CLOTHING",
    jeans: "CLOTHING",
    shorts: "CLOTHING",
    skirt: "CLOTHING",
    shoes: "FOOTWEAR",
    sneakers: "FOOTWEAR",
    boots: "FOOTWEAR",
    sandals: "FOOTWEAR",
    heels: "FOOTWEAR",
    bag: "ACCESSORIES",
    backpack: "ACCESSORIES",
  };

  if (attributes.category) {
    filters.category =
      categoryMap[attributes.category.toLowerCase()] || "CLOTHING";
    filters.style = attributes.category.toLowerCase(); // Store original as style
  }

  // Gender (critical for fashion)
  if (attributes.gender) {
    const genderMap = {
      male: "men",
      men: "men",
      female: "women",
      women: "women",
      boys: "boys",
      girls: "girls",
      unisex: "unisex",
    };
    filters.gender =
      genderMap[attributes.gender.toLowerCase()] ||
      attributes.gender.toLowerCase();
  }

  // Color
  if (attributes.color) {
    filters.color = attributes.color.toLowerCase();
  }

  // Additional specs for more precise filtering
  if (attributes.sleeveLength) {
    filters.sleeveLength = attributes.sleeveLength.toLowerCase();
  }

  if (attributes.pattern) {
    filters.pattern = attributes.pattern.toLowerCase();
  }

  if (attributes.neckline) {
    filters.neckline = attributes.neckline.toLowerCase();
  }

  if (attributes.length) {
    filters.length = attributes.length.toLowerCase();
  }

  return filters;
}

/**
 * Generate natural language query from attributes
 */
function generateQueryFromAttributes(attributes) {
  const parts = [];

  if (attributes.gender) parts.push(attributes.gender);
  if (attributes.color) parts.push(attributes.color);
  if (attributes.category) parts.push(attributes.category);
  if (
    attributes.sleeveLength &&
    ["dress", "shirt", "top", "blouse", "t-shirt"].includes(attributes.category)
  ) {
    parts.push(`${attributes.sleeveLength} sleeve`);
  }
  if (attributes.pattern && attributes.pattern !== "solid") {
    parts.push(attributes.pattern);
  }
  if (attributes.length && ["dress", "skirt"].includes(attributes.category)) {
    parts.push(attributes.length);
  }

  return parts.join(" ");
}

/**
 * Enhanced visual search with attribute-based re-ranking
 */
async function enhancedVisualSearchWithAttributes(
  imageEmbedding,
  fashionAttributes,
  filters = {},
  limit = 15,
) {
  console.log(
    "\n🔍 [ENHANCED VISUAL SEARCH] Combining CLIP + DeepFashion attributes",
  );

  const vectorLiteral =
    "[" + imageEmbedding.map((x) => x.toFixed(6)).join(",") + "]";

  // Build WHERE clause with attribute filters
  let whereConditions = [
    `"stock" = 'IN_STOCK'`,
    `"imageEmbedding" IS NOT NULL`,
  ];

  // Apply category filter from attributes
  if (fashionAttributes.category) {
    const categoryMap = {
      dress: "CLOTHING",
      top: "CLOTHING",
      shirt: "CLOTHING",
      blouse: "CLOTHING",
      "t-shirt": "CLOTHING",
      sweater: "CLOTHING",
      hoodie: "CLOTHING",
      jacket: "CLOTHING",
      coat: "CLOTHING",
      pants: "CLOTHING",
      jeans: "CLOTHING",
      shorts: "CLOTHING",
      skirt: "CLOTHING",
      shoes: "FOOTWEAR",
      sneakers: "FOOTWEAR",
      boots: "FOOTWEAR",
      sandals: "FOOTWEAR",
      heels: "FOOTWEAR",
    };
    const dbCategory =
      categoryMap[fashionAttributes.category.toLowerCase()] || "CLOTHING";
    whereConditions.push(`"category" = '${dbCategory}'`);
    console.log(
      `   📂 Category filter: ${fashionAttributes.category} → ${dbCategory}`,
    );
  }

  // Apply gender filter (critical for fashion)
  if (fashionAttributes.gender) {
    const genderLower = fashionAttributes.gender.toLowerCase();
    whereConditions.push(`LOWER("specs"->>'gender') = '${genderLower}'`);
    console.log(`   👤 Gender filter: ${genderLower}`);
  }

  // Apply color filter
  if (fashionAttributes.color) {
    const colorLower = fashionAttributes.color.toLowerCase();
    whereConditions.push(`LOWER("specs"->>'color') ILIKE '%${colorLower}%'`);
    console.log(`   🎨 Color filter: ${colorLower}`);
  }

  // Apply additional attribute filters
  if (fashionAttributes.sleeveLength) {
    const sleeveLower = fashionAttributes.sleeveLength.toLowerCase();
    whereConditions.push(
      `LOWER("specs"->>'sleeveLength') ILIKE '%${sleeveLower}%'`,
    );
    console.log(`   👕 Sleeve filter: ${sleeveLower}`);
  }

  // Apply user-provided filters
  if (filters.brand) {
    whereConditions.push(
      `LOWER("brand") ILIKE '%${filters.brand.toLowerCase()}%'`,
    );
    console.log("   🏷️ Brand filter:", filters.brand);
  }
  if (filters.maxPrice) {
    whereConditions.push(`"price" <= ${parseFloat(filters.maxPrice)}`);
    console.log("   💰 Max price filter:", filters.maxPrice);
  }

  const whereClause = whereConditions.join(" AND ");

  // Get more results initially for re-ranking
  const query = `
    SELECT
      "title", "price", "storeName", "productUrl", "category",
      "imageUrl", "stock", "description", "brand", "specs", "scrapedAt",
      1 - ("imageEmbedding" <=> '${vectorLiteral}'::vector) as similarity
    FROM "Product"
    WHERE ${whereClause}
    ORDER BY "imageEmbedding" <=> '${vectorLiteral}'::vector ASC
    LIMIT ${limit * 3};
  `;

  try {
    const results = await prisma.$queryRawUnsafe(query);
    console.log("   ✅ Initial visual search completed");
    console.log("   📊 Results found:", results.length);

    // Re-rank results based on attribute matching
    if (results.length > 0 && fashionAttributes.category) {
      console.log("\n   🎯 Re-ranking by attribute match scores...");

      const reranked = results.map((product) => {
        // Calculate attribute match score
        let attributeScore = 0;
        let totalWeight = 0;

        // Gender match (weight: 3)
        if (fashionAttributes.gender && product.specs?.gender) {
          const genderMatch =
            product.specs.gender.toLowerCase() ===
            fashionAttributes.gender.toLowerCase();
          if (genderMatch) attributeScore += 3;
          totalWeight += 3;
        }

        // Color match (weight: 3)
        if (fashionAttributes.color && product.specs?.color) {
          const colorMatch = product.specs.color
            .toLowerCase()
            .includes(fashionAttributes.color.toLowerCase());
          if (colorMatch) attributeScore += 3;
          totalWeight += 3;
        }

        // Style match (weight: 2)
        if (fashionAttributes.category && product.specs?.type) {
          const styleMatch = product.specs.type
            .toLowerCase()
            .includes(fashionAttributes.category.toLowerCase());
          if (styleMatch) attributeScore += 2;
          totalWeight += 2;
        }

        // Sleeve match (weight: 1.5)
        if (fashionAttributes.sleeveLength && product.specs?.sleeveLength) {
          const sleeveMatch =
            product.specs.sleeveLength.toLowerCase() ===
            fashionAttributes.sleeveLength.toLowerCase();
          if (sleeveMatch) attributeScore += 1.5;
          totalWeight += 1.5;
        }

        // Pattern match (weight: 1)
        if (fashionAttributes.pattern && product.specs?.pattern) {
          const patternMatch =
            product.specs.pattern.toLowerCase() ===
            fashionAttributes.pattern.toLowerCase();
          if (patternMatch) attributeScore += 1;
          totalWeight += 1;
        }

        // Calculate normalized attribute score
        const normalizedAttrScore =
          totalWeight > 0 ? attributeScore / totalWeight : 0;

        // Combine visual similarity (70%) + attribute matching (30%)
        const visualSimilarity = parseFloat(product.similarity);
        const combinedScore =
          visualSimilarity * 0.7 + normalizedAttrScore * 0.3;

        return {
          ...product,
          attributeScore: normalizedAttrScore,
          combinedScore: combinedScore,
        };
      });

      // Sort by combined score
      reranked.sort((a, b) => b.combinedScore - a.combinedScore);

      console.log("   📊 Top 3 re-ranked results:");
      reranked.slice(0, 3).forEach((r, i) => {
        console.log(`      ${i + 1}. ${r.title}`);
        console.log(
          `         Visual: ${(r.similarity * 100).toFixed(
            1,
          )}% | Attributes: ${(r.attributeScore * 100).toFixed(
            1,
          )}% | Combined: ${(r.combinedScore * 100).toFixed(1)}%`,
        );
      });

      return reranked.slice(0, limit);
    }

    return results.slice(0, limit);
  } catch (error) {
    console.error("   ❌ Enhanced visual search error:", error.message);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════
// VISUAL SEARCH ENDPOINT
// ═══════════════════════════════════════════════════════════════════════

app.post("/visual-search", upload.single("image"), async (req, res) => {
  console.log("\n" + "🖼️ ".repeat(40));
  console.log("📸 NEW VISUAL SEARCH REQUEST (WITH DEEPFASHION)");
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

    // Convert to base64
    const imageBase64 = req.file.buffer.toString("base64");

    // Get optional filters from request body
    const { category, brand, maxPrice } = req.body;
    const filters = {};
    if (category) filters.category = category;
    if (brand) filters.brand = brand;
    if (maxPrice) filters.maxPrice = maxPrice;

    // Step 1: Extract fashion attributes using DeepFashion
    console.log(
      "\n🚀 Step 1: Extracting fashion attributes with DeepFashion...",
    );
    const attributeResult =
      await extractFashionAttributesFromImage(imageBase64);
    const fashionAttributes = attributeResult.success
      ? attributeResult.attributes
      : {};

    // Step 2: Get CLIP embedding from Modal
    console.log("\n🚀 Step 2: Getting CLIP embedding from Modal...");
    const imageEmbedding = await getClipImageEmbedding(imageBase64);

    // Step 3: Enhanced visual search with attribute-based re-ranking
    console.log("\n🚀 Step 3: Performing enhanced visual search...");
    let results;

    if (attributeResult.success && Object.keys(fashionAttributes).length > 0) {
      // Use enhanced search with attributes
      results = await enhancedVisualSearchWithAttributes(
        imageEmbedding,
        fashionAttributes,
        filters,
        20,
      );
    } else {
      // Fallback to standard visual search
      console.log(
        "   ⚠️  No attributes extracted, using standard visual search",
      );
      results = await visualProductSearch(imageEmbedding, filters, 20);
    }

    // Step 4: Deduplicate results
    const deduplicatedResults = deduplicateProducts(results);
    const productsToReturn = deduplicatedResults.slice(0, 15);

    // Determine category type for frontend
    const categoryType =
      productsToReturn.length > 0
        ? await getCategoryType(productsToReturn[0].category, "")
        : "unknown";

    // Generate enhanced query if attributes were extracted
    let enhancedQuery = null;
    if (attributeResult.success && Object.keys(fashionAttributes).length > 0) {
      enhancedQuery = generateQueryFromAttributes(fashionAttributes);
      console.log("\n   💬 Generated query from attributes:", enhancedQuery);
    }

    console.log("\n✅ Enhanced visual search completed successfully");
    console.log("   Products found:", productsToReturn.length);
    console.log("   Category type:", categoryType);
    console.log("   Attributes used:", Object.keys(fashionAttributes).length);
    console.log("🖼️ ".repeat(40) + "\n");

    return res.json({
      success: true,
      count: productsToReturn.length,
      categoryType: categoryType,
      extractedAttributes: fashionAttributes, // Send attributes to frontend
      enhancedQuery: enhancedQuery, // Send generated query
      products: productsToReturn.map((p) => ({
        title: p.title,
        price: p.price,
        storeName: beautifyStoreName(p.storeName),
        productUrl: p.productUrl,
        imageUrl: p.imageUrl,
        description: p.description,
        category: p.category,
        brand: p.brand,
        specs: cleanSpecs(p.specs),
        similarity: p.combinedScore
          ? (parseFloat(p.combinedScore) * 100).toFixed(1) + "%"
          : (parseFloat(p.similarity) * 100).toFixed(1) + "%",
        attributeMatch: p.attributeScore
          ? (parseFloat(p.attributeScore) * 100).toFixed(1) + "%"
          : null,
      })),
    });
  } catch (error) {
    console.error("❌ [Visual Search] Error:", error);
    return res.status(500).json({
      success: false,
      error: "Visual search failed: " + error.message,
    });
  }
});

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

// 🔥 FIX: Build model number filter with word-based matching
function buildModelNumberFilter(modelNumber) {
  if (!modelNumber) return null;

  const modelNum = modelNumber.toLowerCase().replace(/'/g, "''").trim();

  // Split into words and filter out very short/common words
  const words = modelNum
    .split(/\s+/)
    .filter(
      (word) =>
        word.length > 1 &&
        !["the", "and", "for", "with", "from", "a", "an"].includes(word),
    );

  if (words.length === 0) return null;

  if (words.length === 1) {
    // Single word: use simple LIKE
    return `LOWER("title") LIKE '%${words[0]}%'`;
  }

  // Multiple words: ALL words must be present (AND logic)
  const conditions = words.map((word) => `LOWER("title") LIKE '%${word}%'`);
  return `(${conditions.join(" AND ")})`;
}

async function buildPushDownFilters(filters = {}, rawQuery = "") {
  console.log(
    "\n🔍 [FILTER BUILDER] Building WHERE clause (LLM-Driven Exclusion Mode)",
  );
  console.log("   📥 Input filters:", JSON.stringify(filters, null, 2));

  const conditions = [];

  conditions.push(`"stock" = 'IN_STOCK'`);
  console.log("   📦 Stock filter: ENABLED");

  // 🔥 LLM-DRIVEN NEGATIVE FILTERING
  // Instead of hardcoding exclusions, the LLM decides what to exclude via the 'exclude' parameter
  if (
    filters.exclude &&
    Array.isArray(filters.exclude) &&
    filters.exclude.length > 0
  ) {
    console.log(
      "   🚫 [LLM-DRIVEN EXCLUSION] Processing exclude list:",
      filters.exclude,
    );

    const excludeConditions = filters.exclude.map((keyword) => {
      const sanitized = keyword.toLowerCase().trim().replace(/'/g, "''");
      return `LOWER("title") NOT ILIKE '%${sanitized}%'`;
    });

    const excludeClause = excludeConditions.join(" AND ");
    conditions.push(excludeClause);

    console.log(`   ✅ Excluding keywords: ${filters.exclude.join(", ")}`);
    console.log(`   📜 Exclusion clause: ${excludeClause}`);
  }

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
      // 🔥 FIX: Use word-based matching for model numbers
      const modelFilter = buildModelNumberFilter(value);
      if (modelFilter) {
        conditions.push(modelFilter);
        console.log(`   🔢 Model (word-based): ${modelFilter}`);
      }
    } else if (key !== "query" && key !== "sort" && key !== "exclude") {
      // All other keys are specs (ignore 'query', 'sort', and 'exclude' here)
      let specValue = value.toString().toLowerCase().replace(/'/g, "''");

      if (key === "gender") {
        const condition = `LOWER("specs"->>'gender') = '${specValue}'`;
        conditions.push(condition);
        console.log(`   👤 EXACT gender: ${condition}`);
      } else if (key === "type" || key === "style") {
        const condition = `LOWER("specs"->>'type') ILIKE '%${specValue}%'`;
        conditions.push(condition);
        console.log(`   👕 FLEXIBLE type [${key}]: ${condition}`);
      } else if (key === "material") {
        // 🔥 FIX #2: Add material filter with ILIKE for partial matches
        const condition = `LOWER("specs"->>'material') ILIKE '%${specValue}%'`;
        conditions.push(condition);
        console.log(`   🧵 MATERIAL filter: ${condition}`);
      } else if (key === "detail") {
        // 🔥 FIX #3: Add detail filter with stemming support
        // Simple stemmer: "studded" -> "stud", "ribbed" -> "rib"
        const stemmed = specValue.replace(/ded$|ed$|ing$/, "");
        const condition = `(LOWER("title") ILIKE '%${stemmed}%' OR LOWER("specs"->>'detail') ILIKE '%${stemmed}%')`;
        conditions.push(condition);
        console.log(
          `   ✨ DETAIL filter (stemmed "${specValue}" -> "${stemmed}"): ${condition}`,
        );
      } else if (key === "sleeveLength") {
        // Fashion spec: sleeve length (critical for fashion queries)
        const condition = `LOWER("specs"->>'sleeveLength') ILIKE '%${specValue}%'`;
        conditions.push(condition);
        console.log(`   👕 SLEEVE LENGTH filter: ${condition}`);
      } else if (key === "pattern") {
        // Fashion spec: pattern
        const condition = `LOWER("specs"->>'pattern') ILIKE '%${specValue}%'`;
        conditions.push(condition);
        console.log(`   🔲 PATTERN filter: ${condition}`);
      } else if (key === "neckline") {
        // Fashion spec: neckline
        const condition = `LOWER("specs"->>'neckline') ILIKE '%${specValue}%'`;
        conditions.push(condition);
        console.log(`   👔 NECKLINE filter: ${condition}`);
      } else if (key === "length") {
        // Fashion spec: garment length
        const condition = `LOWER("specs"->>'length') ILIKE '%${specValue}%'`;
        conditions.push(condition);
        console.log(`   📏 LENGTH filter: ${condition}`);
      } else if (key === "fit") {
        // Fashion spec: fit style
        const condition = `LOWER("specs"->>'fit') ILIKE '%${specValue}%'`;
        conditions.push(condition);
        console.log(`   👖 FIT filter: ${condition}`);
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

function applySorting(results, sortType = "relevance") {
  console.log(`\n🔢 [SORTING] Applying sort: ${sortType}`);
  console.log(`   📊 Input results: ${results.length}`);

  if (!results || results.length === 0) return results;

  let sorted = [...results];

  switch (sortType) {
    case "price_asc":
      sorted.sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
      console.log(
        `   ✅ Sorted by price (ascending): ${sorted[0]?.price} KWD → ${
          sorted[sorted.length - 1]?.price
        } KWD`,
      );
      break;

    case "price_desc":
      sorted.sort((a, b) => parseFloat(b.price) - parseFloat(a.price));
      console.log(
        `   ✅ Sorted by price (descending): ${sorted[0]?.price} KWD → ${
          sorted[sorted.length - 1]?.price
        } KWD`,
      );
      break;

    case "newest":
      sorted.sort((a, b) => new Date(b.scrapedAt) - new Date(a.scrapedAt));
      console.log(`   ✅ Sorted by newest`);
      break;

    case "relevance":
    default:
      console.log(`   ✅ Keeping relevance order (RRF scores)`);
      break;
  }

  return sorted;
}

async function vectorSearch(
  vectorLiteral,
  filters = {},
  limit = 100,
  rawQuery = "",
) {
  console.log("\n🎯 [VECTOR SEARCH] Starting vector search");
  console.log("   🔢 Limit:", limit);

  const whereClause = await buildPushDownFilters(filters, rawQuery);

  const query = `
      SELECT
        "title", "price", "storeName", "productUrl", "category",
        "imageUrl", "stock", "description", "brand", "specs", "scrapedAt",
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
          `         Price: ${r.price} KWD | Store: ${r.storeName} | Category: ${r.category}`,
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

async function fulltextSearchElectronics(
  searchQuery,
  filters = {},
  limit = 100,
) {
  console.log(
    "\n📝 [FULLTEXT - ELECTRONICS] Starting electronics fulltext search",
  );
  console.log("   🔍 Search term:", searchQuery);

  const whereClause = await buildPushDownFilters(filters, searchQuery);
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
          "imageUrl", "stock", "description", "brand", "specs", "scrapedAt",
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
      console.log("   🔄 Trying Tier 2 (word-based LIKE)...");

      const words = searchTerm
        .split(/\s+/)
        .filter(
          (word) =>
            word.length > 2 &&
            !["the", "and", "for", "with", "from"].includes(word),
        );

      if (words.length > 0) {
        const likeConditions = words
          .map((word) => `LOWER("title") LIKE '%${word}%'`)
          .join(" AND ");

        const fallbackQuery = `
            SELECT 
              "title", "price", "storeName", "productUrl", "category", 
              "imageUrl", "stock", "description", "brand", "specs", "scrapedAt",
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
    await prisma.$executeRawUnsafe(`SET pg_trgm.similarity_threshold = 0.2;`);

    const query = `
        SELECT 
          "title", "price", "storeName", "productUrl", "category", 
          "imageUrl", "stock", "description", "brand", "specs", "scrapedAt",
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
      console.log("   🔄 Fashion Tier 2: Word-based search...");

      const words = searchTerm
        .split(/\s+/)
        .filter(
          (word) =>
            word.length > 2 &&
            !["the", "and", "for", "with", "from"].includes(word),
        );

      if (words.length > 0) {
        const likeConditions = words
          .map((word) => `LOWER("title") LIKE '%${word}%'`)
          .join(" OR ");

        const fallbackQuery = `
            SELECT 
              "title", "price", "storeName", "productUrl", "category", 
              "imageUrl", "stock", "description", "brand", "specs", "scrapedAt",
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
      console.log("   🔄 Fashion Tier 3: Description search...");

      const descQuery = `
          SELECT 
            "title", "price", "storeName", "productUrl", "category", 
            "imageUrl", "stock", "description", "brand", "specs", "scrapedAt",
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

function reciprocalRankFusionElectronics(
  vectorResults,
  fulltextResults,
  k = 60,
) {
  console.log(
    "\n🔀 [RRF - ELECTRONICS] Electronics-optimized fusion (Dynamic Weighting)",
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
    (item) => item.fulltextRank !== null,
  );

  const vectorOnlyMatches = Array.from(scores.values()).filter(
    (item) => item.fulltextRank === null,
  );

  console.log("   📊 Fulltext matches:", fulltextMatches.length);
  console.log("   📊 Vector-only matches:", vectorOnlyMatches.length);

  const fulltextRatio =
    fulltextResults.length / Math.max(vectorResults.length, 1);

  let fulltextWeight, vectorWeight, modeName;

  if (fulltextResults.length === 0) {
    fulltextWeight = 0;
    vectorWeight = 0.7;
    modeName = "Vector-only (no fulltext matches)";
  } else if (fulltextRatio < 0.05) {
    fulltextWeight = 0.4;
    vectorWeight = 0.6;
    modeName = `Vector-preferred (${(fulltextRatio * 100).toFixed(1)}%)`;
  } else if (fulltextRatio < 0.2) {
    fulltextWeight = 0.6;
    vectorWeight = 0.4;
    modeName = `Balanced (${(fulltextRatio * 100).toFixed(1)}%)`;
  } else {
    fulltextWeight = 0.95;
    vectorWeight = 0.05;
    modeName = `Fulltext-preferred (${(fulltextRatio * 100).toFixed(1)}%)`;
  }

  console.log(`   🎯 Mode: ${modeName}`);
  console.log(
    `   ⚖️  Weights: Fulltext ${(fulltextWeight * 100).toFixed(0)}% / Vector ${(
      vectorWeight * 100
    ).toFixed(0)}%`,
  );

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
    (item) => item.fulltextRank !== null,
  );

  const vectorOnlyMatches = Array.from(scores.values()).filter(
    (item) => item.fulltextRank === null,
  );

  console.log("   📊 Fulltext matches:", fulltextMatches.length);
  console.log("   📊 Vector-only matches:", vectorOnlyMatches.length);

  // 🔥 FIX #4: Improved fashion ranking logic
  // Problem: When fulltext finds partial matches (e.g., "black t-shirt" but not "studded"),
  // it was overpowering vector results that found the correct match.
  // Solution: Give vector search more weight to prevent burying specific matches

  let finalResults;

  if (fulltextMatches.length > 0 && vectorOnlyMatches.length > 0) {
    // Both fulltext and vector found results
    // Use 50/50 balance to give vector matches fair representation
    finalResults = [
      ...fulltextMatches.map((item) => ({
        finalScore: item.fulltextScore * 0.5 + item.vectorScore * 0.5,
        ...item,
      })),
      ...vectorOnlyMatches.map((item) => ({
        finalScore: item.vectorScore * 0.5, // Give vector-only items a fair chance
        ...item,
      })),
    ];
    console.log("   ✅ Fashion: Balanced scoring (50/50 vector/text)");
  } else if (fulltextMatches.length > 0) {
    // Only fulltext found results
    finalResults = fulltextMatches.map((item) => ({
      finalScore: item.fulltextScore * 0.6 + item.vectorScore * 0.4,
      ...item,
    }));
    console.log("   ✅ Fashion: Text-preferred (60/40)");
  } else {
    // Only vector found results
    finalResults = vectorOnlyMatches.map((item) => ({
      finalScore: item.vectorScore * 0.7,
      ...item,
    }));
    console.log("   ✅ Fashion: Vector-only (70%)");
  }

  finalResults.sort((a, b) => b.finalScore - a.finalScore);

  const fused = finalResults.map((item) => ({
    ...item.product,
    rrfScore: item.finalScore,
  }));

  console.log("   📊 Total fused results:", fused.length);

  return fused;
}

async function electronicsHybridSearch(
  searchQuery,
  vectorLiteral,
  filters = {},
  limit = 50,
) {
  console.log("\n⚡ [ELECTRONICS SEARCH] Using electronics-optimized pipeline");
  console.log("   🔍 Query:", searchQuery);
  console.log("   🎛️  Filters:", JSON.stringify(filters, null, 2));

  // Stage 1: All filters (strict)
  let [vectorResults, fulltextResults] = await Promise.all([
    vectorSearch(vectorLiteral, filters, limit * 2, searchQuery),
    fulltextSearchElectronics(searchQuery, filters, limit * 2),
  ]);

  if (vectorResults.length > 0 || fulltextResults.length > 0) {
    const fusedResults = reciprocalRankFusionElectronics(
      vectorResults,
      fulltextResults,
    );
    const finalResults = fusedResults.slice(0, limit);
    console.log(
      "   ✅ Electronics Stage 1 (strict):",
      finalResults.length,
      "results",
    );
    return finalResults;
  }

  console.log("   ⚠️  Stage 1 failed. Trying Stage 2 (drop variant/color)...");

  // Stage 2: Drop variant and color only
  const stage2Filters = {};
  for (const key of Object.keys(filters)) {
    if (key !== "variant" && key !== "color") {
      stage2Filters[key] = filters[key];
    }
  }

  [vectorResults, fulltextResults] = await Promise.all([
    vectorSearch(vectorLiteral, stage2Filters, limit * 2, searchQuery),
    fulltextSearchElectronics(searchQuery, stage2Filters, limit * 2),
  ]);

  if (vectorResults.length > 0 || fulltextResults.length > 0) {
    const fusedResults = reciprocalRankFusionElectronics(
      vectorResults,
      fulltextResults,
    );
    const finalResults = fusedResults.slice(0, limit);
    console.log(
      "   ✅ Electronics Stage 2 (no variant/color):",
      finalResults.length,
      "results",
    );
    return finalResults;
  }

  console.log(
    "   ⚠️  Stage 2 failed. Trying Stage 3 (drop one spec at a time)...",
  );

  // Stage 3: Try dropping specs one at a time to find partial matches
  const specKeys = Object.keys(stage2Filters).filter(
    (key) =>
      ![
        "category",
        "brand",
        "modelNumber",
        "model_number",
        "minPrice",
        "min_price",
        "maxPrice",
        "max_price",
        "storeName",
        "store_name",
      ].includes(key),
  );

  for (const specToDrop of specKeys) {
    const stage3Filters = {};
    for (const key of Object.keys(stage2Filters)) {
      if (key !== specToDrop) {
        stage3Filters[key] = stage2Filters[key];
      }
    }

    console.log(`   🔄 Trying without '${specToDrop}'...`);

    [vectorResults, fulltextResults] = await Promise.all([
      vectorSearch(vectorLiteral, stage3Filters, limit * 2, searchQuery),
      fulltextSearchElectronics(searchQuery, stage3Filters, limit * 2),
    ]);

    if (vectorResults.length > 0 || fulltextResults.length > 0) {
      const fusedResults = reciprocalRankFusionElectronics(
        vectorResults,
        fulltextResults,
      );
      const finalResults = fusedResults.slice(0, limit);
      console.log(
        `   ✅ Electronics Stage 3 (dropped ${specToDrop}):`,
        finalResults.length,
        "results",
      );
      return finalResults;
    }
  }

  console.log(
    "   ⚠️  Stage 3 failed. Trying Stage 4 (category + brand only)...",
  );

  // Stage 4: Last resort - category and brand only
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
    fulltextResults,
  );
  const finalResults = fusedResults.slice(0, limit);
  console.log(
    "   ✅ Electronics Stage 4 (relaxed):",
    finalResults.length,
    "results",
  );

  return finalResults;
}

async function fashionHybridSearch(
  searchQuery,
  vectorLiteral,
  filters = {},
  limit = 50,
) {
  console.log("\n👗 [FASHION SEARCH] Using fashion-optimized pipeline");
  console.log("   🔍 Query:", searchQuery);
  console.log("   🎛️  Filters:", JSON.stringify(filters, null, 2));

  let [vectorResults, fulltextResults] = await Promise.all([
    vectorSearch(vectorLiteral, filters, limit * 3, searchQuery),
    fulltextSearchFashion(searchQuery, filters, limit * 3),
  ]);

  if (vectorResults.length >= 10 || fulltextResults.length >= 10) {
    const fusedResults = reciprocalRankFusionFashion(
      vectorResults,
      fulltextResults,
    );
    const finalResults = fusedResults.slice(0, limit);
    console.log(
      "   ✅ Fashion Stage 1 (strict):",
      finalResults.length,
      "results",
    );
    return finalResults;
  }

  console.log("   🔄 Fashion Stage 2 (drop only color + pattern)...");

  // Stage 2: Drop only color and pattern (least critical specs)
  // PRESERVE: sleeveLength, material, detail, neckline, length, fit (more critical)
  const stage2Filters = {
    category: filters.category,
    brand: filters.brand,
    gender: filters.gender,
    style: filters.style,
    size: filters.size,
    sleeveLength: filters.sleeveLength, // PRESERVE
    material: filters.material, // PRESERVE
    detail: filters.detail, // PRESERVE
    neckline: filters.neckline, // PRESERVE
    length: filters.length, // PRESERVE
    fit: filters.fit, // PRESERVE
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
      fulltextResults,
    );
    const finalResults = fusedResults.slice(0, limit);
    console.log(
      "   ✅ Fashion Stage 2 (no color/pattern):",
      finalResults.length,
      "results",
    );
    return finalResults;
  }

  console.log("   🔄 Fashion Stage 3 (drop detail + neckline + fit)...");

  // Stage 3: Drop detail, neckline, and fit (moderate importance)
  // PRESERVE: sleeveLength, material, length (most critical for fit)
  const stage3Filters = {
    category: filters.category,
    brand: filters.brand,
    gender: filters.gender,
    style: filters.style,
    size: filters.size,
    sleeveLength: filters.sleeveLength, // STILL PRESERVED
    material: filters.material, // STILL PRESERVED
    length: filters.length, // STILL PRESERVED
    minPrice: filters.minPrice || filters.min_price,
    maxPrice: filters.maxPrice || filters.max_price,
    storeName: filters.storeName || filters.store_name,
  };

  [vectorResults, fulltextResults] = await Promise.all([
    vectorSearch(vectorLiteral, stage3Filters, limit * 4, searchQuery),
    fulltextSearchFashion(searchQuery, stage3Filters, limit * 4),
  ]);

  if (vectorResults.length >= 5 || fulltextResults.length >= 5) {
    const fusedResults = reciprocalRankFusionFashion(
      vectorResults,
      fulltextResults,
    );
    const finalResults = fusedResults.slice(0, limit);
    console.log(
      "   ✅ Fashion Stage 3 (no detail/neckline/fit):",
      finalResults.length,
      "results",
    );
    return finalResults;
  }

  console.log(
    "   🔄 Fashion Stage 4 (drop material + length, keep sleeveLength)...",
  );

  // Stage 4: Drop material and length
  // PRESERVE: sleeveLength (CRITICAL - user explicitly requested)
  const stage4Filters = {
    category: filters.category,
    brand: filters.brand,
    gender: filters.gender,
    style: filters.style,
    size: filters.size,
    sleeveLength: filters.sleeveLength, // STILL PRESERVED
    minPrice: filters.minPrice || filters.min_price,
    maxPrice: filters.maxPrice || filters.max_price,
    storeName: filters.storeName || filters.store_name,
  };

  [vectorResults, fulltextResults] = await Promise.all([
    vectorSearch(vectorLiteral, stage4Filters, limit * 4, searchQuery),
    fulltextSearchFashion(searchQuery, stage4Filters, limit * 4),
  ]);

  if (vectorResults.length >= 5 || fulltextResults.length >= 5) {
    const fusedResults = reciprocalRankFusionFashion(
      vectorResults,
      fulltextResults,
    );
    const finalResults = fusedResults.slice(0, limit);
    console.log(
      "   ✅ Fashion Stage 4 (keep sleeveLength):",
      finalResults.length,
      "results",
    );
    return finalResults;
  }

  console.log(
    "   🔄 Fashion Stage 5 (final fallback - gender + category + style only)...",
  );

  const stage5Filters = {
    category: filters.category,
    gender: filters.gender,
    style: filters.style,
    minPrice: filters.minPrice || filters.min_price,
    maxPrice: filters.maxPrice || filters.max_price,
  };

  [vectorResults, fulltextResults] = await Promise.all([
    vectorSearch(vectorLiteral, stage5Filters, limit * 4, searchQuery),
    fulltextSearchFashion(searchQuery, stage5Filters, limit * 4),
  ]);

  const fusedResults = reciprocalRankFusionFashion(
    vectorResults,
    fulltextResults,
  );
  const finalResults = fusedResults.slice(0, limit);
  console.log(
    "   ✅ Fashion Stage 5 (final vibe check):",
    finalResults.length,
    "results",
  );

  return finalResults;
}

async function hybridSearch(
  searchQuery,
  vectorLiteral,
  filters = {},
  limit = 50,
) {
  console.log("\n🚀 [HYBRID SEARCH] Starting hybrid search");
  console.log("   🔍 Query:", searchQuery);
  console.log("   🎛️  Filters:", JSON.stringify(filters, null, 2));

  const categoryType = await getCategoryType(filters.category, searchQuery);
  console.log("   📂 Category type:", categoryType);

  if (categoryType === "fashion") {
    return await fashionHybridSearch(
      searchQuery,
      vectorLiteral,
      filters,
      limit,
    );
  } else if (categoryType === "electronics") {
    return await electronicsHybridSearch(
      searchQuery,
      vectorLiteral,
      filters,
      limit,
    );
  } else {
    console.log("   ⚠️  Unknown category, using electronics pipeline");
    return await electronicsHybridSearch(
      searchQuery,
      vectorLiteral,
      filters,
      limit,
    );
  }
}

// 🔥 FIX #7: IMPROVED DEDUPLICATION - Model variety, not color variants
function deduplicateProducts(products) {
  console.log("\n🔍 [DEDUPLICATION] Starting smart product deduplication");
  console.log("   📊 Input products:", products.length);

  const seen = new Map();
  const unique = [];

  for (const product of products) {
    // Extract first 20 characters of title (captures "iPhone 15 Pro Max" but ignores color)
    const titlePrefix = product.title.substring(0, 20).toLowerCase().trim();
    const price = parseFloat(product.price);

    // Dedupe key: title prefix + price (allows different prices for same model)
    const dedupKey = `${titlePrefix}_${price.toFixed(2)}`;

    if (!seen.has(dedupKey)) {
      seen.set(dedupKey, true);
      unique.push(product);
    } else {
      console.log(
        `   ⏭️  Skipped variant: ${product.title} - ${product.price} KWD`,
      );
    }
  }

  console.log("   ✅ Unique models:", unique.length);
  console.log("   🗑️  Variants removed:", products.length - unique.length);

  return unique;
}

// 🔥 FIX #7: BEAUTIFY STORE NAMES
function beautifyStoreName(storeName) {
  const storeMap = {
    BEST_KW: "Best Al yousifi",
    XCITE: "Xcite",
    EUREKA: "Eureka",
    NOON: "Noon",
  };

  return storeMap[storeName] || storeName;
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
        JSON.stringify(data),
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

  const { query, sort = "relevance" } = args;

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
  console.log("🔢 Sort preference:", sort);

  if (args.storage) {
    args.storage = normalizeStorage(args.storage);
  }

  const filters = {};
  Object.keys(args).forEach((key) => {
    if (
      key !== "query" &&
      key !== "sort" &&
      args[key] !== null &&
      args[key] !== undefined
    ) {
      filters[key] = args[key];
    }
  });

  console.log("✨ Final filters:");
  console.log(JSON.stringify(filters, null, 2));

  const categoryType = await getCategoryType(filters.category, query);
  console.log("📂 Category type detected:", categoryType);

  try {
    const { vectorLiteral } = await getQueryEmbedding(query);
    let results = await hybridSearch(query, vectorLiteral, filters, 50);

    // Apply sorting
    results = applySorting(results, sort);

    // Apply smart deduplication (model variety, not color variants)
    const deduplicatedResults = deduplicateProducts(results);
    const productsToReturn = deduplicatedResults.slice(0, 15);

    console.log("\n📦 [PRODUCTS TO FRONTEND]");
    console.log("   Total results:", results.length);
    console.log("   After deduplication:", deduplicatedResults.length);
    console.log("   Sending to frontend:", productsToReturn.length);
    console.log("   Category type:", categoryType);
    console.log("   Sort applied:", sort);

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
        storeName: beautifyStoreName(p.storeName), // 🔥 Beautified store name
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
      req.file.mimetype,
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

    // 🔥 FIX #5: USE DYNAMIC SYSTEM PROMPT WITH CURRENT DATE
    const dynamicPrompt = await getDynamicSystemPrompt(message);

    const messages = [
      {
        role: "system",
        content: dynamicPrompt,
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
      responseMessage.tool_calls ? responseMessage.tool_calls.length : 0,
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
            // 🔥 FIX: Merge products instead of overwriting
            products = [...products, ...result.products];
            // Only update categoryType if it's currently unknown or handle mixed types
            if (categoryType === "unknown") {
              categoryType = result.categoryType;
            } else if (categoryType !== result.categoryType) {
              // Handle mixed categories (e.g., iPhone + Headphones)
              categoryType = "mixed";
            }
            console.log("✅ Products merged:", products.length);
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
    message:
      "Omnia AI - Dual Pipeline + Intelligent Sorting + Smart Deduplication",
  });
});

app.listen(PORT, () => {
  console.log("\n🚀 Omnia AI Server - Production Ready");
  console.log("   ⚡ Electronics: Precision matching (dynamic RRF)");
  console.log("   👗 Fashion: Vibe-based search (60/40 or 70% vector)");
  console.log(
    "   🔢 Sorting: AI-controlled (cheapest, best, newest, relevance)",
  );
  console.log("   🎯 Category: Soft bias (prevents semantic drift)");
  console.log("   🗑️  Deduplication: Model variety (not color clutter)");
  console.log("   📅 Date: Dynamic injection (AI knows current date)");
  console.log("   🔧 Model filter: Word-based matching (not exact phrase)");
  console.log(`   🌐 Server running on port ${PORT}`);
});
