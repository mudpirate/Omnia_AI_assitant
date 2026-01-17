// primark_batch_optimized.js - High-Performance Scraper with Batch DeepFashion
// Optimized for 100k+ products with batch processing
// Processing speed: ~60 products/minute (vs 5 previously)

import { PrismaClient, StockStatus } from "@prisma/client";
import OpenAI from "openai";
import fs from "fs/promises";
import fetch from "node-fetch";
import pLimit from "p-limit";

// --- GLOBAL CONFIGURATION ---
const prisma = new PrismaClient();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const STORE_NAME = "PRIMARK";
const CURRENCY = "KWD";
const BASE_URL = "https://www.primark.com.kw";
const DEEPFASHION_API_URL = process.env.RUNPOD_API_URL; // Your RunPod endpoint

// --- BATCH PROCESSING CONFIGURATION ---
const DEEPFASHION_BATCH_SIZE = 16; // Send 16 images at once to RunPod
const IMAGE_DOWNLOAD_CONCURRENCY = 8; // Download 8 images simultaneously
const DB_SAVE_BATCH_SIZE = 10; // Save 10 products to DB at once

// --- RATE LIMITING ---
const CONCURRENT_LIMIT = 2;
const LLM_MODEL = "gpt-4o-mini";
const BATCH_DELAY_MS = 2000; // Reduced delay since we're processing in batches
const PAGE_LOAD_TIMEOUT = 60000;

// --- CHECKPOINT & CACHE FILES ---
const CHECKPOINT_FILE = "./primark_import_checkpoint.json";
const CACHE_FILE = "./primark_import_cache.json";
const CHECKPOINT_SAVE_INTERVAL = 10; // Save more frequently with batching

// --- RATE LIMITER TRACKING ---
const rateLimiter = {
  requestCount: 0,
  dailyRequestCount: 0,
  lastResetTime: Date.now(),
  consecutiveErrors: 0,
};

// --- SELECTORS (same as before) ---
const SELECTORS = {
  productLink: "a[href*='/buy-']",
  loadMoreButton:
    ".pager-button-container button.pager-button, button.pager-button[rel='next']",
  productCount: ".product-count, .results-count, [class*='product-count']",
  pdpTitle: [
    "h6.pdp-product__title",
    "h1.pdp-product__title",
    ".pdp-product__title",
    ".product-details h1",
    ".product-details h6",
    "h1",
  ],
  pdpShortDesc: [
    ".pdp-product__short_desc",
    ".product-short-description",
    ".short-description",
  ],
  pdpPrice: [
    ".dropin-price",
    ".pdp-product__price",
    ".product-price",
    "[class*='price']",
  ],
  pdpImage: [
    ".pdp-gallery-grid__item img",
    ".pdp-carousel__slide img",
    ".product-image img",
    ".gallery img",
    "img[src*='media.alshaya.com']",
  ],
  pdpDescriptionContent: [
    ".pdp-product__description--content",
    ".product-description-content",
    ".description-content",
  ],
  pdpPattern: ".pdp-product-description__attribute--pattern span",
  pdpStyle: ".pdp-product-description__attribute--style span",
  pdpSku: [
    ".pdp-product-description__attribute--sku span",
    ".pdp-product-description__attribute--sku li span",
    "[class*='sku'] span",
  ],
  pdpColorLabel: [
    ".pdp-swatches__title",
    ".color-swatch-label + p",
    "[class*='color'] .title",
  ],
  pdpSizeList: ".pdp-size-list li.pdp-size-select, .pdp-size-list li",
  pdpCare: ".pdp-product__item_care--content",
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildProductUrl(href) {
  if (!href) return null;
  if (href.startsWith("http")) return href;
  const cleanHref = href.startsWith("/") ? href : `/${href}`;
  return `${BASE_URL}${cleanHref}`;
}

// ============================================================================
// BATCH IMAGE DOWNLOAD
// ============================================================================

/**
 * Download multiple images in parallel and convert to base64
 */
async function downloadImagesInBatch(imageUrls) {
  console.log(`     📥 Downloading ${imageUrls.length} images in parallel...`);

  const limit = pLimit(IMAGE_DOWNLOAD_CONCURRENCY);
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
        const base64 = buffer.toString("base64");

        return {
          index,
          success: true,
          url,
          base64,
          size: buffer.length,
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

  console.log(
    `     ✅ Downloaded ${successful.length}/${
      results.length
    } images in ${duration}s (${(totalSize / 1024).toFixed(1)} KB)`
  );

  if (failed.length > 0) {
    console.log(`     ⚠️  ${failed.length} images failed to download`);
  }

  return results;
}

// ============================================================================
// BATCH DEEPFASHION API CALL
// ============================================================================

/**
 * Send batch of images to RunPod DeepFashion endpoint
 */
async function extractAttributesFromImageBatch(imageDataList) {
  console.log(
    `\n     🎨 [DEEPFASHION BATCH] Analyzing ${imageDataList.length} images...`
  );

  if (!DEEPFASHION_API_URL) {
    console.log(`     ⚠️  DeepFashion API URL not configured - skipping`);
    return imageDataList.map(() => ({ success: false, attributes: {} }));
  }

  try {
    const startTime = Date.now();

    // Prepare batch request
    const requestBody = {
      input: {
        images: imageDataList.map((item, index) => ({
          data: item.base64,
          id: item.id || `image_${index}`,
        })),
      },
    };

    // Call RunPod API
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
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    if (!data.results) {
      throw new Error("Invalid response format from RunPod");
    }

    console.log(
      `     ✅ Batch processing completed in ${duration}s (${data.stats?.images_per_second?.toFixed(
        1
      )} images/sec)`
    );

    // Log sample attributes
    const sampleResult = data.results.find((r) => r.success);
    if (sampleResult) {
      console.log(`     📊 Sample attributes:`, {
        category: sampleResult.attributes.category,
        color: sampleResult.attributes.color,
        pattern: sampleResult.attributes.pattern,
      });
    }

    // Map results back to input order
    return imageDataList.map((item, index) => {
      const result = data.results[index];

      if (result && result.success) {
        // Remove gender from DeepFashion (will be set from master.js)
        const attributes = { ...result.attributes };
        delete attributes.gender;

        return {
          success: true,
          attributes: attributes,
          confidence: result.confidence,
        };
      } else {
        return {
          success: false,
          attributes: {},
          error: result?.error || "Unknown error",
        };
      }
    });
  } catch (error) {
    console.error(`     ❌ Batch DeepFashion failed: ${error.message}`);
    return imageDataList.map(() => ({
      success: false,
      attributes: {},
      error: error.message,
    }));
  }
}

/**
 * Process products in batches for DeepFashion extraction
 */
async function processProductsBatch(products, genderFromMaster) {
  console.log(
    `\n🔄 Processing ${products.length} products in batches of ${DEEPFASHION_BATCH_SIZE}...`
  );

  const results = [];

  for (let i = 0; i < products.length; i += DEEPFASHION_BATCH_SIZE) {
    const batch = products.slice(i, i + DEEPFASHION_BATCH_SIZE);
    const batchNum = Math.floor(i / DEEPFASHION_BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(products.length / DEEPFASHION_BATCH_SIZE);

    console.log(
      `\n📦 [BATCH ${batchNum}/${totalBatches}] Processing ${batch.length} products...`
    );

    // Step 1: Download all images in parallel
    const imageUrls = batch.map((p) => p.imageUrl);
    const downloadResults = await downloadImagesInBatch(imageUrls);

    // Step 2: Prepare successful downloads for DeepFashion
    const successfulDownloads = downloadResults
      .filter((r) => r.success)
      .map((r) => ({
        base64: r.base64,
        id: `product_${i + r.index}`,
        productIndex: r.index,
      }));

    if (successfulDownloads.length === 0) {
      console.log(`     ⚠️  No images downloaded successfully in this batch`);
      results.push(...batch.map(() => ({ success: false, attributes: {} })));
      continue;
    }

    // Step 3: Send batch to DeepFashion
    const deepFashionResults = await extractAttributesFromImageBatch(
      successfulDownloads
    );

    // Step 4: Map results back to products
    for (let j = 0; j < batch.length; j++) {
      const downloadResult = downloadResults[j];

      if (!downloadResult.success) {
        results.push({
          product: batch[j],
          deepFashion: { success: false, attributes: {} },
        });
        continue;
      }

      const deepFashionResult =
        deepFashionResults[
          successfulDownloads.findIndex((d) => d.productIndex === j)
        ];

      // Merge with gender from master.js
      if (deepFashionResult.success && genderFromMaster) {
        deepFashionResult.attributes.gender = genderFromMaster.toLowerCase();
      }

      results.push({
        product: batch[j],
        deepFashion: deepFashionResult,
      });
    }

    // Delay between batches
    if (i + DEEPFASHION_BATCH_SIZE < products.length) {
      console.log(`     ⏳ Waiting ${BATCH_DELAY_MS}ms before next batch...`);
      await sleep(BATCH_DELAY_MS);
    }
  }

  return results;
}

// ============================================================================
// MERGE ATTRIBUTES (same logic as before)
// ============================================================================

function mergeAttributes(
  scrapedSpecs,
  deepFashionAttributes,
  genderFromMaster
) {
  const merged = { ...scrapedSpecs };

  // Gender from master.js (highest priority)
  if (genderFromMaster) {
    merged.gender = genderFromMaster.toLowerCase();
  }

  if (deepFashionAttributes.color) {
    merged.color = deepFashionAttributes.color.toLowerCase();
  }

  if (deepFashionAttributes.pattern) {
    merged.pattern = deepFashionAttributes.pattern.toLowerCase();
  }

  if (deepFashionAttributes.sleeveLength) {
    merged.sleeve_length = deepFashionAttributes.sleeveLength.toLowerCase();
  }

  if (deepFashionAttributes.neckline) {
    merged.neckline = deepFashionAttributes.neckline.toLowerCase();
  }

  if (deepFashionAttributes.length) {
    merged.length = deepFashionAttributes.length.toLowerCase();
  }

  // Map category to type
  if (deepFashionAttributes.category && !merged.type) {
    const typeMap = {
      dress: "dress",
      top: "top",
      shirt: "shirt",
      blouse: "blouse",
      "t-shirt": "t-shirt",
      sweater: "sweater",
      hoodie: "hoodie",
      jacket: "jacket",
      coat: "coat",
      pants: "pants",
      jeans: "jeans",
      shorts: "shorts",
      skirt: "skirt",
      shoes: "shoes",
    };

    const mappedType = typeMap[deepFashionAttributes.category.toLowerCase()];
    if (mappedType) {
      merged.type = mappedType;
    }
  }

  return merged;
}

// ============================================================================
// PERSISTENT CACHE SYSTEM (same as before)
// ============================================================================

let persistentCache = {
  categoryDetection: {},
};

async function loadCache() {
  try {
    const data = await fs.readFile(CACHE_FILE, "utf-8");
    persistentCache = JSON.parse(data);
    console.log(
      `💾 Loaded cache: ${
        Object.keys(persistentCache.categoryDetection || {}).length
      } entries`
    );
  } catch (error) {
    console.log(`💾 No cache found - starting fresh`);
    persistentCache = { categoryDetection: {} };
  }
}

async function saveCache() {
  try {
    await fs.writeFile(CACHE_FILE, JSON.stringify(persistentCache, null, 2));
  } catch (error) {
    console.error(`   ⚠️ Failed to save cache: ${error.message}`);
  }
}

// ============================================================================
// CHECKPOINT FUNCTIONS (same as before)
// ============================================================================

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
      processedSkus: new Set(checkpoint.processedSkus || []),
      processedCount: checkpoint.processedCount,
      stats: checkpoint.stats,
      apiCalls: checkpoint.apiCalls || 0,
    };
  } catch (error) {
    console.log(`\n📍 No checkpoint - starting fresh\n`);
    return {
      processedSkus: new Set(),
      processedCount: 0,
      stats: { created: 0, updated: 0, skipped: 0, errors: 0 },
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
          processedSkus: Array.from(checkpoint.processedSkus),
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
// AI EXTRACTION & EMBEDDING (same as before)
// ============================================================================

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

const EXTRACTION_PROMPT = `You are a Fashion Data Extraction AI.

OUTPUT:
{
  "category": "CLOTHING|FOOTWEAR|ACCESSORIES",
  "specs": {
    "type": "product type (MANDATORY)",
    "fit": "baggy|slim|regular|etc",
    "rise": "low rise|mid rise|high rise",
    "material": "cotton|denim|etc",
    "pattern": "solid|striped|etc",
    "style": "jeans|casual|etc"
  }
}

RULES: ALL lowercase. DO NOT extract gender. Return ONLY valid JSON.`;

async function extractProductSpecs(title, shortDesc, fullDesc, scrapedData) {
  const cacheKey = title.toLowerCase().substring(0, 80);
  if (persistentCache.categoryDetection[cacheKey]) {
    return persistentCache.categoryDetection[cacheKey];
  }

  try {
    const result = await callOpenAIWithRetry(
      async () => {
        const completion = await openai.chat.completions.create({
          model: LLM_MODEL,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: EXTRACTION_PROMPT },
            {
              role: "user",
              content: `TITLE: "${title}"\nSHORT: "${
                shortDesc || ""
              }"\nFULL: "${(fullDesc || "").substring(0, 400)}"\nCOLOR: ${
                scrapedData?.color || "N/A"
              }`,
            },
          ],
          temperature: 0,
        });
        return JSON.parse(completion.choices[0].message.content);
      },
      5,
      "Specs"
    );

    const extracted = {
      category: (result.category || "CLOTHING").toUpperCase(),
      specs: result.specs || {},
    };

    if (scrapedData) {
      if (scrapedData.color)
        extracted.specs.color = scrapedData.color.toLowerCase();
      if (scrapedData.pattern)
        extracted.specs.pattern = scrapedData.pattern.toLowerCase();
      if (scrapedData.style)
        extracted.specs.style = scrapedData.style.toLowerCase();
      if (scrapedData.sku) extracted.specs.sku = scrapedData.sku;
      if (scrapedData.availableSizes)
        extracted.specs.available_sizes = scrapedData.availableSizes;
    }

    persistentCache.categoryDetection[cacheKey] = extracted;
    return extracted;
  } catch (error) {
    console.error(`  ⚠️ AI failed: ${error.message}`);
    const specs = {
      type: title.toLowerCase().includes("jeans") ? "jeans" : "clothing",
    };
    if (scrapedData?.color) specs.color = scrapedData.color.toLowerCase();
    if (scrapedData?.sku) specs.sku = scrapedData.sku;
    return { category: "CLOTHING", specs };
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
    console.error("⚠️ Embedding Error:", error.message);
    return null;
  }
}

function generateSearchContext(title, specs, price, description) {
  let context = `Primark ${title}.`;
  const specString = Object.entries(specs)
    .filter(([k, v]) => v && !["sku", "available_sizes"].includes(k))
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");
  if (specString) context += ` Specs: ${specString}.`;
  context += ` Price: ${price} ${CURRENCY}.`;
  if (description) context += ` ${description.substring(0, 200)}`;
  return context;
}

// ============================================================================
// POPUP DISMISSAL (same as before)
// ============================================================================

async function dismissPopupsAndBanners(page) {
  try {
    await page.evaluate(() => {
      const cookieAccept = document.querySelector(
        '#cookie-accept-button, .cookie-accept, [id*="cookie"] button, .cookie-banner button'
      );
      if (cookieAccept) cookieAccept.click();

      const subboxClose = document.querySelector(
        ".subbox-close, .subbox-subscription-dialog .subbox-close-cross"
      );
      if (subboxClose) subboxClose.click();

      const overlays = document.querySelectorAll(
        '.cookie-banner, .subbox-banner, .subbox-subscription-dialog, .subbox-banner-backdrop, [class*="modal-backdrop"], [class*="overlay"]'
      );
      overlays.forEach((el) => {
        if (el && el.style) el.style.display = "none";
      });
    });
    await sleep(500);
  } catch (e) {
    // Ignore
  }
}

// ============================================================================
// SCRAPING FUNCTIONS (same as before)
// ============================================================================

async function scrollToBottom(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 500;
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= document.body.scrollHeight - window.innerHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 150);
      setTimeout(() => {
        clearInterval(timer);
        resolve();
      }, 20000);
    });
  });
}

async function loadAllProducts(page) {
  let loadMoreClicks = 0;
  const maxClicks = 50;

  while (loadMoreClicks < maxClicks) {
    await scrollToBottom(page);
    await sleep(1000);

    const loadMoreButton = await page.$(SELECTORS.loadMoreButton);

    if (!loadMoreButton) {
      console.log(`   ✅ No more "Load more" button`);
      break;
    }

    const isVisible = await page.evaluate((selector) => {
      const btn = document.querySelector(selector);
      if (!btn) return false;
      const style = window.getComputedStyle(btn);
      const rect = btn.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0
      );
    }, SELECTORS.loadMoreButton);

    if (!isVisible) {
      console.log(`   ✅ "Load more" button no longer visible`);
      break;
    }

    const beforeCount = await page.evaluate(
      (selector) => document.querySelectorAll(selector).length,
      SELECTORS.productLink
    );

    try {
      await page.evaluate((selector) => {
        const btn = document.querySelector(selector);
        if (btn) btn.scrollIntoView({ behavior: "smooth", block: "center" });
      }, SELECTORS.loadMoreButton);

      await sleep(500);
      await page.click(SELECTORS.loadMoreButton);
      loadMoreClicks++;

      console.log(`   🔄 Clicked "Load more" (${loadMoreClicks})`);
      await sleep(2000);

      let waitAttempts = 0;
      while (waitAttempts < 10) {
        const afterCount = await page.evaluate(
          (selector) => document.querySelectorAll(selector).length,
          SELECTORS.productLink
        );
        if (afterCount > beforeCount) {
          console.log(`   📦 Products: ${beforeCount} → ${afterCount}`);
          break;
        }
        await sleep(500);
        waitAttempts++;
      }

      await dismissPopupsAndBanners(page);
    } catch (error) {
      console.log(`   ⚠️ Could not click "Load more": ${error.message}`);
      break;
    }
  }

  await scrollToBottom(page);
  await sleep(1000);
}

async function scrapeProductListings(page, categoryUrl) {
  console.log(`\n📋 Scraping listings from: ${categoryUrl}`);

  await page.goto(categoryUrl, {
    waitUntil: "networkidle2",
    timeout: PAGE_LOAD_TIMEOUT,
  });
  await sleep(2000);
  await dismissPopupsAndBanners(page);

  await page
    .waitForSelector(SELECTORS.productLink, { timeout: 15000 })
    .catch(() => {
      console.log(`   ⚠️ Products not found immediately`);
    });

  const initialCount = await page.evaluate(
    (selector) => document.querySelectorAll(selector).length,
    SELECTORS.productLink
  );
  console.log(`   📦 Initial products: ${initialCount}`);

  await loadAllProducts(page);

  const finalCount = await page.evaluate(
    (selector) => document.querySelectorAll(selector).length,
    SELECTORS.productLink
  );
  console.log(`   📦 Total products: ${finalCount}`);

  const products = await page.evaluate((selector) => {
    const results = [];
    const links = document.querySelectorAll(selector);
    const seen = new Set();

    links.forEach((link) => {
      let href = link.getAttribute("href");
      if (!href || seen.has(href)) return;
      seen.add(href);

      let title = "";
      const urlMatch = href.match(/\/buy-(.+?)(?:\?|$)/);
      if (urlMatch) {
        title = urlMatch[1]
          .replace(/-/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase());
      }

      results.push({ href, title: title || "Unknown" });
    });

    return results;
  }, SELECTORS.productLink);

  console.log(`   ✅ Found ${products.length} unique products`);
  return products.map((p) => ({
    productUrl: buildProductUrl(p.href),
    title: p.title,
  }));
}

async function scrapeProductDetails(page, productUrl) {
  try {
    await page.goto(productUrl, {
      waitUntil: "networkidle2",
      timeout: PAGE_LOAD_TIMEOUT,
    });

    await sleep(1500);
    await dismissPopupsAndBanners(page);
    await sleep(1000);

    await page.evaluate(() => {
      const accordion = document.querySelector(
        'details.pdp-product__description, details[class*="description"]'
      );
      if (accordion && !accordion.hasAttribute("open")) {
        accordion.setAttribute("open", "");
      }
    });
    await sleep(300);

    const productData = await page.evaluate((selectors) => {
      const data = {
        title: null,
        shortDesc: null,
        fullDesc: null,
        price: 0,
        imageUrl: null,
        color: null,
        pattern: null,
        style: null,
        sku: null,
        care: null,
        availableSizes: [],
      };

      const trySelect = (selectorArray) => {
        const selArray = Array.isArray(selectorArray)
          ? selectorArray
          : [selectorArray];
        for (const sel of selArray) {
          const el = document.querySelector(sel);
          if (el) return el;
        }
        return null;
      };

      const titleEl = trySelect(selectors.pdpTitle);
      if (titleEl) data.title = titleEl.textContent.trim();

      const shortDescEl = trySelect(selectors.pdpShortDesc);
      if (shortDescEl) data.shortDesc = shortDescEl.textContent.trim();

      if (data.title && data.shortDesc && data.title.includes(data.shortDesc)) {
        data.title = data.title.replace(data.shortDesc, "").trim();
      }

      const fullDescEl = trySelect(selectors.pdpDescriptionContent);
      if (fullDescEl) data.fullDesc = fullDescEl.textContent.trim();

      const priceEl = trySelect(selectors.pdpPrice);
      if (priceEl) {
        const priceText = priceEl.textContent.replace(/\u00a0/g, " ").trim();
        const priceMatch = priceText.match(/[\d.]+/);
        data.price = priceMatch ? parseFloat(priceMatch[0]) : 0;
      }

      const imgEl = trySelect(selectors.pdpImage);
      if (imgEl) {
        let imgSrc = imgEl.getAttribute("src") || imgEl.src;
        if (imgSrc && imgSrc.includes("?")) {
          imgSrc = imgSrc.split("?")[0] + "?width=1920";
        }
        data.imageUrl = imgSrc;
      }

      const colorEl = trySelect(selectors.pdpColorLabel);
      if (colorEl) data.color = colorEl.textContent.trim();

      const patternEl = document.querySelector(selectors.pdpPattern);
      if (patternEl) data.pattern = patternEl.textContent.trim();

      const styleEl = document.querySelector(selectors.pdpStyle);
      if (styleEl) data.style = styleEl.textContent.trim();

      const skuEl = trySelect(selectors.pdpSku);
      if (skuEl) data.sku = skuEl.textContent.trim();

      const careEl = document.querySelector(selectors.pdpCare);
      if (careEl) data.care = careEl.textContent.trim();

      const sizeEls = document.querySelectorAll(selectors.pdpSizeList);
      sizeEls.forEach((el) => {
        const size = el.textContent.trim();
        const isDisabled =
          el.hasAttribute("disabled") || el.getAttribute("disabled") === "true";
        if (!isDisabled && size) data.availableSizes.push(size);
      });

      return data;
    }, SELECTORS);

    return { ...productData, productUrl };
  } catch (error) {
    console.error(`   ❌ Failed: ${error.message}`);
    return null;
  }
}

// ============================================================================
// MAIN SCRAPER FUNCTION - BATCH OPTIMIZED
// ============================================================================

async function scrapePrimarkProducts(
  browser,
  categoryUrl,
  categoryName,
  gender = null
) {
  await loadCache();
  const checkpoint = await loadCheckpoint();
  let stats = { ...checkpoint.stats };

  const page = await browser.newPage();

  try {
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    );

    await page.setRequestInterception(true);
    page.on("request", (req) => {
      if (["font", "media"].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });

    console.log(`\n${"=".repeat(70)}`);
    console.log(`🏪 PRIMARK SCRAPER WITH BATCH DEEPFASHION`);
    console.log(`${"=".repeat(70)}`);
    console.log(`   Category: ${categoryName}`);
    console.log(`   Gender: ${gender || "Not specified"}`);
    console.log(`   DeepFashion Batch Size: ${DEEPFASHION_BATCH_SIZE}`);
    console.log(
      `   RunPod: ${DEEPFASHION_API_URL ? "✅ Enabled" : "❌ Disabled"}`
    );
    console.log(`${"=".repeat(70)}\n`);

    // Step 1: Scrape all product listings
    const listings = await scrapeProductListings(page, categoryUrl);

    if (listings.length === 0) {
      console.log("⚠️ No products found");
      return;
    }

    console.log(`\n📊 Total products to process: ${listings.length}\n`);

    // Step 2: Scrape all product details
    const allProductData = [];

    for (let i = 0; i < listings.length; i++) {
      const listing = listings[i];

      console.log(
        `[${i + 1}/${listings.length}] 🔍 ${listing.title.substring(0, 50)}...`
      );

      const productData = await scrapeProductDetails(page, listing.productUrl);

      if (!productData || !productData.title || !productData.imageUrl) {
        console.log(`  ❌ Missing required data - skipping`);
        stats.errors++;
        continue;
      }

      const sku = productData.sku || `no-sku-${i}`;
      const color = (productData.color || "unknown").toLowerCase();
      const uniqueKey = `${sku}_${color}`;

      if (checkpoint.processedSkus.has(uniqueKey)) {
        console.log(`  ⏩ Already processed`);
        stats.skipped++;
        continue;
      }

      const existing = await prisma.product.findFirst({
        where: {
          storeName: STORE_NAME,
          AND: [
            { specs: { path: ["sku"], equals: sku } },
            { specs: { path: ["color"], equals: color } },
          ],
        },
        select: { id: true },
      });

      if (existing) {
        console.log(`  ⏩ Already in DB`);
        stats.skipped++;
        checkpoint.processedSkus.add(uniqueKey);
        continue;
      }

      console.log(
        `  💰 NEW: ${productData.title} - ${productData.color || "No Color"}`
      );

      allProductData.push({ ...productData, uniqueKey, sku });

      await sleep(500); // Small delay between scrapes
    }

    if (allProductData.length === 0) {
      console.log("\n⚠️ No new products to process");
      return;
    }

    console.log(`\n✅ Scraped ${allProductData.length} new products`);

    // Step 3: Process all images through DeepFashion in batches
    console.log(`\n🎨 Starting batch DeepFashion processing...`);
    const processedResults = await processProductsBatch(allProductData, gender);

    // Step 4: Save all products to database
    console.log(
      `\n💾 Saving ${processedResults.length} products to database...`
    );

    for (let i = 0; i < processedResults.length; i++) {
      const result = processedResults[i];
      const productData = result.product;
      const deepFashion = result.deepFashion;

      console.log(
        `\n[${i + 1}/${
          processedResults.length
        }] 💾 Saving: ${productData.title.substring(0, 40)}...`
      );

      // Extract specs with LLM
      const extracted = await extractProductSpecs(
        productData.title,
        productData.shortDesc,
        productData.fullDesc,
        {
          color: productData.color,
          pattern: productData.pattern,
          style: productData.style,
          sku: productData.sku,
          availableSizes: productData.availableSizes?.join(", "),
        }
      );

      // Merge with DeepFashion attributes
      const finalSpecs = deepFashion.success
        ? mergeAttributes(extracted.specs, deepFashion.attributes, gender)
        : { ...extracted.specs, gender: gender?.toLowerCase() };

      console.log(`  ✅ Final specs:`, JSON.stringify(finalSpecs, null, 2));

      // Generate embedding
      const searchKey = generateSearchContext(
        productData.title,
        finalSpecs,
        productData.price,
        productData.shortDesc
      );
      const vector = await getEmbedding(searchKey);

      let fullDescription = productData.shortDesc || "";
      if (productData.fullDesc)
        fullDescription += `\n\n${productData.fullDesc}`;
      if (productData.care)
        fullDescription += `\n\nCare: ${productData.care.replace(/;/g, ", ")}`;

      // Save to database
      const record = await prisma.product.create({
        data: {
          title: productData.title,
          description: fullDescription.trim(),
          category: extracted.category,
          price: productData.price || 0,
          imageUrl: productData.imageUrl,
          stock: StockStatus.IN_STOCK,
          lastSeenAt: new Date(),
          brand: "Primark",
          specs: finalSpecs,
          searchKey: searchKey,
          storeName: STORE_NAME,
          productUrl: productData.productUrl,
          scrapedAt: new Date(),
        },
        select: { id: true, title: true },
      });

      stats.created++;
      console.log(`  ✅ CREATED: ${record.title.substring(0, 40)}...`);

      if (vector) {
        const vectorString = `[${vector.join(",")}]`;
        await prisma.$executeRaw`UPDATE "Product" SET "descriptionEmbedding" = ${vectorString}::vector WHERE id = ${record.id}`;
      }

      checkpoint.processedSkus.add(productData.uniqueKey);
      checkpoint.processedCount++;
      checkpoint.stats = stats;

      if (checkpoint.processedCount % CHECKPOINT_SAVE_INTERVAL === 0) {
        await saveCheckpoint(checkpoint);
      }
    }

    await saveCheckpoint(checkpoint);
  } catch (error) {
    console.error(`\n❌ Fatal: ${error.message}`);
    await saveCheckpoint(checkpoint);
    throw error;
  } finally {
    await page.close();
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`🎉 COMPLETE: ${categoryName}`);
  console.log(`${"=".repeat(60)}`);
  console.log(
    `✅ Created: ${stats.created} | ⏭️ Skipped: ${stats.skipped} | ❌ Errors: ${stats.errors}`
  );
  console.log(`${"=".repeat(60)}\n`);
}

export default scrapePrimarkProducts;
