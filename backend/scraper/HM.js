import fetch from "node-fetch";
import { parse } from "csv-parse/sync";
import { PrismaClient, StockStatus, StoreName } from "@prisma/client";
import OpenAI from "openai";
import fs from "fs/promises";

// --- GLOBAL CONFIGURATION ---
const prisma = new PrismaClient();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const CSV_URL =
  "https://product-feeds.optimisemedia.com/feeds/49?aid=2360728&format=csv";
const STORE_NAME_FIXED = StoreName.HM;
const CURRENCY = "KWD";

// --- CONCURRENCY SETTING ---
const CONCURRENT_LIMIT = 5;
const LLM_MODEL = "gpt-4o-mini";

// 🔥 CHECKPOINT SYSTEM - Save progress to resume after interruptions
const CHECKPOINT_FILE = "./hm_import_checkpoint.json";
const CHECKPOINT_SAVE_INTERVAL = 5; // Save checkpoint every 5 products

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
    console.log(`   📅 Last saved: ${checkpoint.timestamp}\n`);

    return {
      processedUrls: new Set(checkpoint.processedUrls),
      processedProductKeys: new Set(checkpoint.processedProductKeys),
      processedCount: checkpoint.processedCount,
      lastProcessedIndex: checkpoint.lastProcessedIndex,
      stats: checkpoint.stats,
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
      timestamp: new Date().toISOString(),
    };
    await fs.writeFile(
      CHECKPOINT_FILE,
      JSON.stringify(checkpointData, null, 2)
    );
    console.log(
      `   💾 Checkpoint saved (${checkpoint.processedCount} products processed)`
    );
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
// --- FASHION-OPTIMIZED SYSTEM PROMPT ---
// -------------------------------------------------------------------

const FASHION_SYSTEM_PROMPT = `
You are a strict Data Extraction AI for a Fashion E-commerce Database.
Your goal is to extract a flat JSON object of filtering attributes ("specs") from raw product data.

### 1. INPUT HIERARCHY (The "Triangle of Truth")
- **TIER 1 (Highest Authority):** PRODUCT TITLE. Trust this above all for determining Color, Size, Style.
- **TIER 2 (High Detail):** PRODUCT DESCRIPTION. Use this for Material, Fit, Pattern, Care Instructions.
- **TIER 3 (Context):** Additional CSV fields. Use only as a fallback.

### 2. CRITICAL NORMALIZATION RULES (MANDATORY)

**CLOTHING SIZES:**
- Normalize to lowercase: "xs", "s", "m", "l", "xl", "xxl", "xxxl"
- Numeric sizes stay as-is: "2", "4", "6", "8", "10", "12", "14", "16", "18"
- EU sizes: "32", "34", "36", "38", "40", "42", "44", "46"
- Kids sizes: "2y", "4y", "6y", "8y", "10y", "12y", "14y"
- If range like "S/M", extract first: "s"

**SHOE SIZES:**
- EU format: "36", "37", "38", "39", "40", "41", "42", "43", "44", "45"
- US format: "6", "7", "8", "9", "10", "11", "12"
- UK format: "3", "4", "5", "6", "7", "8", "9", "10"

**COLORS:**
- Normalize to basic colors (lowercase):
  * "Black" -> "black"
  * "White" -> "white"
  * "Navy Blue" -> "navy"
  * "Light Blue" -> "light blue"
  * "Dark Gray" -> "dark gray"
  * "Beige/Cream/Ecru/Ivory" -> "beige"
  * "Khaki/Olive" -> "khaki"
  * "Burgundy/Wine/Maroon" -> "burgundy"
- Preserve multi-word colors: "light pink", "dark green", "navy blue"
- Pattern + Color: "striped blue", "floral red", "checkered black"

**GENDER:**
- Normalize to: "men", "women", "kids", "boys", "girls", "unisex", "baby"
- Extract from category or title

**MATERIAL:**
- Normalize to lowercase: "cotton", "polyester", "wool", "silk", "linen", "denim", "leather"
- Blends: "cotton blend", "wool blend", "polyester blend"
- Percentages: "100% cotton", "80% cotton 20% polyester"

**FIT:**
- Normalize to: "slim fit", "regular fit", "relaxed fit", "oversized", "loose fit", "skinny", "straight"

**STYLE/TYPE (IMPORTANT - This goes in specs.type field):**
- For clothing: "t-shirt", "jeans", "dress", "jacket", "sweater", "shirt", "pants", "skirt", "coat", "hoodie", "shorts", "leggings", "blouse", "cardigan"
- For shoes: "sneakers", "boots", "sandals", "heels", "flats", "loafers", "oxfords"
- For accessories: "bag", "backpack", "belt", "hat", "scarf", "sunglasses", "jewelry"
- Subcategories: "crew neck", "v-neck", "button-down", "zip-up", "sleeveless"

**PATTERN:**
- Normalize to: "solid", "striped", "checkered", "floral", "polka dot", "paisley", "geometric", "animal print"

**SLEEVE LENGTH:**
- Normalize to: "short sleeve", "long sleeve", "sleeveless", "3/4 sleeve"

**LENGTH:**
- For dresses/skirts: "mini", "knee-length", "midi", "maxi", "ankle-length"
- For pants: "full-length", "cropped", "capri", "shorts"

### 3. CRITICAL: The 'type' field in specs
The original CSV category (like "TOPS", "BOTTOMS", "SWIMWEAR") will be stored in the database's 'category' column.
In specs, you MUST include a 'type' field that specifies the EXACT type of clothing:
- For TOPS: "t-shirt", "shirt", "blouse", "sweater", "hoodie", "tank top", "cardigan"
- For BOTTOMS: "jeans", "pants", "shorts", "skirt", "leggings"
- For SHOES: "sneakers", "boots", "sandals", "heels", "flats"
- For ACCESSORIES: "bag", "backpack", "belt", "hat", "scarf"

Example:
Category in DB: "TOPS"
Specs: { "type": "t-shirt", "size": "m", "color": "black", ... }

### 4. FASHION CATEGORY CRITICAL KEYS (MANDATORY)

**ALL PRODUCTS:**
- \`type\`: MANDATORY - exact product type (e.g., "jeans", "t-shirt", "sneakers", "dress")
- \`size\`: size of the item (if applicable)
- \`gender\`: e.g., "men", "women", "unisex", "kids"
- \`color\`: normalized color name

**CLOTHING (TOPS/BOTTOMS/DRESSES/OUTERWEAR):**
- \`type\`: MANDATORY
- \`size\`: e.g., "s", "m", "l", "xl"
- \`gender\`: e.g., "men", "women", "unisex"
- \`color\`: normalized color name
Optional: material, fit, pattern, sleeve_length, length, neckline

**SHOES:**
- \`type\`: MANDATORY (e.g., "sneakers", "boots")
- \`size\`: e.g., "40", "41", "42" (EU) or "8", "9", "10" (US)
- \`gender\`: e.g., "men", "women", "kids"
- \`color\`: normalized color name
Optional: material, heel_height

**ACCESSORIES:**
- \`type\`: MANDATORY (e.g., "backpack", "belt", "hat")
- \`color\`: normalized color name
- \`gender\`: e.g., "men", "women", "unisex"
Optional: material, size (for belts, hats)

### 5. OUTPUT FORMAT RULES
- Return ONLY a flat JSON object
- ALL keys must be lowercase with underscores (snake_case)
- ALL values must be lowercase strings
- Do NOT include: Price, Stock, Store Name, SKU (stored separately)
- ALWAYS include 'type' field - this is MANDATORY
- If a critical key cannot be determined, set it to null but DO NOT omit it
- Do not hallucinate data - only extract what exists
`;

// --- CATEGORY DETECTION PROMPT (Simplified to 3 main categories) ---
const CATEGORY_DETECTION_PROMPT = `
Classify this fashion product into ONE of these 3 categories:
- CLOTHING (all wearable items: shirts, pants, dresses, jackets, underwear, swimwear, activewear, etc.)
- FOOTWEAR (all shoes: sneakers, boots, sandals, heels, slippers, etc.)
- ACCESSORIES (bags, belts, hats, scarves, sunglasses, jewelry, watches, etc.)

Return ONLY a JSON object with a single "category" field in UPPERCASE.

Examples:
{"category": "CLOTHING"}
{"category": "FOOTWEAR"}
{"category": "ACCESSORIES"}
`;

// -------------------------------------------------------------------
// --- HELPER FUNCTIONS ---
// -------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 🔥 LLM-POWERED TYPE NORMALIZATION - Cached to save API calls
async function normalizeProductType(type) {
  if (!type) return null;

  const normalizedLower = type.toLowerCase().trim();
  const cacheKey = `type_norm_${normalizedLower}`;

  if (!global.typeNormalizationCache) {
    global.typeNormalizationCache = new Map();
  }

  if (global.typeNormalizationCache.has(cacheKey)) {
    return global.typeNormalizationCache.get(cacheKey);
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a fashion product type normalizer. Standardize product type names consistently.

Rules:
1. Use lowercase
2. Use hyphens for compound words: "t-shirt" NOT "t shirt"
3. Use singular unless plural is standard: "jeans", "pants", "shorts"
4. Standard formats: "t-shirt", "sports bra", "boxer shorts", "v-neck", "pyjamas"

Return ONLY JSON: {"normalized": "type"}`,
        },
        {
          role: "user",
          content: `Normalize: "${type}"`,
        },
      ],
      temperature: 0,
    });

    const result = JSON.parse(completion.choices[0].message.content);
    const normalized = result.normalized || normalizedLower;

    global.typeNormalizationCache.set(cacheKey, normalized);
    return normalized;
  } catch (error) {
    console.error(`⚠️ Type normalization failed:`, error.message);
    return normalizedLower
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }
}

// 🔥 LLM-POWERED TITLE NORMALIZATION - Cached to save API calls
async function normalizeTitleForDeduplication(title) {
  const cacheKey = `title_norm_${title.toLowerCase()}`;

  if (!global.titleNormalizationCache) {
    global.titleNormalizationCache = new Map();
  }

  if (global.titleNormalizationCache.has(cacheKey)) {
    return global.titleNormalizationCache.get(cacheKey);
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Extract CORE product name for duplicate detection.

Remove: sizes, colors, patterns, adjectives, materials (unless essential)
Keep: core type, essential descriptors (wide, slim, fitted)

Return JSON: {"core_name": "result"}

Examples:
"Wide trousers Black M" → {"core_name": "wide trousers"}
"Slim Fit Jeans Blue 32" → {"core_name": "slim fit jeans"}`,
        },
        {
          role: "user",
          content: `Extract core name: "${title}"`,
        },
      ],
      temperature: 0,
    });

    const result = JSON.parse(completion.choices[0].message.content);
    const normalized = result.core_name || title.toLowerCase();

    global.titleNormalizationCache.set(cacheKey, normalized);
    return normalized;
  } catch (error) {
    console.error(`⚠️ Title normalization failed:`, error.message);
    return title
      .toLowerCase()
      .replace(/\b(xs|s|m|l|xl|xxl|xxxl)\b/gi, "")
      .replace(/\b\d+y\b/gi, "")
      .replace(
        /\b(black|white|red|blue|green|yellow|pink|purple|gray|grey|beige|brown|navy)\b/gi,
        ""
      )
      .replace(/[^a-z0-9\s]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }
}

// 🔥 VALIDATE IMAGE URL
async function validateImageUrl(url) {
  if (!url || url.includes("placeholder")) return false;

  try {
    const response = await fetch(url, { method: "HEAD", timeout: 5000 });
    return response.ok;
  } catch (error) {
    return false;
  }
}

// 🔥 GENERATE PRODUCT KEY (for deduplication)
async function generateProductKey(title, category, brand) {
  const normalizedTitle = await normalizeTitleForDeduplication(title);
  return `${brand.toLowerCase()}_${normalizedTitle}_${category.toLowerCase()}`;
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
    });

    console.log(`✅ Parsed ${records.length} rows from CSV`);
    return records;
  } catch (error) {
    console.error(`❌ Failed to parse CSV: ${error.message}`);
    throw error;
  }
}

async function getEmbedding(text) {
  try {
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
      encoding_format: "float",
    });
    return response.data[0].embedding;
  } catch (error) {
    console.error("⚠️ OpenAI Embedding Error:", error.message);
    return null;
  }
}

// 🔥 AI-POWERED CATEGORY DETECTION
async function detectCategoryWithAI(title, description = "", csvCategory = "") {
  try {
    const completion = await openai.chat.completions.create({
      model: LLM_MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: CATEGORY_DETECTION_PROMPT },
        {
          role: "user",
          content: `Product title: "${title}"\nDescription: "${description.substring(
            0,
            200
          )}"\nCSV Category: "${csvCategory}"`,
        },
      ],
      temperature: 0,
    });

    const result = JSON.parse(completion.choices[0].message.content);
    return result.category || "ACCESSORIES";
  } catch (error) {
    console.error(`⚠️ Category detection failed:`, error.message);
    return "ACCESSORIES";
  }
}

// 🔥 AI-POWERED SPECS EXTRACTION
async function generateSpecsWithAI(title, description, csvRow) {
  let additionalContext = "";
  if (csvRow) {
    const relevantFields = [
      "color",
      "colour",
      "size",
      "gender",
      "material",
      "category",
      "CategoryName",
      "type",
      "style",
      "fit",
    ];

    for (const field of relevantFields) {
      const value =
        csvRow[field] ||
        csvRow[field.toLowerCase()] ||
        csvRow[field.toUpperCase()];
      if (value) {
        additionalContext += `${field}: ${value}\n`;
      }
    }
  }

  const userPrompt = `
Analyze this fashion product and generate the 'specs' JSON:

PRODUCT TITLE (TIER 1): "${title}"

PRODUCT DESCRIPTION (TIER 2): 
${description.substring(0, 800)}

ADDITIONAL CSV DATA (TIER 3):
${additionalContext}

CRITICAL: You MUST include a 'type' field that specifies the exact product type.
`;

  try {
    const completion = await openai.chat.completions.create({
      model: LLM_MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: FASHION_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0,
    });

    const specs = JSON.parse(completion.choices[0].message.content);

    if (specs.type) {
      const normalizedType = await normalizeProductType(specs.type);
      if (normalizedType) {
        specs.type = normalizedType;
      }
    } else {
      specs.type = "item";
    }

    return specs;
  } catch (error) {
    console.error(`⚠️ AI Specs Extraction Failed:`, error.message);
    return { type: "item" };
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
  let productUrl = (row.ProductURL || "").trim();
  if (productUrl) {
    const match = productUrl.match(/r=(https?:\/\/[^&]+)/);
    if (match) {
      productUrl = decodeURIComponent(match[1]);
    }
  }

  let imageUrl = (
    row.ProductImageMediumURL ||
    row.ProductImageLargeURL ||
    row.ProductImageSmallURL ||
    ""
  ).trim();
  if (!imageUrl) {
    imageUrl = "https://via.placeholder.com/600x800?text=No+Image";
  }

  const price = parseFloat((row.ProductPrice || "0").replace(/,/g, ""));
  const wasPrice = parseFloat((row.WasPrice || "0").replace(/,/g, ""));

  return {
    title: (row.ProductName || "").trim() || "Untitled Product",
    description: (row.ProductDescription || "").trim() || "",
    price: price,
    originalPrice: wasPrice > price ? wasPrice : price,
    imageUrl: imageUrl,
    productUrl: productUrl,
    sku: (row.ProductSKU || "").trim() || null,
    gtin: (row.GTIN || "").trim() || null,
    availability: (row.StockAvailability || "in stock").trim(),
    rawColor: (row.Colour || "").trim() || null,
    rawSize: (row.Size || "").trim() || null,
    rawGender: (row.Gender || "").trim() || null,
    rawCategory: (row.CategoryName || "").trim() || null,
    brand: (row.Brand || "H&M").trim(),
  };
}

function determineStockStatus(availabilityText) {
  if (!availabilityText) return StockStatus.IN_STOCK;

  const text = availabilityText.toLowerCase();

  if (
    text.includes("out of stock") ||
    text === "out_of_stock" ||
    text === "oos"
  ) {
    return StockStatus.OUT_OF_STOCK;
  }

  return StockStatus.IN_STOCK;
}

// -------------------------------------------------------------------
// --- MAIN IMPORTER LOGIC WITH CHECKPOINT ---
// -------------------------------------------------------------------

async function importHMProducts() {
  // 🔥 Load checkpoint
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

        // 🔥 SKIP if already processed (URL-based check)
        if (checkpoint.processedUrls.has(productData.productUrl)) {
          console.log(
            `[${index + 1}/${
              csvRows.length
            }] ⏭️  SKIP: Already processed - ${productData.title.substring(
              0,
              40
            )}...`
          );
          return;
        }

        console.log(
          `\n[${index + 1}/${
            csvRows.length
          }] 🔄 Processing: ${productData.title.substring(0, 60)}...`
        );

        // 🔥 IMAGE VALIDATION
        if (
          productData.imageUrl &&
          !productData.imageUrl.includes("placeholder")
        ) {
          console.log(`  🖼️ Validating image URL...`);
          const isValid = await validateImageUrl(productData.imageUrl);
          if (!isValid) {
            console.log(`  ❌ Invalid image - SKIPPING product`);
            skippedCount++;
            invalidImageCount++;

            // Mark as processed to avoid retrying
            checkpoint.processedUrls.add(productData.productUrl);
            checkpoint.processedCount++;
            return;
          }
          console.log(`  ✅ Image valid`);
        } else {
          console.log(`  ❌ No image - SKIPPING product`);
          skippedCount++;
          invalidImageCount++;

          checkpoint.processedUrls.add(productData.productUrl);
          checkpoint.processedCount++;
          return;
        }

        // AI category detection
        const category = await detectCategoryWithAI(
          productData.title,
          productData.description,
          productData.rawCategory
        );

        // AI specs extraction
        const specs = await generateSpecsWithAI(
          productData.title,
          productData.description,
          csvRow
        );

        // 🔥 DUPLICATE DETECTION
        const productKey = await generateProductKey(
          productData.title,
          category,
          productData.brand
        );

        if (checkpoint.processedProductKeys.has(productKey)) {
          console.log(
            `  ⚠️ DUPLICATE: Skipping (same product, different variant)`
          );
          duplicateCount++;

          checkpoint.processedUrls.add(productData.productUrl);
          checkpoint.processedCount++;
          return;
        }

        checkpoint.processedProductKeys.add(productKey);

        // Generate embedding
        const searchKey = generateCascadingContext(
          productData.title,
          productData.brand,
          specs,
          productData.price,
          productData.description
        );
        const vector = await getEmbedding(searchKey);

        const stock = determineStockStatus(productData.availability);

        const upsertData = {
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
        };

        // Check if exists
        const existing = await prisma.product.findUnique({
          where: {
            storeName_productUrl: {
              storeName: STORE_NAME_FIXED,
              productUrl: productData.productUrl,
            },
          },
          select: { id: true, createdAt: true },
        });

        let record;
        if (existing) {
          record = await prisma.product.update({
            where: { id: existing.id },
            data: upsertData,
            select: { id: true, title: true },
          });
          updatedCount++;
          console.log(`  🔄 Updated: ${record.title.substring(0, 50)}...`);
        } else {
          record = await prisma.product.create({
            data: {
              ...upsertData,
              storeName: STORE_NAME_FIXED,
              productUrl: productData.productUrl,
              scrapedAt: new Date(),
            },
            select: { id: true, title: true },
          });
          createdCount++;
          console.log(`  ✅ Created: ${record.title.substring(0, 50)}...`);
        }

        // Update vector
        if (vector) {
          const vectorString = `[${vector.join(",")}]`;
          await prisma.$executeRaw`UPDATE "Product" SET "descriptionEmbedding" = ${vectorString}::vector WHERE id = ${record.id}`;
        }

        // 🔥 Mark as processed
        checkpoint.processedUrls.add(productData.productUrl);
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

        // 🔥 Save checkpoint periodically
        if (checkpoint.processedCount % CHECKPOINT_SAVE_INTERVAL === 0) {
          await saveCheckpoint(checkpoint);
        }
      } catch (error) {
        errorCount++;
        console.error(`  ❌ Error: ${error.message}`);

        // Still mark as processed to avoid infinite retry
        checkpoint.processedUrls.add(productData.productUrl);
        checkpoint.processedCount++;
      }
    };

    // Process in batches
    for (let i = 0; i < csvRows.length; i += CONCURRENT_LIMIT) {
      const batch = csvRows.slice(i, i + CONCURRENT_LIMIT);
      const batchNumber = Math.ceil((i + 1) / CONCURRENT_LIMIT);
      const totalBatches = Math.ceil(csvRows.length / CONCURRENT_LIMIT);

      console.log(`\n🔄 Batch ${batchNumber}/${totalBatches}`);

      await Promise.all(batch.map((row, idx) => processProduct(row, i + idx)));

      if (i + CONCURRENT_LIMIT < csvRows.length) {
        await sleep(1000);
      }
    }

    // 🔥 Final checkpoint save
    await saveCheckpoint(checkpoint);

    // 🔥 Clear checkpoint after successful completion
    await clearCheckpoint();
  } catch (error) {
    console.error(`\n❌ Fatal error: ${error.message}`);
    console.log(
      `💾 Checkpoint saved - you can resume by running the script again`
    );
    await saveCheckpoint(checkpoint);
    throw error;
  } finally {
    await prisma.$disconnect();
  }

  // Print summary
  console.log(`\n${"=".repeat(60)}`);
  console.log(`🎉 H&M IMPORT COMPLETE`);
  console.log(`${"=".repeat(60)}`);
  console.log(`✅ Created: ${createdCount}`);
  console.log(`🔄 Updated: ${updatedCount}`);
  console.log(`⚠️ Skipped: ${skippedCount}`);
  console.log(`🔁 Duplicates: ${duplicateCount}`);
  console.log(`🖼️  Invalid Images: ${invalidImageCount}`);
  console.log(`❌ Errors: ${errorCount}`);
  console.log(
    `📊 Total Processed: ${
      createdCount + updatedCount + skippedCount + duplicateCount + errorCount
    }`
  );
  console.log(`${"=".repeat(60)}\n`);
}

// -------------------------------------------------------------------
// --- EXECUTE ---
// -------------------------------------------------------------------

importHMProducts()
  .then(() => {
    console.log("✅ Script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Script failed:", error);
    console.log("\n💡 TIP: Run the script again to resume from checkpoint!");
    process.exit(1);
  });
