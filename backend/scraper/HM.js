// hm_optimized.js - High-Performance H&M CSV Importer with Variant Aggregation
// Optimized with Bershka-style batch processing
// Processing speed: ~100+ products/minute
//
// KEY FEATURES:
// ✅ Aggregates variants (same product, different colors/sizes) into single entry
// ✅ Skips products with invalid images, missing title/URL
// ✅ Batch AI processing (multiple products at once)
// ✅ DeepFashion color extraction for CLOTHING only
// ✅ Persistent cache for AI extractions
// ✅ Checkpoint system for resume capability
// ✅ Stores all colors/sizes in specs JSON

import fetch from "node-fetch";
import { parse } from "csv-parse/sync";
import { PrismaClient, StockStatus, StoreName } from "@prisma/client";
import OpenAI from "openai";
import fs from "fs/promises";
import pLimit from "p-limit";
import sharp from "sharp";

// --- GLOBAL CONFIGURATION ---
const prisma = new PrismaClient();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const CSV_URL =
  "https://product-feeds.optimisemedia.com/feeds/49?aid=2360728&format=csv";
const STORE_NAME = StoreName.HM;
const CURRENCY = "KWD";

// --- BATCH PROCESSING CONFIGURATION ---
const AI_BATCH_SIZE = 10; // Process 10 products through AI at once
const CONCURRENT_LIMIT = 5; // Download/validate 5 images concurrently
const BATCH_DELAY_MS = 2000; // 2s delay between AI batches
const LLM_MODEL = "gpt-4o-mini";
const DEEPFASHION_BATCH_SIZE = 24; // DeepFashion batch size (for color extraction)
const DEEPFASHION_API_URL = process.env.RUNPOD_API_URL; // Your RunPod endpoint

// --- TEST MODE CONFIGURATION ---
// ⚠️ SET TO null FOR FULL IMPORT (87,000 products)
// Set to number (e.g., 1000) for testing
const TEST_MODE_LIMIT = null; // ✅ FULL IMPORT - Process ALL products

// --- CHECKPOINT & CACHE FILES ---
const CHECKPOINT_FILE = "./hm_import_checkpoint.json";
const CACHE_FILE = "./hm_import_cache.json";
const CHECKPOINT_SAVE_INTERVAL = 5; // Save every 5 products

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
        categorySkipped: 0,
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

async function extractAttributesFromImageBatch(imageDataList) {
  console.log(
    `\n     🎨 [DEEPFASHION] Extracting attributes from ${imageDataList.length} images...`
  );

  if (!DEEPFASHION_API_URL) {
    console.log(`     ⚠️  DeepFashion API URL not configured - skipping`);
    return imageDataList.map(() => ({
      success: false,
      color: null,
      gender: null,
    }));
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
        console.log(
          `     📊 Sample - color: ${sampleResult.attributes.color}, gender: ${
            sampleResult.attributes.gender || "N/A"
          }`
        );
      }

      return imageDataList.map((item, index) => {
        const result = output.results[index];

        if (result && result.success) {
          return {
            success: true,
            color: result.attributes.color
              ? result.attributes.color.toLowerCase()
              : null,
            gender: result.attributes.gender
              ? result.attributes.gender.toLowerCase()
              : null,
          };
        } else {
          return {
            success: false,
            color: null,
            gender: null,
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
        console.log(
          `     📊 Sample - color: ${sampleResult.attributes.color}, gender: ${
            sampleResult.attributes.gender || "N/A"
          }`
        );
      }

      return imageDataList.map((item, index) => {
        const result = output.results[index];

        if (result && result.success) {
          return {
            success: true,
            color: result.attributes.color
              ? result.attributes.color.toLowerCase()
              : null,
            gender: result.attributes.gender
              ? result.attributes.gender.toLowerCase()
              : null,
          };
        } else {
          return {
            success: false,
            color: null,
            gender: null,
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
      gender: null,
      error: error.message,
    }));
  }
}

async function processProductsWithDeepFashion(products) {
  console.log(
    `\n🎨 Processing ${products.length} CLOTHING products for attribute extraction...`
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
      results.push(
        ...batch.map(() => ({ success: false, color: null, gender: null }))
      );
      continue;
    }

    const attributeResults = await extractAttributesFromImageBatch(
      successfulDownloads
    );

    for (let j = 0; j < batch.length; j++) {
      const downloadResult = downloadResults[j];

      if (!downloadResult.success) {
        results.push({
          product: batch[j],
          deepFashionColor: null,
          deepFashionGender: null,
        });
        continue;
      }

      const attributeResult =
        attributeResults[
          successfulDownloads.findIndex((d) => d.productIndex === j)
        ];

      results.push({
        product: batch[j],
        deepFashionColor: attributeResult.success
          ? attributeResult.color
          : null,
        deepFashionGender: attributeResult.success
          ? attributeResult.gender
          : null,
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
    });

    console.log(`✅ Parsed ${records.length} rows`);
    return records;
  } catch (error) {
    console.error(`❌ Failed to parse CSV: ${error.message}`);
    throw error;
  }
}

function mapCSVRowToProduct(row) {
  // Clean URL (remove affiliate tracking)
  let productUrl = (row.ProductURL || "").trim();
  let cleanUrl = productUrl;

  if (productUrl) {
    const rMatch = productUrl.match(/r=(https?:\/\/[^&]+)/);
    if (rMatch) {
      let destinationUrl = decodeURIComponent(rMatch[1]);
      if (destinationUrl.includes("?selected=")) {
        destinationUrl = destinationUrl.split("?selected=")[0];
      }
      cleanUrl = destinationUrl;
    }
  }

  // Get image URL
  let imageUrl = (
    row.ProductImageMediumURL ||
    row.ProductImageLargeURL ||
    row.ProductImageSmallURL ||
    ""
  ).trim();
  if (!imageUrl) {
    imageUrl = "https://via.placeholder.com/600x800?text=No+Image";
  }

  // Parse prices
  const price = parseFloat((row.ProductPrice || "0").replace(/,/g, ""));
  const wasPrice = parseFloat((row.WasPrice || "0").replace(/,/g, ""));

  return {
    title: (row.ProductName || "").trim(),
    description: (row.ProductDescription || "").trim(),
    price: price,
    originalPrice: wasPrice > price ? wasPrice : price,
    imageUrl: imageUrl,
    productUrl: productUrl,
    cleanUrl: cleanUrl,
    sku: (row.ProductSKU || "").trim(),
    gtin: (row.GTIN || "").trim(),
    availability: (row.StockAvailability || "in stock").trim(),
    rawColor: (row.Colour || "").trim(),
    rawSize: (row.Size || "").trim(),
    rawGender: (row.Gender || "").trim(),
    rawCategory: (row.CategoryName || "").trim(),
    brand: "H&M", // ✅ HARDCODED BRAND
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
    .replace(/\b\d+y\b/gi, "")
    .replace(/\b(2|4|6|8|10|12|14|16|18)\b/gi, "")
    .replace(/\b(32|34|36|38|40|42|44|46|48)\b/gi, "")
    .replace(
      /\b(black|white|red|blue|green|gray|grey|navy|pink|yellow|beige|brown)\b/gi,
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

    // Aggregate colors
    if (product.rawColor) {
      variant.colors.add(product.rawColor.toLowerCase());
    }

    // Aggregate sizes
    if (product.rawSize) {
      variant.sizes.add(product.rawSize.toLowerCase());
    }

    // Aggregate SKUs
    if (product.sku) {
      variant.skus.add(product.sku);
    }

    // Track prices
    variant.prices.push(product.price);

    // Store variant info
    variant.variants.push({
      sku: product.sku,
      size: product.rawSize,
      color: product.rawColor,
      price: product.price,
    });
  }

  // Convert Map to array
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

const EXTRACTION_PROMPT = `You are a Fashion Data Extraction AI for H&M products.

OUTPUT:
{
  "category": "CLOTHING|FOOTWEAR|ACCESSORIES",
  "specs": {
    "type": "product type (MANDATORY - guess from title)",
    "fit": "slim fit|regular fit|relaxed fit|oversized|etc",
    "material": "cotton|polyester|denim|etc",
    "pattern": "solid|striped|floral|etc",
    "style": "casual|formal|sportswear|etc"
  }
}

RULES: 
- ALL lowercase
- Extract gender from context if available
- Return ONLY valid JSON
- Type examples: t-shirt, jeans, dress, jacket, hoodie, sneakers, boots, bag, belt
- Use hyphens in types: "t-shirt" not "t shirt"`;

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

  // Process uncached products
  const OPENAI_BATCH_SIZE = 5;

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
                  )}"\nGENDER: ${product.rawGender || "unknown"}\nCATEGORY: ${
                    product.rawCategory || "unknown"
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
        if (product.rawGender && !extracted.specs.gender) {
          extracted.specs.gender = product.rawGender.toLowerCase();
        }

        // Add SKU, raw data from CSV
        if (product.sku) extracted.specs.sku = product.sku;
        if (product.gtin) extracted.specs.gtin = product.gtin;

        // Cache result
        const cacheKey = product.title.toLowerCase().substring(0, 80);
        persistentCache.categoryDetection[cacheKey] = extracted;

        // Store in results array
        const originalIndex = uncachedIndices[globalIndex];
        results[originalIndex] = extracted;
      }
    } catch (error) {
      console.error(`     ❌ Batch AI failed: ${error.message}`);

      // Fallback
      for (let j = 0; j < batch.length; j++) {
        const globalIndex = i + j;
        const originalIndex = uncachedIndices[globalIndex];
        const product = batch[j];

        results[originalIndex] = {
          category: "CLOTHING",
          specs: {
            type: guessTypeFromTitle(product.title),
            gender: product.rawGender || "unisex",
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

  if (lower.includes("t-shirt") || lower.includes("tee")) return "t-shirt";
  if (lower.includes("jeans")) return "jeans";
  if (lower.includes("dress")) return "dress";
  if (lower.includes("jacket")) return "jacket";
  if (lower.includes("hoodie")) return "hoodie";
  if (lower.includes("sweater")) return "sweater";
  if (lower.includes("shirt")) return "shirt";
  if (lower.includes("pants") || lower.includes("trousers")) return "pants";
  if (lower.includes("shorts")) return "shorts";
  if (lower.includes("skirt")) return "skirt";
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
    .filter(([k, v]) => v && !["sku", "gtin"].includes(k))
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

async function importHMProducts() {
  await loadCache();
  const checkpoint = await loadCheckpoint();
  let stats = { ...checkpoint.stats };

  console.log(`\n${"=".repeat(70)}`);
  console.log(`🏪 H&M CSV IMPORTER - OPTIMIZED WITH VARIANT AGGREGATION`);
  console.log(`${"=".repeat(70)}`);
  console.log(`   Store: ${STORE_NAME}`);
  console.log(`   Currency: ${CURRENCY}`);
  console.log(`   AI Batch Size: ${AI_BATCH_SIZE}`);
  console.log(`   DeepFashion Batch: ${DEEPFASHION_BATCH_SIZE}`);
  console.log(`   Concurrent Validations: ${CONCURRENT_LIMIT}`);
  console.log(
    `   DeepFashion: ${DEEPFASHION_API_URL ? "✅ Enabled" : "❌ Disabled"}`
  );

  // Test mode warning
  if (TEST_MODE_LIMIT !== null) {
    console.log(`\n   ⚠️  TEST MODE ENABLED ⚠️`);
    console.log(`   📊 Processing ONLY first ${TEST_MODE_LIMIT} products`);
    console.log(`   💡 Set TEST_MODE_LIMIT = null for full import`);
  }

  console.log(`${"=".repeat(70)}\n`);

  try {
    // Download and parse CSV
    const csvText = await downloadCSV(CSV_URL);
    let csvRows = parseCSV(csvText);

    if (csvRows.length === 0) {
      console.log("⚠️ No products found in CSV");
      return;
    }

    // Apply test mode limit if enabled
    const originalRowCount = csvRows.length;
    if (TEST_MODE_LIMIT !== null && csvRows.length > TEST_MODE_LIMIT) {
      csvRows = csvRows.slice(0, TEST_MODE_LIMIT);
      console.log(
        `\n⚠️  TEST MODE: Limited ${originalRowCount} → ${csvRows.length} products\n`
      );
    }

    console.log(
      `\n📊 Processing ${csvRows.length} CSV rows${
        TEST_MODE_LIMIT !== null ? " (TEST MODE)" : ""
      }...\n`
    );

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
          stats.categorySkipped++;
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

      // Process DeepFashion attribute extraction for CLOTHING products only
      let deepFashionResults = [];
      if (clothingProducts.length > 0 && DEEPFASHION_API_URL) {
        console.log(
          `\n     🎨 Processing ${clothingProducts.length} CLOTHING products for attribute extraction...`
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
          const deepFashionGender = deepFashionResults[j]?.deepFashionGender;

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

            // Use DeepFashion color if available (highest priority)
            if (deepFashionColor) {
              finalSpecs.color = deepFashionColor;
              console.log(`     🎨 DeepFashion color: ${deepFashionColor}`);
            } else if (product.aggregatedColors) {
              finalSpecs.color = product.aggregatedColors;
            }

            // Use DeepFashion gender if available (highest priority)
            if (deepFashionGender) {
              finalSpecs.gender = deepFashionGender;
              console.log(`     👤 DeepFashion gender: ${deepFashionGender}`);
            } else if (product.rawGender) {
              // Fallback to CSV gender
              finalSpecs.gender = product.rawGender.toLowerCase();
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
                  product.availability === "in stock" ||
                  product.availability === "In Stock"
                    ? StockStatus.IN_STOCK
                    : StockStatus.OUT_OF_STOCK,
                lastSeenAt: new Date(),
                brand: "H&M", // ✅ HARDCODED BRAND
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
  console.log(
    `🎉 H&M IMPORT COMPLETE${TEST_MODE_LIMIT !== null ? " (TEST MODE)" : ""}`
  );
  console.log(`${"=".repeat(70)}`);

  if (TEST_MODE_LIMIT !== null) {
    console.log(
      `⚠️  TEST MODE: Processed ${TEST_MODE_LIMIT} of ~87,000 total products`
    );
    console.log(`💡 Set TEST_MODE_LIMIT = null for full import\n`);
  }

  console.log(`✅ Created: ${stats.created} (CLOTHING only)`);
  console.log(`🔄 Updated: ${stats.updated}`);
  console.log(
    `⏭️  Skipped: ${stats.skipped + stats.categorySkipped} (${
      stats.categorySkipped
    } categories filtered)`
  );
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

importHMProducts()
  .then(() => {
    console.log("✅ Script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Script failed:", error);
    process.exit(1);
  });
