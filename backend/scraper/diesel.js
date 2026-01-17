// diesel_optimized.js - High-Performance Diesel CSV Importer with Variant Aggregation
// Optimized with Bershka-style batch processing
// Processing speed: ~100+ products/minute
//
// KEY FEATURES:
// ✅ Aggregates variants (same product, different colors/sizes) into single entry
// ✅ Skips products with invalid images, missing title/URL
// ✅ Batch AI processing (multiple products at once)
// ✅ Persistent cache for AI extractions
// ✅ Checkpoint system for resume capability
// ✅ Stores all colors/sizes in specs JSON: {"color": "brown,red,green", "available_sizes": "S,M,L,XL"}

import fetch from "node-fetch";
import { parse } from "csv-parse/sync";
import { PrismaClient, StockStatus } from "@prisma/client";
import OpenAI from "openai";
import fs from "fs/promises";
import pLimit from "p-limit";
import sharp from "sharp";

// --- GLOBAL CONFIGURATION ---
const prisma = new PrismaClient();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const CSV_URL =
  "http://export.admitad.com/en/webmaster/websites/2896510/products/export_adv_products/?user=mishaal_alotaibi2ae7a&code=mx60od1chh&feed_id=21862&format=csv";

const STORE_NAME = "DIESEL";
const CURRENCY = "KWD";

// --- BATCH PROCESSING CONFIGURATION ---
const AI_BATCH_SIZE = 10; // Process 10 products through AI at once
const CONCURRENT_LIMIT = 5; // Download/validate 5 images concurrently
const BATCH_DELAY_MS = 2000; // 2s delay between AI batches
const LLM_MODEL = "gpt-4o-mini";
const DEEPFASHION_BATCH_SIZE = 24; // DeepFashion batch size (for color extraction)
const DEEPFASHION_API_URL = process.env.RUNPOD_API_URL; // Your RunPod endpoint

// --- CHECKPOINT & CACHE FILES ---
const CHECKPOINT_FILE = "./diesel_import_checkpoint.json";
const CACHE_FILE = "./diesel_import_cache.json";
const CHECKPOINT_SAVE_INTERVAL = 5; // Save every 5 products

// --- CSV FIELD MAPPING ---
const FIELD_MAPPING = {
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
  param: "param", // Contains: size:36|gender:male
  season: "season",
};

// --- RATE LIMITER TRACKING ---
const rateLimiter = {
  requestCount: 0,
  dailyRequestCount: 0,
  lastResetTime: Date.now(),
  consecutiveErrors: 0,
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// CACHE & CHECKPOINT SYSTEM
// ============================================================================

let persistentCache = { categoryDetection: {}, productVariants: {} };

async function loadCache() {
  try {
    const data = await fs.readFile(CACHE_FILE, "utf-8");
    persistentCache = JSON.parse(data);
    console.log(
      `💾 Loaded cache: ${
        Object.keys(persistentCache.categoryDetection || {}).length
      } AI extractions, ${
        Object.keys(persistentCache.productVariants || {}).length
      } product variants`
    );
  } catch (error) {
    console.log(`💾 No cache found - starting fresh`);
    persistentCache = { categoryDetection: {}, productVariants: {} };
  }
}

async function saveCache() {
  try {
    await fs.writeFile(CACHE_FILE, JSON.stringify(persistentCache, null, 2));
  } catch (error) {
    console.error(`   ⚠️ Failed to save cache: ${error.message}`);
  }
}

async function loadCheckpoint() {
  try {
    const data = await fs.readFile(CHECKPOINT_FILE, "utf-8");
    const checkpoint = JSON.parse(data);
    console.log(
      `\n📍 CHECKPOINT: Processed ${checkpoint.processedCount} | Created ${checkpoint.stats.created}\n`
    );
    if (checkpoint.apiCalls)
      rateLimiter.dailyRequestCount = checkpoint.apiCalls;
    return {
      processedProductKeys: new Set(checkpoint.processedProductKeys || []),
      processedCount: checkpoint.processedCount,
      stats: checkpoint.stats,
      apiCalls: checkpoint.apiCalls || 0,
    };
  } catch (error) {
    console.log(`\n📍 No checkpoint - starting fresh\n`);
    return {
      processedProductKeys: new Set(),
      processedCount: 0,
      stats: {
        created: 0,
        updated: 0,
        skipped: 0,
        invalidImages: 0,
        missingData: 0,
        variants: 0,
        errors: 0,
      },
      apiCalls: 0,
    };
  }
}

async function saveCheckpoint(checkpoint) {
  try {
    await fs.writeFile(
      CHECKPOINT_FILE,
      JSON.stringify(
        {
          processedProductKeys: Array.from(checkpoint.processedProductKeys),
          processedCount: checkpoint.processedCount,
          stats: checkpoint.stats,
          apiCalls: rateLimiter.dailyRequestCount,
          timestamp: new Date().toISOString(),
        },
        null,
        2
      )
    );
    await saveCache();
  } catch (error) {
    console.error(`   ⚠️ Failed to save checkpoint: ${error.message}`);
  }
}

// ============================================================================
// IMAGE VALIDATION (Batch)
// ============================================================================

async function validateImageUrlsBatch(urls) {
  const limit = pLimit(CONCURRENT_LIMIT);

  const results = await Promise.all(
    urls.map((url, index) =>
      limit(async () => {
        if (!url || url.includes("placeholder")) {
          return { index, valid: false, url };
        }

        try {
          const response = await fetch(url, {
            method: "HEAD",
            timeout: 5000,
          });
          return { index, valid: response.ok, url };
        } catch (error) {
          return { index, valid: false, url };
        }
      })
    )
  );

  return results;
}

// ============================================================================
// DEEPFASHION - BATCH IMAGE DOWNLOAD & COLOR EXTRACTION
// ============================================================================

async function downloadImagesInBatch(imageUrls) {
  console.log(`     📥 Downloading ${imageUrls.length} images in parallel...`);

  const limit = pLimit(CONCURRENT_LIMIT);
  const startTime = Date.now();

  const promises = imageUrls.map((url, index) =>
    limit(async () => {
      try {
        const response = await fetch(url);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Resize image to 224x224 before base64 encoding (200x size reduction!)
        const resizedBuffer = await sharp(buffer)
          .resize(224, 224, {
            fit: "cover",
            position: "center",
          })
          .jpeg({ quality: 85 })
          .toBuffer();

        const base64 = resizedBuffer.toString("base64");

        return {
          index,
          success: true,
          url,
          base64,
          size: resizedBuffer.length,
          originalSize: buffer.length,
        };
      } catch (error) {
        console.error(`        ❌ Image ${index + 1} failed: ${error.message}`);
        return {
          index,
          success: false,
          url,
          error: error.message,
        };
      }
    })
  );

  const results = await Promise.all(promises);
  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  const totalSize = successful.reduce((sum, r) => sum + (r.size || 0), 0);
  const originalTotalSize = successful.reduce(
    (sum, r) => sum + (r.originalSize || 0),
    0
  );
  const compressionRatio =
    originalTotalSize > 0
      ? ((1 - totalSize / originalTotalSize) * 100).toFixed(1)
      : 0;

  console.log(
    `     ✅ Downloaded & resized ${successful.length}/${results.length} images in ${duration}s`
  );
  console.log(
    `     📊 Size: ${(originalTotalSize / 1024 / 1024).toFixed(1)}MB → ${(
      totalSize / 1024
    ).toFixed(1)}KB (${compressionRatio}% reduction)`
  );

  if (failed.length > 0) {
    console.log(`     ⚠️  ${failed.length} images failed to download`);
  }

  return results;
}

async function extractColorFromImageBatch(imageDataList) {
  console.log(
    `\n     🎨 [DEEPFASHION] Extracting colors from ${imageDataList.length} images...`
  );

  if (!DEEPFASHION_API_URL) {
    console.log(`     ⚠️  DeepFashion API URL not configured - skipping`);
    return imageDataList.map(() => ({ success: false, color: null }));
  }

  try {
    const startTime = Date.now();

    const requestBody = {
      input: {
        images: imageDataList.map((item, index) => ({
          data: item.base64,
          id: item.id || `image_${index}`,
        })),
      },
    };

    // Detect if using async endpoint (/run) or sync (/runsync)
    const isAsync =
      DEEPFASHION_API_URL.includes("/run") &&
      !DEEPFASHION_API_URL.includes("/runsync");

    console.log(
      `     📡 Submitting job to RunPod (${isAsync ? "async" : "sync"})...`
    );

    const response = await fetch(DEEPFASHION_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.RUNPOD_API_KEY}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new Error(`RunPod API error: ${response.status}`);
    }

    const data = await response.json();

    // Handle async endpoint (requires polling)
    if (isAsync && data.id && data.status === "IN_QUEUE") {
      const jobId = data.id;
      console.log(`     🔄 Job submitted: ${jobId}`);
      console.log(`     ⏳ Polling for results...`);

      const baseUrl = DEEPFASHION_API_URL.replace("/run", "");
      const statusUrl = `${baseUrl}/status/${jobId}`;

      let attempts = 0;
      const maxAttempts = 60;
      let output = null;

      while (attempts < maxAttempts) {
        await sleep(2000);
        attempts++;

        const statusResponse = await fetch(statusUrl, {
          headers: {
            Authorization: `Bearer ${process.env.RUNPOD_API_KEY}`,
          },
        });

        if (!statusResponse.ok) {
          throw new Error(`Status check failed: ${statusResponse.status}`);
        }

        const statusData = await statusResponse.json();

        if (statusData.status === "COMPLETED") {
          output = statusData.output;
          console.log(`     ✅ Job completed after ${attempts * 2}s`);
          break;
        } else if (statusData.status === "FAILED") {
          throw new Error(`Job failed: ${statusData.error || "Unknown error"}`);
        }

        if (attempts % 5 === 0) {
          console.log(`     ⏳ Still processing... (${attempts * 2}s elapsed)`);
        }
      }

      if (!output) {
        throw new Error("Job timed out after 2 minutes");
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);

      if (!output.results) {
        throw new Error("Invalid response format from RunPod");
      }

      console.log(
        `     ✅ Batch completed in ${duration}s (${output.stats?.images_per_second?.toFixed(
          1
        )} images/sec)`
      );

      const sampleResult = output.results.find((r) => r.success);
      if (sampleResult) {
        console.log(`     📊 Sample color: ${sampleResult.attributes.color}`);
      }

      return imageDataList.map((item, index) => {
        const result = output.results[index];

        if (result && result.success && result.attributes.color) {
          return {
            success: true,
            color: result.attributes.color.toLowerCase(),
          };
        } else {
          return {
            success: false,
            color: null,
            error: result?.error || "Unknown error",
          };
        }
      });
    } else {
      // Handle sync endpoint
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      const output = data.output || data;

      if (!output.results) {
        throw new Error("Invalid response format from RunPod");
      }

      console.log(
        `     ✅ Batch completed in ${duration}s (${output.stats?.images_per_second?.toFixed(
          1
        )} images/sec)`
      );

      const sampleResult = output.results.find((r) => r.success);
      if (sampleResult) {
        console.log(`     📊 Sample color: ${sampleResult.attributes.color}`);
      }

      return imageDataList.map((item, index) => {
        const result = output.results[index];

        if (result && result.success && result.attributes.color) {
          return {
            success: true,
            color: result.attributes.color.toLowerCase(),
          };
        } else {
          return {
            success: false,
            color: null,
            error: result?.error || "Unknown error",
          };
        }
      });
    }
  } catch (error) {
    console.error(`     ❌ DeepFashion batch failed: ${error.message}`);
    return imageDataList.map(() => ({
      success: false,
      color: null,
      error: error.message,
    }));
  }
}

async function processProductsWithDeepFashion(products) {
  console.log(
    `\n🎨 Processing ${products.length} CLOTHING products for color extraction...`
  );

  const results = [];

  for (let i = 0; i < products.length; i += DEEPFASHION_BATCH_SIZE) {
    const batch = products.slice(i, i + DEEPFASHION_BATCH_SIZE);
    const batchNum = Math.floor(i / DEEPFASHION_BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(products.length / DEEPFASHION_BATCH_SIZE);

    console.log(
      `\n📦 [DEEPFASHION BATCH ${batchNum}/${totalBatches}] Processing ${batch.length} products...`
    );

    const imageUrls = batch.map((p) => p.imageUrl);
    const downloadResults = await downloadImagesInBatch(imageUrls);

    const successfulDownloads = downloadResults
      .filter((r) => r.success)
      .map((r) => ({
        base64: r.base64,
        id: `product_${i + r.index}`,
        productIndex: r.index,
      }));

    if (successfulDownloads.length === 0) {
      console.log(`     ⚠️  No images downloaded successfully in this batch`);
      results.push(...batch.map(() => ({ success: false, color: null })));
      continue;
    }

    const colorResults = await extractColorFromImageBatch(successfulDownloads);

    for (let j = 0; j < batch.length; j++) {
      const downloadResult = downloadResults[j];

      if (!downloadResult.success) {
        results.push({
          product: batch[j],
          deepFashionColor: null,
        });
        continue;
      }

      const colorResult =
        colorResults[
          successfulDownloads.findIndex((d) => d.productIndex === j)
        ];

      results.push({
        product: batch[j],
        deepFashionColor: colorResult.success ? colorResult.color : null,
      });
    }

    if (i + DEEPFASHION_BATCH_SIZE < products.length) {
      console.log(`     ⏳ Waiting ${BATCH_DELAY_MS}ms before next batch...`);
      await sleep(BATCH_DELAY_MS);
    }
  }

  return results;
}

// ============================================================================
// CSV PARSING & DATA EXTRACTION
// ============================================================================

async function downloadCSV(url) {
  console.log(`📥 Downloading CSV...`);

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
    console.log(`✅ CSV downloaded (${csvText.length} bytes)`);

    return csvText;
  } catch (error) {
    console.error(`❌ Failed to download CSV: ${error.message}`);
    throw error;
  }
}

function parseCSV(csvText) {
  console.log(`📊 Parsing CSV...`);

  try {
    const records = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      bom: true,
      delimiter: ";",
    });

    console.log(`✅ Parsed ${records.length} rows`);
    return records;
  } catch (error) {
    console.error(`❌ Failed to parse CSV: ${error.message}`);
    throw error;
  }
}

function parseParams(paramStr) {
  const params = {};
  if (!paramStr) return params;

  const pairs = paramStr.split("|");
  pairs.forEach((pair) => {
    const [key, value] = pair.split(":");
    if (key && value) {
      params[key.trim().toLowerCase()] = value.trim();
    }
  });

  return params;
}

function mapCSVRowToProduct(row) {
  // Clean URL (remove affiliate tracking)
  let productUrl = (row[FIELD_MAPPING.productUrl] || "").trim();
  let cleanUrl = productUrl;

  if (productUrl.includes("ulp=")) {
    try {
      const ulpMatch = productUrl.match(/ulp=([^&]+)/);
      if (ulpMatch) {
        let dieselUrl = decodeURIComponent(ulpMatch[1]);
        if (dieselUrl.includes("%")) {
          dieselUrl = decodeURIComponent(dieselUrl);
        }
        cleanUrl = dieselUrl.split("?")[0];
      }
    } catch (e) {
      cleanUrl = productUrl.split("?")[0];
    }
  } else if (productUrl.includes("?")) {
    cleanUrl = productUrl.split("?")[0];
  }

  // Parse prices
  const priceStr = (row[FIELD_MAPPING.price] || "0").trim();
  const price = parseFloat(priceStr.replace(/[^0-9.]/g, ""));

  const oldPriceStr = (row[FIELD_MAPPING.oldPrice] || "0").trim();
  const oldPrice = oldPriceStr
    ? parseFloat(oldPriceStr.replace(/[^0-9.]/g, ""))
    : 0;

  // Parse availability
  const availabilityStr = (row[FIELD_MAPPING.availability] || "true")
    .toString()
    .toLowerCase()
    .trim();
  const isAvailable =
    availabilityStr === "true" ||
    availabilityStr === "1" ||
    availabilityStr === "yes";

  // Parse param field (size:36|gender:male)
  const params = parseParams(row[FIELD_MAPPING.param]);

  return {
    title: (row[FIELD_MAPPING.title] || "").trim(),
    description: (row[FIELD_MAPPING.description] || "").trim(),
    price: price,
    originalPrice: oldPrice > price ? oldPrice : price,
    imageUrl: (row[FIELD_MAPPING.imageUrl] || "").trim(),
    productUrl: productUrl,
    cleanUrl: cleanUrl,
    sku: (row[FIELD_MAPPING.sku] || "").trim(),
    availability: isAvailable ? "in stock" : "out of stock",
    rawCategory: (row[FIELD_MAPPING.category] || "").trim(),
    brand: (row[FIELD_MAPPING.brand] || "DIESEL").trim(),
    currency: (row[FIELD_MAPPING.currency] || CURRENCY).trim(),
    season: (row[FIELD_MAPPING.season] || "").trim(),
    size: params.size || null,
    gender: params.gender || null,
  };
}

// ============================================================================
// VARIANT AGGREGATION
// ============================================================================

function normalizeTitle(title) {
  // Remove sizes, colors, and common variants
  return title
    .toLowerCase()
    .replace(/\b(xs|s|m|l|xl|xxl|xxxl|2xl|3xl)\b/gi, "")
    .replace(/\b(28|30|32|34|36|38|40|42|44|46|48)\b/gi, "")
    .replace(
      /\b(black|white|red|blue|green|gray|grey|navy|denim|indigo|brown|beige)\b/gi,
      ""
    )
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function aggregateVariants(products) {
  console.log(`\n🔄 Aggregating variants from ${products.length} products...`);

  const variantMap = new Map();

  for (const product of products) {
    const normalizedTitle = normalizeTitle(product.title);
    const key = `${product.brand.toLowerCase()}_${normalizedTitle}`;

    if (!variantMap.has(key)) {
      variantMap.set(key, {
        baseProduct: product,
        colors: new Set(),
        sizes: new Set(),
        skus: new Set(),
        prices: [],
        variants: [],
      });
    }

    const variant = variantMap.get(key);

    // Aggregate colors (extract from title/description)
    const colorMatch = product.title.match(
      /\b(black|white|red|blue|green|gray|grey|navy|denim|indigo|brown|beige|pink|yellow|orange|purple)\b/i
    );
    if (colorMatch) {
      variant.colors.add(colorMatch[1].toLowerCase());
    }

    // Aggregate sizes
    if (product.size) {
      variant.sizes.add(product.size);
    }

    // Aggregate SKUs
    if (product.sku) {
      variant.skus.add(product.sku);
    }

    // Track prices (use lowest)
    variant.prices.push(product.price);

    // Store variant info
    variant.variants.push({
      sku: product.sku,
      size: product.size,
      color: colorMatch ? colorMatch[1].toLowerCase() : null,
      price: product.price,
    });
  }

  // Convert Map to array of aggregated products
  const aggregated = Array.from(variantMap.values()).map((variant) => {
    const baseProduct = variant.baseProduct;

    return {
      ...baseProduct,
      aggregatedColors: Array.from(variant.colors).join(","),
      aggregatedSizes: Array.from(variant.sizes).join(", "),
      aggregatedSkus: Array.from(variant.skus).join(","),
      lowestPrice: Math.min(...variant.prices),
      variantCount: variant.variants.length,
      variants: variant.variants,
    };
  });

  console.log(
    `✅ Aggregated ${products.length} products into ${aggregated.length} unique products`
  );
  console.log(`   Variants collapsed: ${products.length - aggregated.length}`);

  return aggregated;
}

// ============================================================================
// AI EXTRACTION (Batch)
// ============================================================================

const EXTRACTION_PROMPT = `You are a Fashion Data Extraction AI for Diesel products.

OUTPUT:
{
  "category": "CLOTHING|FOOTWEAR|ACCESSORIES",
  "specs": {
    "type": "product type (MANDATORY - guess from title)",
    "fit": "slim fit|regular fit|relaxed fit|etc",
    "rise": "low rise|mid rise|high rise",
    "material": "denim|cotton|leather|etc",
    "pattern": "solid|distressed|faded|etc",
    "wash": "light wash|dark wash|black wash|etc (for denim)",
    "style": "casual|formal|streetwear|etc"
  }
}

RULES: 
- ALL lowercase
- Extract gender from context if available
- Return ONLY valid JSON
- Type examples: jeans, joggjeans, t-shirt, hoodie, jacket, sneakers, boots, bag, belt`;

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
        error.status === 429 || error.message?.includes("429");
      if (isRateLimit) {
        rateLimiter.consecutiveErrors++;
        const waitTime = Math.pow(2, attempt) * 2000 + Math.random() * 1000;
        console.warn(
          `   ⚠️ Rate limit - waiting ${(waitTime / 1000).toFixed(1)}s...`
        );
        await sleep(waitTime);
        if (attempt === maxRetries - 1) throw error;
        continue;
      }
      throw error;
    }
  }
}

async function extractProductSpecsBatch(products) {
  console.log(`\n     🤖 [AI BATCH] Analyzing ${products.length} products...`);

  const startTime = Date.now();
  const results = [];

  // Check cache first
  const uncachedProducts = [];
  const uncachedIndices = [];

  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    const cacheKey = product.title.toLowerCase().substring(0, 80);

    if (persistentCache.categoryDetection[cacheKey]) {
      results[i] = persistentCache.categoryDetection[cacheKey];
    } else {
      uncachedProducts.push(product);
      uncachedIndices.push(i);
    }
  }

  if (uncachedProducts.length === 0) {
    console.log(`     💾 All ${products.length} from cache`);
    return results;
  }

  console.log(
    `     💾 Using cache for ${
      products.length - uncachedProducts.length
    }, extracting ${uncachedProducts.length}`
  );

  // Process uncached products in smaller batches if needed
  const OPENAI_BATCH_SIZE = 5; // OpenAI works better with smaller batches

  for (let i = 0; i < uncachedProducts.length; i += OPENAI_BATCH_SIZE) {
    const batch = uncachedProducts.slice(i, i + OPENAI_BATCH_SIZE);

    try {
      const batchPromises = batch.map((product) =>
        callOpenAIWithRetry(
          async () => {
            const completion = await openai.chat.completions.create({
              model: LLM_MODEL,
              response_format: { type: "json_object" },
              messages: [
                { role: "system", content: EXTRACTION_PROMPT },
                {
                  role: "user",
                  content: `TITLE: "${
                    product.title
                  }"\nDESCRIPTION: "${product.description.substring(
                    0,
                    400
                  )}"\nGENDER: ${product.gender || "unknown"}\nSEASON: ${
                    product.season || "unknown"
                  }`,
                },
              ],
              temperature: 0,
            });
            return JSON.parse(completion.choices[0].message.content);
          },
          5,
          "Batch specs"
        )
      );

      const batchResults = await Promise.all(batchPromises);

      // Process results
      for (let j = 0; j < batch.length; j++) {
        const globalIndex = i + j;
        const product = batch[j];
        const result = batchResults[j];

        const extracted = {
          category: (result.category || "CLOTHING").toUpperCase(),
          specs: result.specs || {},
        };

        // Add gender if not present
        if (product.gender && !extracted.specs.gender) {
          const genderMap = {
            male: "men",
            female: "women",
            unisex: "unisex",
          };
          extracted.specs.gender =
            genderMap[product.gender.toLowerCase()] ||
            product.gender.toLowerCase();
        }

        // Add SKU, season from CSV
        if (product.sku) extracted.specs.sku = product.sku;
        if (product.season) extracted.specs.season = product.season;

        // Cache result
        const cacheKey = product.title.toLowerCase().substring(0, 80);
        persistentCache.categoryDetection[cacheKey] = extracted;

        // Store in results array at correct position
        const originalIndex = uncachedIndices[globalIndex];
        results[originalIndex] = extracted;
      }
    } catch (error) {
      console.error(`     ❌ Batch AI failed: ${error.message}`);

      // Fallback for failed batch
      for (let j = 0; j < batch.length; j++) {
        const globalIndex = i + j;
        const originalIndex = uncachedIndices[globalIndex];
        const product = batch[j];

        results[originalIndex] = {
          category: "CLOTHING",
          specs: {
            type: guessTypeFromTitle(product.title),
            gender: product.gender || "unisex",
          },
        };
      }
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`     ✅ Batch completed in ${duration}s`);

  return results;
}

function guessTypeFromTitle(title) {
  const lower = title.toLowerCase();

  if (lower.includes("joggjeans")) return "joggjeans";
  if (lower.includes("jeans")) return "jeans";
  if (lower.includes("t-shirt") || lower.includes("tee")) return "t-shirt";
  if (lower.includes("hoodie")) return "hoodie";
  if (lower.includes("sweater")) return "sweater";
  if (lower.includes("jacket")) return "jacket";
  if (lower.includes("shirt")) return "shirt";
  if (lower.includes("shorts")) return "shorts";
  if (lower.includes("pants")) return "pants";
  if (lower.includes("sneaker")) return "sneakers";
  if (lower.includes("boot")) return "boots";
  if (lower.includes("shoe")) return "shoes";
  if (lower.includes("bag")) return "bag";
  if (lower.includes("belt")) return "belt";

  return "clothing item";
}

// ============================================================================
// EMBEDDING GENERATION
// ============================================================================

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
    console.error("⚠️ Embedding Error:", error.message);
    return null;
  }
}

function generateSearchContext(title, brand, specs, price, description) {
  let context = `${brand} ${title}.`;

  const specString = Object.entries(specs)
    .filter(([k, v]) => v && !["sku", "season"].includes(k))
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");

  if (specString) context += ` Specs: ${specString}.`;
  context += ` Price: ${price} ${CURRENCY}.`;

  if (description && description.length > 20) {
    const cleanDesc = description.substring(0, 200).replace(/\s+/g, " ").trim();
    context += ` ${cleanDesc}`;
  }

  return context;
}

// ============================================================================
// MAIN IMPORTER
// ============================================================================

async function importDieselProducts() {
  await loadCache();
  const checkpoint = await loadCheckpoint();
  let stats = { ...checkpoint.stats };

  console.log(`\n${"=".repeat(70)}`);
  console.log(`🏪 DIESEL CSV IMPORTER - OPTIMIZED WITH VARIANT AGGREGATION`);
  console.log(`${"=".repeat(70)}`);
  console.log(`   Store: ${STORE_NAME}`);
  console.log(`   Currency: ${CURRENCY}`);
  console.log(`   AI Batch Size: ${AI_BATCH_SIZE}`);
  console.log(`   Concurrent Validations: ${CONCURRENT_LIMIT}`);
  console.log(`${"=".repeat(70)}\n`);

  try {
    // Download and parse CSV
    const csvText = await downloadCSV(CSV_URL);
    const csvRows = parseCSV(csvText);

    if (csvRows.length === 0) {
      console.log("⚠️ No products found in CSV");
      return;
    }

    console.log(`\n📊 Processing ${csvRows.length} CSV rows...\n`);

    // Step 1: Map CSV rows to product objects
    console.log(`🔄 [Step 1/6] Mapping CSV data...`);
    const allProducts = csvRows.map(mapCSVRowToProduct);

    // Step 2: Filter out products with missing data
    console.log(`🔄 [Step 2/6] Filtering products with missing data...`);
    const validProducts = allProducts.filter((p) => {
      if (!p.title) {
        stats.missingData++;
        return false;
      }
      if (!p.productUrl) {
        stats.missingData++;
        return false;
      }
      if (!p.imageUrl || p.imageUrl.includes("placeholder")) {
        stats.invalidImages++;
        return false;
      }
      return true;
    });

    console.log(
      `   ✅ ${validProducts.length} valid, ${stats.missingData} missing data, ${stats.invalidImages} invalid images`
    );

    // Step 3: Validate images in batch
    console.log(
      `🔄 [Step 3/6] Validating ${validProducts.length} image URLs...`
    );
    const imageUrls = validProducts.map((p) => p.imageUrl);
    const imageValidations = await validateImageUrlsBatch(imageUrls);

    const productsWithValidImages = validProducts.filter((p, index) => {
      const validation = imageValidations[index];
      if (!validation.valid) {
        stats.invalidImages++;
        return false;
      }
      return true;
    });

    console.log(
      `   ✅ ${productsWithValidImages.length} valid images, ${
        validProducts.length - productsWithValidImages.length
      } invalid`
    );

    if (productsWithValidImages.length === 0) {
      console.log("⚠️ No products with valid images");
      return;
    }

    // Step 4: Aggregate variants
    console.log(`🔄 [Step 4/6] Aggregating product variants...`);
    const aggregatedProducts = aggregateVariants(productsWithValidImages);
    stats.variants = productsWithValidImages.length - aggregatedProducts.length;

    // Step 5: Process products in batches through AI
    console.log(
      `🔄 [Step 5/6] Processing ${aggregatedProducts.length} products through AI...`
    );

    for (let i = 0; i < aggregatedProducts.length; i += AI_BATCH_SIZE) {
      const batch = aggregatedProducts.slice(i, i + AI_BATCH_SIZE);
      const batchNum = Math.floor(i / AI_BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(aggregatedProducts.length / AI_BATCH_SIZE);

      console.log(
        `\n📦 [BATCH ${batchNum}/${totalBatches}] Processing ${batch.length} products (API calls: ${rateLimiter.dailyRequestCount})`
      );

      // Extract specs for entire batch
      const extractedBatch = await extractProductSpecsBatch(batch);

      // Filter products: Skip FOOTWEAR and ACCESSORIES
      const clothingProducts = [];
      const clothingIndices = [];
      const skippedCategories = [];

      for (let j = 0; j < batch.length; j++) {
        const extracted = extractedBatch[j];
        if (extracted.category === "CLOTHING") {
          clothingProducts.push(batch[j]);
          clothingIndices.push(j);
        } else {
          skippedCategories.push({
            index: j,
            product: batch[j],
            category: extracted.category,
          });
          stats.skipped++;
        }
      }

      // Log skipped products
      if (skippedCategories.length > 0) {
        console.log(
          `     ⏭️  Skipping ${skippedCategories.length} non-CLOTHING products:`
        );
        skippedCategories.forEach((item) => {
          console.log(
            `        - ${item.product.title.substring(0, 40)}... (${
              item.category
            })`
          );
        });
      }

      // Process DeepFashion color extraction for CLOTHING products only
      let deepFashionResults = [];
      if (clothingProducts.length > 0) {
        console.log(
          `\n     🎨 Processing ${clothingProducts.length} CLOTHING products for color extraction...`
        );
        deepFashionResults = await processProductsWithDeepFashion(
          clothingProducts
        );
      }

      // Step 6: Save CLOTHING products to database
      if (clothingProducts.length > 0) {
        console.log(
          `     💾 Saving ${clothingProducts.length} CLOTHING products to database...`
        );

        for (let j = 0; j < clothingProducts.length; j++) {
          const product = clothingProducts[j];
          const originalIndex = clothingIndices[j];
          const extracted = extractedBatch[originalIndex];
          const deepFashionColor = deepFashionResults[j]?.deepFashionColor;

          try {
            const normalizedTitle = normalizeTitle(product.title);
            const productKey = `${product.brand.toLowerCase()}_${normalizedTitle}`;

            // Check if already processed
            if (checkpoint.processedProductKeys.has(productKey)) {
              console.log(
                `     [${i + originalIndex + 1}/${
                  aggregatedProducts.length
                }] ⏩ Already processed`
              );
              stats.skipped++;
              continue;
            }

            // Check if exists in database
            const existing = await prisma.product.findFirst({
              where: {
                storeName: STORE_NAME,
                title: product.title,
              },
              select: { id: true },
            });

            if (existing) {
              console.log(
                `     [${i + originalIndex + 1}/${
                  aggregatedProducts.length
                }] ⏩ In database`
              );
              stats.skipped++;
              checkpoint.processedProductKeys.add(productKey);
              continue;
            }

            // Merge specs with aggregated colors/sizes
            const finalSpecs = {
              ...extracted.specs,
              available_sizes: product.aggregatedSizes || "",
            };

            // Use DeepFashion color if available, otherwise use aggregated colors
            if (deepFashionColor) {
              finalSpecs.color = deepFashionColor;
              console.log(
                `     🎨 DeepFashion color: ${deepFashionColor} (overriding aggregated)`
              );
            } else if (product.aggregatedColors) {
              finalSpecs.color = product.aggregatedColors;
            }

            // Generate embedding
            const searchKey = generateSearchContext(
              product.title,
              product.brand,
              finalSpecs,
              product.lowestPrice,
              product.description
            );
            const vector = await getEmbedding(searchKey);

            // Create product
            const record = await prisma.product.create({
              data: {
                title: product.title,
                description: product.description,
                category: extracted.category,
                price: product.lowestPrice,
                imageUrl: product.imageUrl,
                stock:
                  product.availability === "in stock"
                    ? StockStatus.IN_STOCK
                    : StockStatus.OUT_OF_STOCK,
                lastSeenAt: new Date(),
                brand: product.brand,
                specs: finalSpecs,
                searchKey: searchKey,
                storeName: STORE_NAME,
                productUrl: product.productUrl,
                scrapedAt: new Date(),
              },
              select: { id: true, title: true },
            });

            stats.created++;
            console.log(
              `     ✅ [${i + originalIndex + 1}/${
                aggregatedProducts.length
              }] Created: ${record.title.substring(0, 40)}... (${
                product.variantCount
              } variants)`
            );

            // Update embedding
            if (vector) {
              const vectorString = `[${vector.join(",")}]`;
              await prisma.$executeRaw`UPDATE "Product" SET "descriptionEmbedding" = ${vectorString}::vector WHERE id = ${record.id}`;
            }

            checkpoint.processedProductKeys.add(productKey);
            checkpoint.processedCount++;
            checkpoint.stats = stats;

            // Save checkpoint periodically
            if (checkpoint.processedCount % CHECKPOINT_SAVE_INTERVAL === 0) {
              await saveCheckpoint(checkpoint);
            }
          } catch (error) {
            console.error(
              `     ❌ [${i + originalIndex + 1}/${
                aggregatedProducts.length
              }] Error: ${error.message}`
            );
            stats.errors++;
          }
        }
      }

      // Delay between batches
      if (i + AI_BATCH_SIZE < aggregatedProducts.length) {
        console.log(`     ⏳ Waiting ${BATCH_DELAY_MS}ms before next batch...`);
        await sleep(BATCH_DELAY_MS);
      }
    }

    // Final checkpoint save
    await saveCheckpoint(checkpoint);
  } catch (error) {
    console.error(`\n❌ Fatal error: ${error.message}`);
    await saveCheckpoint(checkpoint);
    throw error;
  } finally {
    await prisma.$disconnect();
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log(`🎉 DIESEL IMPORT COMPLETE`);
  console.log(`${"=".repeat(70)}`);
  console.log(`✅ Created: ${stats.created} (CLOTHING only)`);
  console.log(`🔄 Updated: ${stats.updated}`);
  console.log(`⏭️  Skipped: ${stats.skipped} (includes FOOTWEAR/ACCESSORIES)`);
  console.log(`🔁 Variants Aggregated: ${stats.variants}`);
  console.log(`🖼️  Invalid Images: ${stats.invalidImages}`);
  console.log(`📝 Missing Data: ${stats.missingData}`);
  console.log(`❌ Errors: ${stats.errors}`);
  console.log(`🤖 Total API Calls: ${rateLimiter.dailyRequestCount}`);
  console.log(`${"=".repeat(70)}\n`);
}

// ============================================================================
// EXECUTE
// ============================================================================

importDieselProducts()
  .then(() => {
    console.log("✅ Script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Script failed:", error);
    process.exit(1);
  });
