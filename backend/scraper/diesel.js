import fetch from "node-fetch";
import { parse } from "csv-parse/sync";
import { PrismaClient, StockStatus } from "@prisma/client";
import OpenAI from "openai";
import fs from "fs/promises";

// --- GLOBAL CONFIGURATION ---
const prisma = new PrismaClient();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const CSV_URL =
  "http://export.admitad.com/en/webmaster/websites/2896510/products/export_adv_products/?user=mishaal_alotaibi2ae7a&code=mx60od1chh&feed_id=21862&format=csv";
// NOTE: You need to add DIESEL to your StoreName enum in schema.prisma:
// enum StoreName {
//   XCITE
//   BEST_KW
//   NOON_KW
//   EUREKA
//   HM
//   DIESEL  // <-- Add this
// }
// Then run: npx prisma generate

const STORE_NAME_FIXED = "DIESEL"; // Will be StoreName.DIESEL after schema update
const CURRENCY = "KWD";

// --- OPTIMIZED CONCURRENCY & RATE LIMITING ---
const CONCURRENT_LIMIT = 2;
const LLM_MODEL = "gpt-4o-mini";
const BATCH_DELAY_MS = 3000;

// --- CHECKPOINT & CACHE FILES ---
const CHECKPOINT_FILE = "./diesel_import_checkpoint.json";
const CACHE_FILE = "./diesel_import_cache.json";
const CHECKPOINT_SAVE_INTERVAL = 3;

// --- RATE LIMITER TRACKING ---
const rateLimiter = {
  requestCount: 0,
  dailyRequestCount: 0,
  lastResetTime: Date.now(),
  consecutiveErrors: 0,
};

// -------------------------------------------------------------------
// --- CSV FIELD MAPPING ---
// -------------------------------------------------------------------

// Actual Admitad CSV fields mapping (verified from sample)
const FIELD_MAPPING = {
  // Core fields (saved directly to Product table)
  title: "name",
  description: "description",
  price: "price",
  oldPrice: "oldprice",
  imageUrl: "picture",
  productUrl: "url",
  category: "categoryId",
  brand: "vendor",
  sku: "id",
  availability: "available",
  currency: "currencyId",
};

// Additional fields to save in specs JSON (only essential ones)
const SPECS_FIELDS = [
  "param", // Contains size and gender info (size:36|gender:male)
  "season", // Product season (aw25)
  "material", // Material if present in CSV
];

// Map id and currencyId separately since they're essential
const ESSENTIAL_MAPPINGS = {
  sku: "id", // Product SKU
  currency: "currencyId", // Currency
};

console.log(`\n${"=".repeat(70)}`);
console.log(`🗺️  DIESEL CSV FIELD MAPPING:`);
console.log(`${"=".repeat(70)}`);
console.log(`CORE FIELDS (Direct to Database):`);
console.log(`${"=".repeat(70)}`);
Object.entries(FIELD_MAPPING).forEach(([dbField, csvField]) => {
  console.log(`${dbField.padEnd(20)} ← ${csvField}`);
});
console.log(`\n${"=".repeat(70)}`);
console.log(`SPECS FIELDS (Saved to specs JSON):`);
console.log(`${"=".repeat(70)}`);
console.log(`AI-EXTRACTED:`);
console.log(`  specs.type               ← Guessed from title/description`);
console.log(`  specs.size               ← Parsed from param field`);
console.log(`  specs.gender             ← Parsed from param field`);
console.log(`  specs.color              ← Extracted by AI`);
console.log(`  specs.fit                ← Extracted by AI`);
console.log(`  specs.wash               ← Extracted by AI (for denim)`);
console.log(`  specs.pattern            ← Extracted by AI (if present)`);
console.log(`\nESSENTIAL CSV FIELDS:`);
Object.entries(ESSENTIAL_MAPPINGS).forEach(([specField, csvField]) => {
  console.log(`  specs.${specField.padEnd(20)} ← ${csvField}`);
});
console.log(`\nADDITIONAL CSV FIELDS:`);
SPECS_FIELDS.forEach((field) => {
  console.log(`  specs.${field.padEnd(20)} ← ${field}`);
});
console.log(`${"=".repeat(70)}\n`);

// -------------------------------------------------------------------
// --- PERSISTENT CACHE SYSTEM ---
// -------------------------------------------------------------------

let persistentCache = {
  typeNormalization: {},
  titleNormalization: {},
  categoryDetection: {},
};

async function loadCache() {
  try {
    const data = await fs.readFile(CACHE_FILE, "utf-8");
    persistentCache = JSON.parse(data);
    console.log(`💾 Loaded cache:`);
    console.log(
      `   Type normalizations: ${
        Object.keys(persistentCache.typeNormalization || {}).length
      }`
    );
    console.log(
      `   Title normalizations: ${
        Object.keys(persistentCache.titleNormalization || {}).length
      }`
    );
    console.log(
      `   Category detections: ${
        Object.keys(persistentCache.categoryDetection || {}).length
      }`
    );
  } catch (error) {
    console.log(`💾 No cache found - starting with empty cache`);
    persistentCache = {
      typeNormalization: {},
      titleNormalization: {},
      categoryDetection: {},
    };
  }
}

async function saveCache() {
  try {
    await fs.writeFile(CACHE_FILE, JSON.stringify(persistentCache, null, 2));
    console.log(
      `   💾 Cache saved (${
        Object.keys(persistentCache.typeNormalization || {}).length
      } type + ${
        Object.keys(persistentCache.titleNormalization || {}).length
      } title + ${
        Object.keys(persistentCache.categoryDetection || {}).length
      } category)`
    );
  } catch (error) {
    console.error(`   ⚠️ Failed to save cache: ${error.message}`);
  }
}

// -------------------------------------------------------------------
// --- SMART RETRY WRAPPER WITH EXPONENTIAL BACKOFF ---
// -------------------------------------------------------------------

async function callOpenAIWithRetry(
  fn,
  maxRetries = 5,
  operationName = "API call"
) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      rateLimiter.requestCount++;
      rateLimiter.dailyRequestCount++;

      const result = await fn();
      rateLimiter.consecutiveErrors = 0;
      return result;
    } catch (error) {
      const isRateLimit =
        error.status === 429 ||
        error.message?.includes("429") ||
        error.message?.includes("Rate limit");

      if (isRateLimit) {
        rateLimiter.consecutiveErrors++;
        let waitTime = Math.pow(2, attempt) * 2000 + Math.random() * 1000;

        if (rateLimiter.consecutiveErrors > 3) {
          waitTime *= 2;
        }

        const waitSeconds = (waitTime / 1000).toFixed(1);
        console.warn(
          `   ⚠️  Rate limit (${operationName}) - Attempt ${
            attempt + 1
          }/${maxRetries}`
        );
        console.warn(`   ⏳ Waiting ${waitSeconds}s before retry...`);

        await sleep(waitTime);

        if (attempt === maxRetries - 1) {
          console.error(`   ❌ Max retries reached for ${operationName}`);
          throw error;
        }

        continue;
      }

      throw error;
    }
  }
}

// -------------------------------------------------------------------
// --- CHECKPOINT FUNCTIONS ---
// -------------------------------------------------------------------

async function loadCheckpoint() {
  try {
    const data = await fs.readFile(CHECKPOINT_FILE, "utf-8");
    const checkpoint = JSON.parse(data);
    console.log(`\n📍 CHECKPOINT FOUND!`);
    console.log(
      `   ✅ Already processed: ${checkpoint.processedCount} products`
    );
    console.log(`   📊 Created: ${checkpoint.stats.created}`);
    console.log(`   🔄 Updated: ${checkpoint.stats.updated}`);
    console.log(`   ⏭️  Skipped: ${checkpoint.stats.skipped}`);
    console.log(`   🔁 Duplicates: ${checkpoint.stats.duplicates}`);
    console.log(`   🤖 API calls: ${checkpoint.apiCalls || 0}`);
    console.log(`   📅 Last saved: ${checkpoint.timestamp}\n`);

    if (checkpoint.apiCalls) {
      rateLimiter.dailyRequestCount = checkpoint.apiCalls;
    }

    return {
      processedUrls: new Set(checkpoint.processedUrls),
      processedProductKeys: new Set(checkpoint.processedProductKeys),
      processedCount: checkpoint.processedCount,
      lastProcessedIndex: checkpoint.lastProcessedIndex,
      stats: checkpoint.stats,
      apiCalls: checkpoint.apiCalls || 0,
    };
  } catch (error) {
    console.log(`\n📍 No checkpoint found - starting fresh import\n`);
    return {
      processedUrls: new Set(),
      processedProductKeys: new Set(),
      processedCount: 0,
      lastProcessedIndex: -1,
      stats: {
        created: 0,
        updated: 0,
        skipped: 0,
        duplicates: 0,
        errors: 0,
        invalidImages: 0,
      },
      apiCalls: 0,
    };
  }
}

async function saveCheckpoint(checkpoint) {
  try {
    const checkpointData = {
      processedUrls: Array.from(checkpoint.processedUrls),
      processedProductKeys: Array.from(checkpoint.processedProductKeys),
      processedCount: checkpoint.processedCount,
      lastProcessedIndex: checkpoint.lastProcessedIndex,
      stats: checkpoint.stats,
      apiCalls: rateLimiter.dailyRequestCount,
      timestamp: new Date().toISOString(),
    };
    await fs.writeFile(
      CHECKPOINT_FILE,
      JSON.stringify(checkpointData, null, 2)
    );
    console.log(
      `   💾 Checkpoint saved (${checkpoint.processedCount} products, ${rateLimiter.dailyRequestCount} API calls)`
    );

    await saveCache();
  } catch (error) {
    console.error(`   ⚠️ Failed to save checkpoint: ${error.message}`);
  }
}

async function clearCheckpoint() {
  try {
    await fs.unlink(CHECKPOINT_FILE);
    console.log(`\n✅ Checkpoint cleared - ready for fresh import\n`);
  } catch (error) {
    // File doesn't exist, that's fine
  }
}

// -------------------------------------------------------------------
// --- COMBINED AI PROMPT ---
// -------------------------------------------------------------------

const COMBINED_EXTRACTION_PROMPT = `
You are a Fashion E-commerce Data Extraction AI specializing in Diesel products. Analyze the product and return a SINGLE JSON object with ALL required fields.

**OUTPUT STRUCTURE:**
{
  "category": "CLOTHING|FOOTWEAR|ACCESSORIES",
  "core_name": "normalized title for deduplication",
  "specs": {
    "type": "exact product type (MANDATORY - guess from title/description)",
    "size": "normalized size",
    "gender": "men|women|kids|boys|girls|unisex",
    "color": "normalized color",
    "material": "material if present",
    "fit": "slim fit|regular fit|relaxed fit|etc",
    "pattern": "solid|striped|floral|etc",
    "wash": "wash type for denim"
  }
}

**CATEGORY RULES:**
- CLOTHING: jeans, joggjeans, shirts, jackets, hoodies, sweaters, t-shirts, pants, shorts
- FOOTWEAR: shoes, sneakers, boots, sandals
- ACCESSORIES: bags, belts, wallets, watches, sunglasses, caps

**TYPE DETECTION (MANDATORY - GUESS FROM TITLE/DESCRIPTION):**
You MUST determine the product type from the title or description. Common Diesel types:
- Denim: "jeans", "joggjeans", "denim shorts", "denim jacket"
- Tops: "t-shirt", "shirt", "polo", "hoodie", "sweater", "sweatshirt"
- Bottoms: "pants", "shorts", "joggers", "chinos"
- Outerwear: "jacket", "coat", "bomber", "parka"
- Footwear: "sneakers", "boots", "shoes"
- Accessories: "bag", "backpack", "belt", "wallet", "watch", "cap", "beanie"

Examples:
- "Tapered 2030 D-Krooley Joggjeans" → type: "joggjeans"
- "Only The Brave T-shirt" → type: "t-shirt"
- "D-Strukt Slim Jeans" → type: "jeans"
- "S-Ginn Hoodie" → type: "hoodie"

**CORE_NAME RULES:**
Remove sizes, colors, patterns, materials (unless essential to product identity).
Keep: product line + core type + key descriptors (slim, tapered, relaxed)
Examples:
- "Tapered 2030 D-Krooley Joggjeans Blue 32" → "tapered 2030 d-krooley joggjeans"
- "Only The Brave T-shirt White L" → "only the brave t-shirt"
- "D-Strukt Slim Jeans Black 30" → "d-strukt slim jeans"

**SIZE NORMALIZATION:**
- Jeans/Pants: "28", "30", "32", "34", "36", "38", "40" (waist size)
- Tops: "xs", "s", "m", "l", "xl", "xxl" (lowercase)
- Shoes (EU): "39", "40", "41", "42", "43", "44", "45"

**COLOR NORMALIZATION:**
- Basic colors (lowercase): "black", "white", "blue", "red", "gray", "navy", "denim", "indigo"
- Denim washes: "light blue", "medium blue", "dark blue", "black", "gray"
- Multi-word: "light blue", "dark gray", "indigo blue"

**GENDER NORMALIZATION:**
- "men", "women", "kids", "boys", "girls", "unisex"
- Look for: "male" → "men", "female" → "women"

**WASH (for denim products):**
- "light wash", "medium wash", "dark wash", "black wash", "gray wash"
- "distressed", "clean", "vintage", "faded"

**MATERIAL:**
- "denim", "cotton", "leather", "wool", "polyester", "stretch denim"

**FIT:**
- "slim fit", "regular fit", "relaxed fit", "skinny", "straight", "tapered", "loose fit"

**PATTERN:**
- "solid", "striped", "distressed", "washed", "faded", "ripped"

**CRITICAL:**
- ALL keys lowercase with underscores (snake_case)
- ALL values lowercase strings
- ALWAYS include 'type' field in specs - GUESS from title if needed
- Do not hallucinate - only extract what exists
- Return ONLY valid JSON, no explanations
`;

// -------------------------------------------------------------------
// --- COMBINED AI FUNCTION ---
// -------------------------------------------------------------------

async function extractAllProductData(title, description, csvRow) {
  const cacheKey = `${title.toLowerCase().substring(0, 100)}_${
    csvRow?.[FIELD_MAPPING.category] || ""
  }`;

  if (persistentCache.categoryDetection[cacheKey]) {
    console.log(`  💾 Using cached extraction`);
    return persistentCache.categoryDetection[cacheKey];
  }

  // Parse the param field (size:36|gender:male)
  let parsedParams = {};
  if (csvRow?.param) {
    const params = csvRow.param.split("|");
    params.forEach((param) => {
      const [key, value] = param.split(":");
      if (key && value) {
        parsedParams[key.trim()] = value.trim();
      }
    });
  }

  let additionalContext = "";
  if (csvRow) {
    // Add parsed params to context
    if (parsedParams.size) additionalContext += `Size: ${parsedParams.size}\n`;
    if (parsedParams.gender)
      additionalContext += `Gender: ${parsedParams.gender}\n`;

    // Add other relevant CSV fields
    const relevantFields = ["categoryId", "material", "season"];
    for (const field of relevantFields) {
      const value = csvRow[field];
      if (value) {
        additionalContext += `${field}: ${value}\n`;
      }
    }
  }

  const userPrompt = `
PRODUCT TITLE: "${title}"

PRODUCT DESCRIPTION:
${description.substring(0, 600)}

CSV DATA:
${additionalContext}

Return the complete JSON object with category, core_name, and specs. 
IMPORTANT: You MUST guess the product 'type' from the title or description.
`;

  try {
    const result = await callOpenAIWithRetry(
      async () => {
        const completion = await openai.chat.completions.create({
          model: LLM_MODEL,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: COMBINED_EXTRACTION_PROMPT },
            { role: "user", content: userPrompt },
          ],
          temperature: 0,
        });
        return JSON.parse(completion.choices[0].message.content);
      },
      5,
      "Combined extraction"
    );

    const extracted = {
      category: (result.category || "CLOTHING").toUpperCase(), // ✅ ALWAYS UPPERCASE
      core_name: result.core_name || title.toLowerCase(),
      specs: result.specs || { type: "item" },
    };

    // Ensure type exists - if not, try to guess from title
    if (!extracted.specs.type) {
      extracted.specs.type = guessTypeFromTitle(title);
    }

    // Add essential CSV fields to specs (sku, currency)
    Object.entries(ESSENTIAL_MAPPINGS).forEach(([specField, csvField]) => {
      const value = csvRow?.[csvField];
      if (value && value !== "") {
        extracted.specs[specField] = String(value).trim();
      }
    });

    // Add additional important CSV fields to specs (param, season, material)
    SPECS_FIELDS.forEach((field) => {
      const value = csvRow?.[field];
      if (value && value !== "") {
        extracted.specs[field] = String(value).trim();
      }
    });

    // Add parsed params to specs
    if (parsedParams.size && !extracted.specs.size) {
      extracted.specs.size = parsedParams.size.toLowerCase();
    }
    if (parsedParams.gender && !extracted.specs.gender) {
      const genderMap = {
        male: "men",
        female: "women",
        unisex: "unisex",
      };
      extracted.specs.gender =
        genderMap[parsedParams.gender.toLowerCase()] ||
        parsedParams.gender.toLowerCase();
    }

    // Cache the result
    persistentCache.categoryDetection[cacheKey] = extracted;

    return extracted;
  } catch (error) {
    console.error(`  ⚠️ Combined extraction failed:`, error.message);
    return extractWithRegexFallback(title, description, csvRow);
  }
}

// Helper function to guess type from title
function guessTypeFromTitle(title) {
  const lower = title.toLowerCase();

  // Denim products
  if (lower.includes("joggjeans") || lower.includes("jogg jeans"))
    return "joggjeans";
  if (lower.includes("jeans")) return "jeans";
  if (lower.includes("denim short")) return "denim shorts";
  if (lower.includes("denim jacket")) return "denim jacket";

  // Tops
  if (
    lower.includes("t-shirt") ||
    lower.includes("tshirt") ||
    lower.includes("tee")
  )
    return "t-shirt";
  if (lower.includes("polo")) return "polo";
  if (lower.includes("hoodie")) return "hoodie";
  if (lower.includes("sweater") || lower.includes("sweatshirt"))
    return "sweater";
  if (lower.includes("shirt")) return "shirt";

  // Bottoms
  if (lower.includes("short")) return "shorts";
  if (lower.includes("jogger")) return "joggers";
  if (lower.includes("chino")) return "chinos";
  if (lower.includes("pants") || lower.includes("trousers")) return "pants";

  // Outerwear
  if (lower.includes("bomber")) return "bomber jacket";
  if (lower.includes("parka")) return "parka";
  if (lower.includes("coat")) return "coat";
  if (lower.includes("jacket")) return "jacket";

  // Footwear
  if (lower.includes("sneaker")) return "sneakers";
  if (lower.includes("boot")) return "boots";
  if (lower.includes("shoe")) return "shoes";
  if (lower.includes("sandal")) return "sandals";

  // Accessories
  if (lower.includes("backpack")) return "backpack";
  if (lower.includes("bag")) return "bag";
  if (lower.includes("belt")) return "belt";
  if (lower.includes("wallet")) return "wallet";
  if (lower.includes("watch")) return "watch";
  if (lower.includes("cap") || lower.includes("hat")) return "cap";
  if (lower.includes("beanie")) return "beanie";
  if (lower.includes("sunglasses")) return "sunglasses";

  // Default
  return "clothing item";
}

// -------------------------------------------------------------------
// --- REGEX FALLBACK ---
// -------------------------------------------------------------------

function extractWithRegexFallback(title, description, csvRow) {
  console.log(`  🔄 Using regex fallback extraction`);

  const text = `${title} ${description}`.toLowerCase();

  let category = "CLOTHING";
  if (text.match(/\b(shoe|sneaker|boot|sandal)\b/)) {
    category = "FOOTWEAR";
  } else if (text.match(/\b(bag|backpack|wallet|belt|watch|sunglasses)\b/)) {
    category = "ACCESSORIES";
  }

  // Ensure category is always uppercase
  category = category.toUpperCase();

  let coreName = title
    .toLowerCase()
    .replace(/\b(xs|s|m|l|xl|xxl|xxxl)\b/gi, "")
    .replace(/\b(28|30|32|34|36|38|40|42|44)\b/gi, "")
    .replace(/\b(black|white|red|blue|green|gray|grey|navy|denim)\b/gi, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const specs = {};

  // Parse param field (size:36|gender:male)
  let parsedParams = {};
  if (csvRow?.param) {
    const params = csvRow.param.split("|");
    params.forEach((param) => {
      const [key, value] = param.split(":");
      if (key && value) {
        parsedParams[key.trim()] = value.trim();
      }
    });
  }

  // Size from param or text
  if (parsedParams.size) {
    specs.size = parsedParams.size.toLowerCase();
  } else {
    const sizeMatch =
      text.match(/\b(xs|s|m|l|xl|xxl|xxxl)\b/i) ||
      text.match(/\b(28|30|32|34|36|38|40|42|44)\b/);
    if (sizeMatch) specs.size = sizeMatch[1].toLowerCase();
  }

  // Color
  const colorMatch = text.match(
    /\b(black|white|red|blue|green|gray|grey|navy|denim|indigo)\b/i
  );
  if (colorMatch) specs.color = colorMatch[1].toLowerCase();

  // Gender from param or text
  if (parsedParams.gender) {
    const genderMap = {
      male: "men",
      female: "women",
      unisex: "unisex",
    };
    specs.gender =
      genderMap[parsedParams.gender.toLowerCase()] ||
      parsedParams.gender.toLowerCase();
  } else {
    if (text.includes("men") || text.includes("male")) specs.gender = "men";
    else if (text.includes("women") || text.includes("female"))
      specs.gender = "women";
    else if (text.includes("kid")) specs.gender = "kids";
  }

  // Type - use the guessTypeFromTitle function
  specs.type = guessTypeFromTitle(title);

  // Add essential CSV fields to specs (sku, currency)
  Object.entries(ESSENTIAL_MAPPINGS).forEach(([specField, csvField]) => {
    const value = csvRow?.[csvField];
    if (value && value !== "") {
      specs[specField] = String(value).trim();
    }
  });

  // Add additional important CSV fields to specs (param, season, material)
  SPECS_FIELDS.forEach((field) => {
    const value = csvRow?.[field];
    if (value && value !== "") {
      specs[field] = String(value).trim();
    }
  });

  return {
    category,
    core_name: coreName,
    specs,
  };
}

// -------------------------------------------------------------------
// --- HELPER FUNCTIONS ---
// -------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function validateImageUrl(url) {
  if (!url || url.includes("placeholder")) return false;

  try {
    const response = await fetch(url, { method: "HEAD", timeout: 5000 });
    return response.ok;
  } catch (error) {
    return false;
  }
}

async function downloadCSV(url) {
  console.log(`📥 Downloading CSV from: ${url}`);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const csvText = await response.text();
    console.log(`✅ CSV downloaded successfully (${csvText.length} bytes)`);

    // Show first few CSV fields for verification
    const lines = csvText.split("\n");
    if (lines.length > 0) {
      console.log(`\n📋 CSV Header Fields:`);
      const headers = lines[0].split(",");
      headers.forEach((h, i) => {
        console.log(`   ${i + 1}. ${h.trim()}`);
      });
      console.log("");
    }

    return csvText;
  } catch (error) {
    console.error(`❌ Failed to download CSV: ${error.message}`);
    throw error;
  }
}

function parseCSV(csvText) {
  console.log(`📊 Parsing CSV data...`);

  try {
    const records = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      bom: true,
      delimiter: ";", // 🔥 Diesel CSV uses semicolon delimiter!
    });

    console.log(`✅ Parsed ${records.length} rows from CSV`);

    // Show sample product data
    if (records.length > 0) {
      console.log(`\n🔍 Sample Product (first row):`);
      const sample = records[0];
      Object.entries(FIELD_MAPPING).forEach(([ourField, csvField]) => {
        const value = sample[csvField];
        if (value) {
          const display =
            value.length > 60 ? value.substring(0, 60) + "..." : value;
          console.log(`   ${ourField}: ${display}`);
        }
      });
      console.log("");
    }

    return records;
  } catch (error) {
    console.error(`❌ Failed to parse CSV: ${error.message}`);
    throw error;
  }
}

async function getEmbedding(text) {
  try {
    const response = await callOpenAIWithRetry(
      async () => {
        return await openai.embeddings.create({
          model: "text-embedding-3-small",
          input: text,
          encoding_format: "float",
        });
      },
      5,
      "Embedding"
    );
    return response.data[0].embedding;
  } catch (error) {
    console.error("⚠️ OpenAI Embedding Error:", error.message);
    return null;
  }
}

function generateCascadingContext(title, brand, specs, price, description) {
  let context = `${brand} ${title}.`;

  const specString = Object.entries(specs)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");

  if (specString) context += ` Specs: ${specString}.`;
  context += ` Price: ${price} ${CURRENCY}.`;

  if (description && description.length > 20) {
    const cleanDesc = description.substring(0, 300).replace(/\s+/g, " ").trim();
    context += ` Description: ${cleanDesc}`;
  }

  return context;
}

function mapCSVRowToProduct(row) {
  // Extract and clean URL
  let productUrl = (row[FIELD_MAPPING.productUrl] || "").trim();
  let cleanUrl = productUrl;

  // Handle affiliate links - extract the actual Diesel URL from ulp parameter
  if (productUrl.includes("ulp=")) {
    try {
      const ulpMatch = productUrl.match(/ulp=([^&]+)/);
      if (ulpMatch) {
        let dieselUrl = decodeURIComponent(ulpMatch[1]);
        // Further decode if needed
        if (dieselUrl.includes("%")) {
          dieselUrl = decodeURIComponent(dieselUrl);
        }
        cleanUrl = dieselUrl.split("?")[0]; // Remove query params
      }
    } catch (e) {
      // If decoding fails, just use the original URL
      cleanUrl = productUrl.split("?")[0];
    }
  } else if (productUrl.includes("?")) {
    cleanUrl = productUrl.split("?")[0];
  }

  // Extract image URL
  let imageUrl = (row[FIELD_MAPPING.imageUrl] || "").trim();
  if (!imageUrl) {
    imageUrl = "https://via.placeholder.com/600x800?text=No+Image";
  }

  // Parse prices - handle KWD currency
  const priceStr = (row[FIELD_MAPPING.price] || "0").trim();
  const price = parseFloat(priceStr.replace(/[^0-9.]/g, ""));

  const oldPriceStr = (row[FIELD_MAPPING.oldPrice] || "0").trim();
  const oldPrice = oldPriceStr
    ? parseFloat(oldPriceStr.replace(/[^0-9.]/g, ""))
    : 0;

  // Parse availability (boolean: true/false)
  const availabilityStr = (row[FIELD_MAPPING.availability] || "true")
    .toString()
    .toLowerCase()
    .trim();
  const isAvailable =
    availabilityStr === "true" ||
    availabilityStr === "1" ||
    availabilityStr === "yes";

  return {
    title: (row[FIELD_MAPPING.title] || "").trim() || "Untitled Product",
    description: (row[FIELD_MAPPING.description] || "").trim() || "",
    price: price,
    originalPrice: oldPrice > price ? oldPrice : price,
    imageUrl: imageUrl,
    productUrl: productUrl,
    cleanUrl: cleanUrl,
    sku: (row[FIELD_MAPPING.sku] || "").trim() || null,
    availability: isAvailable ? "in stock" : "out of stock",
    rawCategory: (row[FIELD_MAPPING.category] || "").trim() || null,
    brand: (row[FIELD_MAPPING.brand] || "DIESEL").trim(),
    currency: (row[FIELD_MAPPING.currency] || CURRENCY).trim(),
  };
}

function determineStockStatus(availabilityText) {
  if (!availabilityText) return StockStatus.IN_STOCK;

  const text = availabilityText.toLowerCase();

  if (
    text.includes("out of stock") ||
    text === "out_of_stock" ||
    text === "oos" ||
    text === "0" ||
    text === "false"
  ) {
    return StockStatus.OUT_OF_STOCK;
  }

  return StockStatus.IN_STOCK;
}

// -------------------------------------------------------------------
// --- MAIN IMPORTER LOGIC ---
// -------------------------------------------------------------------

async function importDieselProducts() {
  await loadCache();
  const checkpoint = await loadCheckpoint();

  let createdCount = checkpoint.stats.created;
  let updatedCount = checkpoint.stats.updated;
  let skippedCount = checkpoint.stats.skipped;
  let duplicateCount = checkpoint.stats.duplicates;
  let errorCount = checkpoint.stats.errors;
  let invalidImageCount = checkpoint.stats.invalidImages;

  try {
    console.log(`🏪 Import Configuration:`);
    console.log(`   Store: ${STORE_NAME_FIXED}`);
    console.log(`   Currency: ${CURRENCY}`);
    console.log(`   Concurrent Limit: ${CONCURRENT_LIMIT}`);
    console.log(`   Batch Delay: ${BATCH_DELAY_MS}ms`);
    console.log(`   API Calls Used: ${rateLimiter.dailyRequestCount}`);
    console.log(
      `   Checkpoint: ${
        checkpoint.processedCount > 0 ? "RESUMING" : "FRESH START"
      }\n`
    );

    const csvText = await downloadCSV(CSV_URL);
    const csvRows = parseCSV(csvText);

    if (csvRows.length === 0) {
      console.log("⚠️ No products found in CSV");
      return;
    }

    console.log(`\n✅ Found ${csvRows.length} products in CSV`);
    console.log(`📊 Already processed: ${checkpoint.processedCount}`);
    console.log(
      `🆕 Remaining: ${csvRows.length - checkpoint.processedCount}\n`
    );
    console.log(`${"=".repeat(60)}`);
    console.log(`Starting import...`);
    console.log(`${"=".repeat(60)}\n`);

    const processProduct = async (csvRow, index) => {
      try {
        const productData = mapCSVRowToProduct(csvRow);

        if (!productData.title || !productData.productUrl) {
          console.log(
            `[${index + 1}/${csvRows.length}] ⚠️ SKIP: Missing title/URL`
          );
          skippedCount++;
          return;
        }

        console.log(
          `\n[${index + 1}/${csvRows.length}] 🔍 ${productData.title.substring(
            0,
            50
          )}...`
        );
        console.log(
          `  🤖 API calls: ${rateLimiter.dailyRequestCount} | Errors: ${rateLimiter.consecutiveErrors}`
        );

        // Check if already processed
        const existingInDB = await prisma.product.findFirst({
          where: {
            storeName: STORE_NAME_FIXED,
            title: productData.title,
            price: {
              gte: productData.price - 0.01,
              lte: productData.price + 0.01,
            },
          },
          select: {
            id: true,
            title: true,
            price: true,
            productUrl: true,
          },
        });

        if (existingInDB) {
          const existingBaseUrl = existingInDB.productUrl.split("?")[0];
          const currentBaseUrl = productData.productUrl.split("?")[0];

          if (existingBaseUrl === currentBaseUrl) {
            console.log(`  ⏩ SKIP: Duplicate`);
            skippedCount++;
            checkpoint.processedUrls.add(productData.cleanUrl);
            checkpoint.processedCount++;
            return;
          }
        }

        if (checkpoint.processedUrls.has(productData.cleanUrl)) {
          console.log(`  ⏭️  SKIP: Already processed`);
          return;
        }

        // Validate image
        if (
          productData.imageUrl &&
          !productData.imageUrl.includes("placeholder")
        ) {
          const isValid = await validateImageUrl(productData.imageUrl);
          if (!isValid) {
            console.log(`  ❌ Invalid image - SKIPPING`);
            skippedCount++;
            invalidImageCount++;
            checkpoint.processedUrls.add(productData.cleanUrl);
            checkpoint.processedCount++;
            return;
          }
        } else {
          console.log(`  ❌ No image - SKIPPING`);
          skippedCount++;
          invalidImageCount++;
          checkpoint.processedUrls.add(productData.cleanUrl);
          checkpoint.processedCount++;
          return;
        }

        console.log(`  💰 NEW PRODUCT: Starting AI processing...`);

        // Combined AI extraction
        console.log(`  🤖 AI: Combined extraction...`);
        const extracted = await extractAllProductData(
          productData.title,
          productData.description,
          csvRow
        );

        const category = extracted.category;
        const specs = extracted.specs;
        const coreName = extracted.core_name;

        // Generate product key for deduplication
        const productKey = `${productData.brand.toLowerCase()}_${coreName}_${category.toLowerCase()}`;

        if (checkpoint.processedProductKeys.has(productKey)) {
          console.log(`  ⚠️ DUPLICATE: Same product, different variant`);
          duplicateCount++;
          checkpoint.processedUrls.add(productData.cleanUrl);
          checkpoint.processedCount++;
          return;
        }

        checkpoint.processedProductKeys.add(productKey);

        // Generate embedding
        console.log(`  🤖 AI: Generating embedding...`);
        const searchKey = generateCascadingContext(
          productData.title,
          productData.brand,
          specs,
          productData.price,
          productData.description
        );
        const vector = await getEmbedding(searchKey);

        const stock = determineStockStatus(productData.availability);

        console.log(`  💾 Saving to database...`);

        const record = await prisma.product.create({
          data: {
            title: productData.title,
            description: productData.description,
            category: category,
            price: productData.price,
            imageUrl: productData.imageUrl,
            stock: stock,
            lastSeenAt: new Date(),
            brand: productData.brand,
            specs: specs,
            searchKey: searchKey,
            storeName: STORE_NAME_FIXED,
            productUrl: productData.productUrl,
            scrapedAt: new Date(),
          },
          select: { id: true, title: true },
        });

        createdCount++;
        console.log(`  ✅ CREATED: ${record.title.substring(0, 40)}...`);

        // Update vector embedding
        if (vector) {
          const vectorString = `[${vector.join(",")}]`;
          await prisma.$executeRaw`UPDATE "Product" SET "descriptionEmbedding" = ${vectorString}::vector WHERE id = ${record.id}`;
        }

        checkpoint.processedUrls.add(productData.cleanUrl);
        checkpoint.processedCount++;
        checkpoint.lastProcessedIndex = index;
        checkpoint.stats = {
          created: createdCount,
          updated: updatedCount,
          skipped: skippedCount,
          duplicates: duplicateCount,
          errors: errorCount,
          invalidImages: invalidImageCount,
        };

        if (checkpoint.processedCount % CHECKPOINT_SAVE_INTERVAL === 0) {
          await saveCheckpoint(checkpoint);
        }
      } catch (error) {
        errorCount++;
        console.error(`  ❌ Error: ${error.message}`);
        checkpoint.processedUrls.add(productData.cleanUrl);
        checkpoint.processedCount++;
      }
    };

    // Process in batches
    for (let i = 0; i < csvRows.length; i += CONCURRENT_LIMIT) {
      const batch = csvRows.slice(i, i + CONCURRENT_LIMIT);
      const batchNumber = Math.ceil((i + 1) / CONCURRENT_LIMIT);
      const totalBatches = Math.ceil(csvRows.length / CONCURRENT_LIMIT);

      console.log(
        `\n🔄 Batch ${batchNumber}/${totalBatches} (API: ${rateLimiter.dailyRequestCount})`
      );

      await Promise.all(batch.map((row, idx) => processProduct(row, i + idx)));

      if (i + CONCURRENT_LIMIT < csvRows.length) {
        console.log(`   ⏸️  Pausing ${BATCH_DELAY_MS}ms...`);
        await sleep(BATCH_DELAY_MS);
      }
    }

    await saveCheckpoint(checkpoint);
    await clearCheckpoint();
  } catch (error) {
    console.error(`\n❌ Fatal error: ${error.message}`);
    console.log(`💾 Checkpoint saved - resume by running again`);
    await saveCheckpoint(checkpoint);
    throw error;
  } finally {
    await prisma.$disconnect();
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`🎉 DIESEL IMPORT COMPLETE`);
  console.log(`${"=".repeat(60)}`);
  console.log(`✅ Created: ${createdCount}`);
  console.log(`🔄 Updated: ${updatedCount}`);
  console.log(`⚠️ Skipped: ${skippedCount}`);
  console.log(`🔁 Duplicates: ${duplicateCount}`);
  console.log(`🖼️  Invalid Images: ${invalidImageCount}`);
  console.log(`❌ Errors: ${errorCount}`);
  console.log(`🤖 Total API Calls: ${rateLimiter.dailyRequestCount}`);
  console.log(
    `💾 Cache entries: ${Object.keys(persistentCache.categoryDetection).length}`
  );
  console.log(
    `📊 Total: ${
      createdCount + updatedCount + skippedCount + duplicateCount + errorCount
    }`
  );
  console.log(`${"=".repeat(60)}\n`);
}

// -------------------------------------------------------------------
// --- EXECUTE ---
// -------------------------------------------------------------------

importDieselProducts()
  .then(() => {
    console.log("✅ Script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Script failed:", error);
    console.log("\n💡 TIP: Run again to resume from checkpoint!");
    process.exit(1);
  });
