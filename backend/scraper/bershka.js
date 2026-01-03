// bershka_with_deepfashion.js - Enhanced Bershka Scraper with DeepFashion Integration
// Extracts visual attributes from product images for better search accuracy

import { PrismaClient, StockStatus } from "@prisma/client";
import OpenAI from "openai";
import fs from "fs/promises";
import fetch from "node-fetch";

// --- GLOBAL CONFIGURATION ---
const prisma = new PrismaClient();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const STORE_NAME = "BERSHKA";
const CURRENCY = "KWD";
const BASE_URL = "https://www.bershka.com";
const DEEPFASHION_API_URL = process.env.DEEPFASHION_API_URL; // Your Modal endpoint

// --- OPTIMIZED CONCURRENCY & RATE LIMITING ---
const CONCURRENT_LIMIT = 2;
const LLM_MODEL = "gpt-4o-mini";
const BATCH_DELAY_MS = 3000;
const PAGE_LOAD_TIMEOUT = 60000;

// --- CHECKPOINT & CACHE FILES ---
const CHECKPOINT_FILE = "./bershka_import_checkpoint.json";
const CACHE_FILE = "./bershka_import_cache.json";
const CHECKPOINT_SAVE_INTERVAL = 5;

// --- RATE LIMITER TRACKING ---
const rateLimiter = {
  requestCount: 0,
  dailyRequestCount: 0,
  lastResetTime: Date.now(),
  consecutiveErrors: 0,
};

// -------------------------------------------------------------------
// --- SELECTORS FOR BERSHKA DOM ---
// -------------------------------------------------------------------

const SELECTORS = {
  // Product listing page - BE SPECIFIC TO AVOID BANNERS
  productCard: "li.grid-item.normal", // Product cards only, not banners
  productLink: "a.grid-card-link[href*='/kw/'][href*='-c0p']", // Must have product pattern
  loadMoreButton:
    ".pager-button-container button.pager-button, button.pager-button[rel='next'], button[aria-label*='more'], button[class*='load-more']",
  productCount: ".product-count, .results-count, [class*='product-count']",

  // Product card on listing page
  cardTitle: ".product-text p",
  cardCurrentPrice: ".current-price-elem--discounted, .current-price-elem",
  cardOldPrice: ".old-price-elem",
  cardDiscountTag: ".discount-tag",
  cardImage: ".product-image img[data-original]",
  cardColorSwatches: ".color-cuts.selectable li",
  cardMoreColors: ".more-colors.color-number",

  // Product detail page - UPDATED WITH ACTUAL BERSHKA SELECTORS
  pdpTitle: [
    "h1.product-detail-info-layout__title",
    ".product-detail-info-layout__title",
    "h1",
  ],
  pdpShortDesc: [
    ".product-short-description",
    ".short-description",
    ".product-description-short",
  ],
  pdpPrice: [
    ".current-price-elem--discounted",
    ".current-price-elem",
    ".product-detail-info-layout__price .current-price-elem",
  ],
  pdpOldPrice: [".old-price-elem", ".old-price-discount .old-price-elem"],
  pdpImage: [
    'img[data-qa-anchor="pdpMainImage"]', // PRIMARY: Bershka PDP grid images
    ".product-detail-gallery img[data-original]:not([class*='thumbnail'])",
    ".product-gallery__main img[data-original]",
    ".main-image img[data-original]",
    "img[data-original*='bershka'][alt]:not([src*='-r.jpg'])", // Avoid thumbnails (-r suffix)
    "img[data-original*='bershka']",
  ],
  pdpDescriptionContent: [
    ".product-description-content",
    ".product-details",
    ".description-content",
  ],
  pdpColorReference: ".product-reference", // Contains "Dark grey · Ref. 5424/046/829"
  pdpColorList: ".round-color-picker__colors li",
  pdpColorLabel: ".round-color-picker__link[aria-selected='true']", // Selected color
  pdpSizeList: ".ui--size-dot-list .ui--dot-item .text__label",
  pdpSizeButtons: ".ui--size-dot-list .ui--dot-item",
  pdpMaterialButton:
    "button:has(.extended-area-action) span:contains('Materials')",
  pdpCare: ".care-instructions, .product-care",
  pdpMaterial: ".composition, .material-info, [class*='composition']",
  pdpSku: ".product-reference", // Same as color reference, contains SKU
  pdpDiscountTag: ".discount-tag .bds-tag__text",
};

// -------------------------------------------------------------------
// --- HELPER FUNCTIONS ---
// -------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildProductUrl(href) {
  if (!href) return null;
  if (href.startsWith("http")) return href;
  const cleanHref = href.startsWith("/") ? href : `/${href}`;
  return `${BASE_URL}${cleanHref}`;
}

// -------------------------------------------------------------------
// --- DEEPFASHION IMAGE ANALYSIS ---
// -------------------------------------------------------------------

/**
 * Download image from URL and convert to base64
 */
async function downloadImageAsBase64(imageUrl) {
  try {
    console.log(`     📥 Downloading image...`);
    const response = await fetch(imageUrl);

    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64 = buffer.toString("base64");

    console.log(
      `     ✅ Image downloaded: ${(buffer.length / 1024).toFixed(1)} KB`
    );
    return base64;
  } catch (error) {
    console.error(`     ❌ Image download failed: ${error.message}`);
    return null;
  }
}

/**
 * Extract fashion attributes from product image using DeepFashion model
 */
async function extractAttributesFromImage(imageUrl) {
  console.log(`     🎨 [DEEPFASHION] Analyzing product image...`);

  if (!DEEPFASHION_API_URL) {
    console.log(`     ⚠️  DeepFashion API URL not configured - skipping`);
    return { success: false, attributes: {} };
  }

  try {
    // Download image as base64
    const imageBase64 = await downloadImageAsBase64(imageUrl);

    if (!imageBase64) {
      return { success: false, attributes: {} };
    }

    // Call DeepFashion Modal API
    console.log(`     🔮 Calling DeepFashion API...`);
    const response = await fetch(DEEPFASHION_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
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

    console.log(`     ✅ Visual attributes extracted:`);
    console.log(`        📂 Category: ${attributes.category || "N/A"}`);
    console.log(`        🎨 Color: ${attributes.color || "N/A"}`);
    console.log(`        👤 Gender: ${attributes.gender || "N/A"}`);
    if (attributes.sleeveLength)
      console.log(`        👕 Sleeve: ${attributes.sleeveLength}`);
    if (attributes.pattern)
      console.log(`        🔲 Pattern: ${attributes.pattern}`);
    if (attributes.neckline)
      console.log(`        👔 Neckline: ${attributes.neckline}`);
    if (attributes.length)
      console.log(`        📏 Length: ${attributes.length}`);

    return {
      success: true,
      attributes: attributes,
    };
  } catch (error) {
    console.error(`     ❌ DeepFashion analysis failed: ${error.message}`);
    return {
      success: false,
      attributes: {},
      error: error.message,
    };
  }
}

/**
 * Merge DeepFashion attributes with scraped specs
 * DeepFashion attributes take priority for visual properties
 */
function mergeAttributes(scrapedSpecs, deepFashionAttributes) {
  const merged = { ...scrapedSpecs };

  if (deepFashionAttributes.color) {
    // DeepFashion color overrides scraped color (visual is more accurate)
    merged.color = deepFashionAttributes.color.toLowerCase();
    console.log(`     🎨 Using DeepFashion color: ${merged.color}`);
  }

  if (deepFashionAttributes.gender) {
    // Normalize gender
    const genderMap = {
      male: "men",
      men: "men",
      female: "women",
      women: "women",
      boys: "boys",
      girls: "girls",
      unisex: "unisex",
      kids: "kids",
    };
    merged.gender =
      genderMap[deepFashionAttributes.gender.toLowerCase()] ||
      deepFashionAttributes.gender.toLowerCase();
    console.log(`     👤 Using DeepFashion gender: ${merged.gender}`);
  }

  if (deepFashionAttributes.pattern) {
    merged.pattern = deepFashionAttributes.pattern.toLowerCase();
    console.log(`     🔲 Using DeepFashion pattern: ${merged.pattern}`);
  }

  if (deepFashionAttributes.sleeveLength) {
    merged.sleeve_length = deepFashionAttributes.sleeveLength.toLowerCase();
    console.log(`     👕 Added sleeve length: ${merged.sleeve_length}`);
  }

  if (deepFashionAttributes.neckline) {
    merged.neckline = deepFashionAttributes.neckline.toLowerCase();
    console.log(`     👔 Added neckline: ${merged.neckline}`);
  }

  if (deepFashionAttributes.length) {
    merged.length = deepFashionAttributes.length.toLowerCase();
    console.log(`     📏 Added length: ${merged.length}`);
  }

  // Map DeepFashion category to product type if not already set
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
      sneakers: "sneakers",
      boots: "boots",
      sandals: "sandals",
      heels: "heels",
      bag: "bag",
      backpack: "backpack",
    };

    const mappedType = typeMap[deepFashionAttributes.category.toLowerCase()];
    if (mappedType) {
      merged.type = mappedType;
      console.log(`     📝 Mapped type from DeepFashion: ${merged.type}`);
    }
  }

  return merged;
}

// -------------------------------------------------------------------
// --- PERSISTENT CACHE SYSTEM ---
// -------------------------------------------------------------------

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

// -------------------------------------------------------------------
// --- CHECKPOINT FUNCTIONS ---
// -------------------------------------------------------------------

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
    console.log(
      `   💾 Checkpoint saved (${checkpoint.processedCount} products)`
    );
    await saveCache();
  } catch (error) {
    console.error(`   ⚠️ Failed to save checkpoint: ${error.message}`);
  }
}

// -------------------------------------------------------------------
// --- SMART RETRY WRAPPER ---
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

// -------------------------------------------------------------------
// --- AI EXTRACTION ---
// -------------------------------------------------------------------

const EXTRACTION_PROMPT = `
You are a Fashion Data Extraction AI for Bershka products.

**OUTPUT:**
{
  "category": "CLOTHING|FOOTWEAR|ACCESSORIES",
  "specs": {
    "type": "product type (MANDATORY - jeans, t-shirt, trousers, etc.)",
    "gender": "men|women|kids|unisex",
    "fit": "baggy|slim|regular|wide leg|etc",
    "rise": "low rise|mid rise|high rise",
    "material": "cotton|denim|polyester|corduroy|etc",
    "pattern": "solid|striped|etc",
    "style": "jeans|trousers|casual|etc"
  }
}

RULES:
- ALL lowercase
- Extract fit/rise from title (e.g., "Super Baggy Corduroy" → fit: "baggy", material: "corduroy")
- Extract material from description (e.g., "100% cotton" → material: "100% cotton")
- Return ONLY valid JSON
`;

async function extractProductSpecs(title, shortDesc, fullDesc, scrapedData) {
  const cacheKey = title.toLowerCase().substring(0, 80);
  if (persistentCache.categoryDetection[cacheKey]) {
    console.log(`  💾 Using cached extraction`);
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
      if (scrapedData.material)
        extracted.specs.material = scrapedData.material.toLowerCase();
      if (scrapedData.discount) extracted.specs.discount = scrapedData.discount;
      if (scrapedData.oldPrice)
        extracted.specs.old_price = scrapedData.oldPrice;
    }

    persistentCache.categoryDetection[cacheKey] = extracted;
    return extracted;
  } catch (error) {
    console.error(`  ⚠️ AI failed: ${error.message}`);
    const specs = {
      type: title.toLowerCase().includes("jeans")
        ? "jeans"
        : title.toLowerCase().includes("trouser")
        ? "trousers"
        : "clothing",
    };
    if (scrapedData?.color) specs.color = scrapedData.color.toLowerCase();
    if (scrapedData?.sku) specs.sku = scrapedData.sku;
    return { category: "CLOTHING", specs };
  }
}

// -------------------------------------------------------------------
// --- EMBEDDING ---
// -------------------------------------------------------------------

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
  let context = `Bershka ${title}.`;
  const specString = Object.entries(specs)
    .filter(([k, v]) => v && !["sku", "available_sizes"].includes(k))
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");
  if (specString) context += ` Specs: ${specString}.`;
  context += ` Price: ${price} ${CURRENCY}.`;
  if (description) context += ` ${description.substring(0, 200)}`;
  return context;
}

// -------------------------------------------------------------------
// --- POPUP/BANNER DISMISSAL ---
// -------------------------------------------------------------------

async function dismissPopupsAndBanners(page) {
  try {
    await page.evaluate(() => {
      // 1. Cookie banner - click accept
      const cookieAccept = document.querySelector(
        '#cookie-accept-button, .cookie-accept, [id*="cookie"] button, .cookie-banner button, button[aria-label*="accept"]'
      );
      if (cookieAccept) {
        cookieAccept.click();
      }

      // 2. Subscription popup - click close
      const subboxClose = document.querySelector(
        ".subbox-close, .modal-close, .popup-close, [aria-label*='close']"
      );
      if (subboxClose) {
        subboxClose.click();
      }

      // 3. Remove overlay elements
      const overlays = document.querySelectorAll(
        '.cookie-banner, .modal, .popup, [class*="modal-backdrop"], [class*="overlay"]'
      );
      overlays.forEach((el) => {
        if (el && el.style) el.style.display = "none";
      });

      // 4. Remove fixed position popups
      const fixedElements = document.querySelectorAll(
        '[style*="position: fixed"], [style*="position:fixed"]'
      );
      fixedElements.forEach((el) => {
        const text = el.textContent?.toLowerCase() || "";
        if (
          text.includes("cookie") ||
          text.includes("subscribe") ||
          text.includes("sign up") ||
          text.includes("newsletter")
        ) {
          el.style.display = "none";
        }
      });
    });

    await sleep(500);
  } catch (e) {
    // Ignore - popups might not exist
  }
}

// -------------------------------------------------------------------
// --- SCRAPING FUNCTIONS ---
// -------------------------------------------------------------------

/**
 * Scroll to bottom of page
 */
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

/**
 * Scroll-based infinite loading for Bershka
 * Bershka uses infinite scroll - products load as you scroll down
 */
async function loadAllProductsByScrolling(page) {
  console.log(`   📜 Loading products via infinite scroll...`);

  let previousCount = 0;
  let stableCount = 0;
  const maxStableChecks = 3; // If count doesn't change 3 times, we're done
  const scrollAttempts = 50; // Maximum scroll attempts

  for (let i = 0; i < scrollAttempts; i++) {
    // Scroll to bottom
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });

    console.log(`   🔄 Scroll ${i + 1}: Waiting for products to load...`);
    await sleep(2000); // Wait for products to load

    // Count current product cards (not links - avoids counting banners)
    const currentCount = await page.evaluate((selector) => {
      return document.querySelectorAll(selector).length;
    }, SELECTORS.productCard);

    console.log(`   📦 Products visible: ${currentCount}`);

    // Check if count changed
    if (currentCount === previousCount) {
      stableCount++;
      console.log(`   ⏸️  Count stable (${stableCount}/${maxStableChecks})`);

      if (stableCount >= maxStableChecks) {
        console.log(
          `   ✅ No new products after ${maxStableChecks} checks - done!`
        );
        break;
      }
    } else {
      stableCount = 0; // Reset if we got new products
      console.log(
        `   ⬆️  Products increased: ${previousCount} → ${currentCount}`
      );
    }

    previousCount = currentCount;

    // Dismiss popups after each scroll
    await page.evaluate(() => {
      const overlays = document.querySelectorAll(
        '.cookie-banner, .modal, .popup, [class*="modal-backdrop"], [class*="overlay"]'
      );
      overlays.forEach((el) => {
        if (el && el.style) el.style.display = "none";
      });
    });
  }

  console.log(`   ✅ Final product count: ${previousCount}`);
  return previousCount;
}

/**
 * Extract product URLs from category listing page
 * FIXED: No longer extracts listing images - only URLs and titles
 */
async function scrapeProductListings(page, categoryUrl) {
  console.log(`\n📋 Scraping listings from: ${categoryUrl}`);

  await page.goto(categoryUrl, {
    waitUntil: "domcontentloaded", // Faster than networkidle2
    timeout: 90000, // Increased to 90 seconds
  });
  await sleep(3000); // Give extra time for dynamic content

  // Dismiss any popups first
  await dismissPopupsAndBanners(page);

  // Wait for initial products to load
  await page
    .waitForSelector(SELECTORS.productCard, { timeout: 15000 })
    .catch(() => {
      console.log(`   ⚠️ Products not found immediately, continuing...`);
    });

  // Get initial product count
  const initialCount = await page.evaluate((selector) => {
    return document.querySelectorAll(selector).length;
  }, SELECTORS.productCard);

  console.log(`   📦 Initial products found: ${initialCount}`);

  // Load ALL products by scrolling (Bershka uses infinite scroll)
  await loadAllProductsByScrolling(page);

  // Final count
  const finalCount = await page.evaluate((selector) => {
    return document.querySelectorAll(selector).length;
  }, SELECTORS.productCard);

  console.log(`   📦 Total products after loading all: ${finalCount}`);

  // Extract only product URLs and titles (NO images from listing page)
  console.log(`   🔍 Extracting product URLs from ${SELECTORS.productCard}...`);

  const products = await page.evaluate((selectors) => {
    const results = [];

    // Get only actual product cards (li.grid-item.normal), not banners
    const productCards = document.querySelectorAll(selectors.productCard);
    const seen = new Set();

    if (productCards.length === 0) {
      console.log("❌ No product cards found!");
      return [];
    }

    productCards.forEach((card, index) => {
      // Find the product link inside this card
      const link = card.querySelector('a.grid-card-link[href*="-c0p"]');
      if (!link) return;

      let href = link.getAttribute("href");
      if (!href || seen.has(href)) return;

      // Must be a real product URL with -c0p pattern
      if (!href.includes("-c0p")) return;

      seen.add(href);

      // Extract title from product card
      let title = "Unknown";
      const titleEl = link.querySelector(
        '.product-text p, [data-qa-anchor="productItemText"] p'
      );
      if (titleEl) {
        title = titleEl.textContent.trim();
      }

      // Fallback: Extract from URL
      if (title === "Unknown") {
        const urlMatch = href.match(/\/([^\/]+)-c0p\d+\.html/);
        if (urlMatch) {
          title = urlMatch[1]
            .replace(/-/g, " ")
            .replace(/\b\w/g, (c) => c.toUpperCase());
        }
      }

      results.push({
        href,
        title,
      });
    });

    return results;
  }, SELECTORS);

  console.log(`   ✅ Found ${products.length} unique product links`);

  return products.map((p) => ({
    productUrl: buildProductUrl(p.href),
    title: p.title,
  }));
}

/**
 * Scrape detailed product information from PDP
 * FIXED: Only uses PDP grid images (data-qa-anchor="pdpMainImage")
 */
async function scrapeProductDetails(page, productUrl) {
  console.log(`  📄 Scraping: ${productUrl.substring(0, 70)}...`);

  const maxRetries = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`     🔄 Attempt ${attempt}/${maxRetries}`);

      await page.goto(productUrl, {
        waitUntil: "domcontentloaded", // Faster than networkidle2
        timeout: 90000, // 90 seconds
      });

      // Give page time to render dynamic content
      await sleep(2000);

      // Dismiss popups FIRST
      await dismissPopupsAndBanners(page);
      await sleep(1000);

      // Check if content loaded
      const contentLoaded = await page.evaluate(() => {
        const hasTitle = document.querySelector('h1, [class*="title"]');
        const hasPrice = document.querySelector('[class*="price"]');
        const hasImage = document.querySelector(
          'img[data-qa-anchor="pdpMainImage"]'
        );
        return !!(hasTitle || hasPrice || hasImage);
      });

      if (!contentLoaded) {
        console.log(`     ⚠️ Content not loaded yet, waiting longer...`);
        await sleep(3000);
        await dismissPopupsAndBanners(page);
      }

      // If we got here, navigation succeeded - break retry loop
      break;
    } catch (error) {
      lastError = error;
      console.log(`     ⚠️ Attempt ${attempt} failed: ${error.message}`);

      if (attempt === maxRetries) {
        console.error(
          `   ❌ Failed after ${maxRetries} attempts: ${error.message}`
        );
        return null;
      }

      console.log(`     ⏳ Waiting before retry...`);
      await sleep(3000);
    }
  }

  // Now extract product data
  try {
    // Expand Product Details accordion (if exists)
    await page.evaluate(() => {
      const accordion = document.querySelector(
        'details[class*="description"], details[class*="product-detail"]'
      );
      if (accordion && !accordion.hasAttribute("open")) {
        accordion.setAttribute("open", "");
      }
    });
    await sleep(300);

    // Extract product data
    const productData = await page.evaluate((selectors) => {
      const data = {
        title: null,
        shortDesc: null,
        fullDesc: null,
        price: 0,
        oldPrice: null,
        discount: null,
        imageUrl: null,
        color: null,
        pattern: null,
        style: null,
        sku: null,
        care: null,
        material: null,
        availableSizes: [],
        allColors: [], // All available colors for this product
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

      // Title
      const titleEl = trySelect(selectors.pdpTitle);
      if (titleEl) data.title = titleEl.textContent.trim();

      // Short Description
      const shortDescEl = trySelect(selectors.pdpShortDesc);
      if (shortDescEl) data.shortDesc = shortDescEl.textContent.trim();

      // Full Description
      const fullDescEl = trySelect(selectors.pdpDescriptionContent);
      if (fullDescEl) data.fullDesc = fullDescEl.textContent.trim();

      // Price (current/discounted)
      const priceEl = trySelect(selectors.pdpPrice);
      if (priceEl) {
        const priceText = priceEl.textContent.replace(/\u00a0/g, " ").trim();
        const priceMatch = priceText.match(/[\d.]+/);
        data.price = priceMatch ? parseFloat(priceMatch[0]) : 0;
      }

      // Old Price (if discounted)
      const oldPriceEl = trySelect(selectors.pdpOldPrice);
      if (oldPriceEl) {
        const oldPriceText = oldPriceEl.textContent
          .replace(/\u00a0/g, " ")
          .trim();
        const oldPriceMatch = oldPriceText.match(/[\d.]+/);
        data.oldPrice = oldPriceMatch ? parseFloat(oldPriceMatch[0]) : null;
      }

      // Discount percentage
      const discountEl = document.querySelector(selectors.pdpDiscountTag);
      if (discountEl) {
        data.discount = discountEl.textContent.trim(); // e.g., "-30%"
      }

      // Color and SKU from product reference
      // Format: "Dark grey · Ref. 5424/046/829"
      const colorRefEl = document.querySelector(selectors.pdpColorReference);
      if (colorRefEl) {
        const refText = colorRefEl.textContent.trim();
        const parts = refText.split("·").map((p) => p.trim());
        if (parts.length >= 2) {
          data.color = parts[0]; // "Dark grey"
          const skuPart = parts[1].replace(/Ref\.\s*/i, ""); // "5424/046/829"
          data.sku = skuPart;
        }
      }

      // All available colors
      const colorEls = document.querySelectorAll(selectors.pdpColorList);
      colorEls.forEach((colorEl) => {
        const colorLink = colorEl.querySelector("a");
        if (colorLink) {
          const colorName = colorLink.getAttribute("aria-label");
          const colorHref = colorLink.getAttribute("href");
          if (colorName) {
            data.allColors.push({
              name: colorName,
              url: colorHref,
            });
          }
        }
      });

      // FIXED: Image - Get ONLY from PDP grid images (data-qa-anchor="pdpMainImage")
      const imgEl = trySelect(selectors.pdpImage);
      if (imgEl) {
        let imgSrc =
          imgEl.getAttribute("data-original") ||
          imgEl.getAttribute("src") ||
          imgEl.src;

        // Make sure we got a valid Bershka image URL
        if (imgSrc && imgSrc.includes("bershka.net")) {
          // Clean up and request high quality
          if (imgSrc.includes("?")) {
            imgSrc = imgSrc.split("?")[0] + "?w=1920&f=auto";
          }
          data.imageUrl = imgSrc;
        }
      }

      // Sizes - get only available sizes (not disabled)
      const sizeButtons = document.querySelectorAll(selectors.pdpSizeButtons);
      sizeButtons.forEach((btn) => {
        const isDisabled =
          btn.hasAttribute("disabled") ||
          btn.getAttribute("aria-disabled") === "true" ||
          btn.classList.contains("is-disabled");

        if (!isDisabled) {
          const sizeLabel = btn.querySelector(".text__label");
          if (sizeLabel) {
            const size = sizeLabel.textContent.trim();
            if (size) data.availableSizes.push(size);
          }
        }
      });

      // Material/Composition - may need to click accordion to expand
      const materialEl = trySelect(selectors.pdpMaterial);
      if (materialEl) data.material = materialEl.textContent.trim();

      // Care instructions
      const careEl = trySelect(selectors.pdpCare);
      if (careEl) data.care = careEl.textContent.trim();

      return data;
    }, SELECTORS);

    // Retry if no title found
    if (!productData.title) {
      console.log(
        `     ⚠️ Title not found - retrying after removing overlays...`
      );

      await page.evaluate(() => {
        const blockers = document.querySelectorAll(
          '.cookie-banner, .modal, .popup, [class*="modal"], [class*="overlay"], [class*="backdrop"]'
        );
        blockers.forEach((el) => el.remove());
      });
      await sleep(500);

      const retryData = await page.evaluate((selectors) => {
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

        return {
          title: trySelect(selectors.pdpTitle)?.textContent.trim() || null,
          price:
            parseFloat(
              trySelect(selectors.pdpPrice)
                ?.textContent.replace(/[^\d.]/g, "")
                .trim()
            ) || 0,
          imageUrl:
            trySelect(selectors.pdpImage)?.getAttribute("data-original") ||
            trySelect(selectors.pdpImage)?.src ||
            null,
          sku: trySelect(selectors.pdpSku)?.textContent.trim() || null,
        };
      }, SELECTORS);

      if (retryData.title) {
        productData.title = retryData.title;
        productData.price = retryData.price || productData.price;
        productData.imageUrl = retryData.imageUrl || productData.imageUrl;
        productData.sku = retryData.sku || productData.sku;
        console.log(
          `     ✅ Retry successful: ${productData.title.substring(0, 30)}...`
        );
      }
    }

    return { ...productData, productUrl };
  } catch (error) {
    console.error(`   ❌ Failed: ${error.message}`);
    return null;
  }
}

// -------------------------------------------------------------------
// --- MAIN SCRAPER FUNCTION ---
// -------------------------------------------------------------------

async function scrapeBershkaProducts(browser, categoryUrl, categoryName) {
  await loadCache();
  const checkpoint = await loadCheckpoint();
  let stats = { ...checkpoint.stats };

  const page = await browser.newPage();

  try {
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    // Block unnecessary resources
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      if (["font", "media"].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });

    console.log(`\n${"=".repeat(70)}`);
    console.log(`🏪 BERSHKA SCRAPER WITH DEEPFASHION INTEGRATION`);
    console.log(`${"=".repeat(70)}`);
    console.log(`   Category: ${categoryName}`);
    console.log(`   URL: ${categoryUrl}`);
    console.log(
      `   DeepFashion: ${DEEPFASHION_API_URL ? "✅ Enabled" : "❌ Disabled"}`
    );
    console.log(`${"=".repeat(70)}\n`);

    const listings = await scrapeProductListings(page, categoryUrl);

    if (listings.length === 0) {
      console.log("⚠️ No products found");
      return;
    }

    console.log(`\n📊 Total products to process: ${listings.length}\n`);

    for (let i = 0; i < listings.length; i++) {
      const listing = listings[i];

      console.log(
        `\n[${i + 1}/${listings.length}] 🔍 ${listing.title.substring(
          0,
          50
        )}...`
      );
      console.log(`     URL: ${listing.productUrl}`);

      const productData = await scrapeProductDetails(page, listing.productUrl);

      if (!productData || !productData.title) {
        console.log(`  ❌ No title - skipping`);
        stats.errors++;
        continue;
      }

      if (!productData.imageUrl) {
        console.log(`  ❌ No image found on PDP - skipping`);
        stats.skipped++;
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

      // Check DB
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
      console.log(`     Price: ${productData.price} KWD | SKU: ${sku}`);
      if (productData.oldPrice) {
        console.log(
          `     Old Price: ${productData.oldPrice} KWD ${
            productData.discount ? `(${productData.discount})` : "(DISCOUNTED)"
          }`
        );
      }
      if (productData.availableSizes?.length) {
        console.log(`     Sizes: ${productData.availableSizes.join(", ")}`);
      }
      if (productData.allColors?.length > 1) {
        console.log(
          `     Available Colors: ${productData.allColors
            .map((c) => c.name)
            .join(", ")}`
        );
      }

      // 🎨 STEP 1: Extract visual attributes from image using DeepFashion
      console.log(`\n  🎨 [DEEPFASHION] Analyzing product image...`);
      const visualAnalysis = await extractAttributesFromImage(
        productData.imageUrl
      );

      // 🤖 STEP 2: Extract specs from text using LLM
      console.log(`  🤖 Extracting specs from text...`);
      const extracted = await extractProductSpecs(
        productData.title,
        productData.shortDesc,
        productData.fullDesc,
        {
          color: productData.color,
          pattern: productData.pattern,
          style: productData.style,
          sku: sku,
          availableSizes: productData.availableSizes?.join(", "),
          material: productData.material,
          discount: productData.discount,
          oldPrice: productData.oldPrice,
        }
      );

      // 🔀 STEP 3: Merge visual attributes with text-based specs
      console.log(`  🔀 Merging visual + text attributes...`);
      const finalSpecs = visualAnalysis.success
        ? mergeAttributes(extracted.specs, visualAnalysis.attributes)
        : extracted.specs;

      console.log(`  ✅ Final specs:`, JSON.stringify(finalSpecs, null, 2));

      // 🤖 STEP 4: Generate embedding with enriched specs
      console.log(`  🤖 Generating embedding...`);
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
      if (productData.material)
        fullDescription += `\n\nMaterial: ${productData.material}`;
      if (productData.care)
        fullDescription += `\n\nCare: ${productData.care.replace(/;/g, ", ")}`;

      console.log(`  💾 Saving to database...`);
      const record = await prisma.product.create({
        data: {
          title: productData.title,
          description: fullDescription.trim(),
          category: extracted.category,
          price: productData.price || 0,
          imageUrl: productData.imageUrl,
          stock: StockStatus.IN_STOCK,
          lastSeenAt: new Date(),
          brand: "Bershka",
          specs: finalSpecs, // ✅ Now includes DeepFashion visual attributes
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

      checkpoint.processedSkus.add(uniqueKey);
      checkpoint.processedCount++;
      checkpoint.stats = stats;

      if (checkpoint.processedCount % CHECKPOINT_SAVE_INTERVAL === 0) {
        await saveCheckpoint(checkpoint);
      }

      await sleep(1500);
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

export default scrapeBershkaProducts;

// // --- STANDALONE TESTING ---
// import puppeteer from "puppeteer";

// async function testRun() {
//   const browser = await puppeteer.launch({
//     headless: true,
//     args: ["--no-sandbox", "--disable-setuid-sandbox"],
//   });

//   try {
//     await scrapeBershkaProducts(
//       browser,
//       "https://www.bershka.com/kw/men/sale/trousers-and-jeans-c1010747956.html",
//       "MEN_SALE_TROUSERS_JEANS"
//     );
//   } finally {
//     await browser.close();
//     await prisma.$disconnect();
//   }
// }

// testRun().catch(console.error);
