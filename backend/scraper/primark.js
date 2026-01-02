// primark.js - Primark E-commerce Store Scraper (FIXED v3)
// Handles cookie banners, subscription popups, and "Load more products" pagination

import { PrismaClient, StockStatus } from "@prisma/client";
import OpenAI from "openai";
import fs from "fs/promises";

// --- GLOBAL CONFIGURATION ---
const prisma = new PrismaClient();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const STORE_NAME = "PRIMARK";
const CURRENCY = "KWD";
const BASE_URL = "https://www.primark.com.kw";

// --- OPTIMIZED CONCURRENCY & RATE LIMITING ---
const CONCURRENT_LIMIT = 2;
const LLM_MODEL = "gpt-4o-mini";
const BATCH_DELAY_MS = 3000;
const PAGE_LOAD_TIMEOUT = 60000;

// --- CHECKPOINT & CACHE FILES ---
const CHECKPOINT_FILE = "./primark_import_checkpoint.json";
const CACHE_FILE = "./primark_import_cache.json";
const CHECKPOINT_SAVE_INTERVAL = 5;

// --- RATE LIMITER TRACKING ---
const rateLimiter = {
  requestCount: 0,
  dailyRequestCount: 0,
  lastResetTime: Date.now(),
  consecutiveErrors: 0,
};

// -------------------------------------------------------------------
// --- SELECTORS FOR PRIMARK DOM ---
// -------------------------------------------------------------------

const SELECTORS = {
  // Product listing page
  productLink: "a[href*='/buy-']",
  loadMoreButton:
    ".pager-button-container button.pager-button, button.pager-button[rel='next']",
  productCount: ".product-count, .results-count, [class*='product-count']",

  // Product detail page - MULTIPLE FALLBACKS
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
You are a Fashion Data Extraction AI for Primark products.

**OUTPUT:**
{
  "category": "CLOTHING|FOOTWEAR|ACCESSORIES",
  "specs": {
    "type": "product type (MANDATORY - jeans, t-shirt, etc.)",
    "gender": "men|women|kids|unisex",
    "fit": "baggy|slim|regular|barrel leg|etc",
    "rise": "low rise|mid rise|high rise",
    "material": "cotton|denim|polyester|etc",
    "pattern": "solid|striped|etc",
    "style": "jeans|trousers|casual|etc"
  }
}

RULES:
- ALL lowercase
- Extract fit/rise from title (e.g., "Mid Rise Baggy" → rise: "mid rise", fit: "baggy")
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

// -------------------------------------------------------------------
// --- POPUP/BANNER DISMISSAL ---
// -------------------------------------------------------------------

async function dismissPopupsAndBanners(page) {
  try {
    await page.evaluate(() => {
      // 1. Cookie banner - click accept
      const cookieAccept = document.querySelector(
        '#cookie-accept-button, .cookie-accept, [id*="cookie"] button, .cookie-banner button'
      );
      if (cookieAccept) {
        cookieAccept.click();
      }

      // 2. Subscription popup - click close
      const subboxClose = document.querySelector(
        ".subbox-close, .subbox-subscription-dialog .subbox-close-cross"
      );
      if (subboxClose) {
        subboxClose.click();
      }

      // 3. Remove overlay elements
      const overlays = document.querySelectorAll(
        '.cookie-banner, .subbox-banner, .subbox-subscription-dialog, .subbox-banner-backdrop, [class*="modal-backdrop"], [class*="overlay"]'
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
 * Click "Load more products" button until all products are loaded
 */
async function loadAllProducts(page) {
  let loadMoreClicks = 0;
  const maxClicks = 50; // Safety limit

  while (loadMoreClicks < maxClicks) {
    // Scroll to bottom first to make the button visible
    await scrollToBottom(page);
    await sleep(1000);

    // Check if "Load more products" button exists and is visible
    const loadMoreButton = await page.$(SELECTORS.loadMoreButton);

    if (!loadMoreButton) {
      console.log(`   ✅ No more "Load more" button - all products loaded`);
      break;
    }

    // Check if button is visible/clickable
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
      console.log(
        `   ✅ "Load more" button no longer visible - all products loaded`
      );
      break;
    }

    // Get current product count before clicking
    const beforeCount = await page.evaluate((selector) => {
      return document.querySelectorAll(selector).length;
    }, SELECTORS.productLink);

    // Click the button
    try {
      await page.evaluate((selector) => {
        const btn = document.querySelector(selector);
        if (btn) {
          btn.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, SELECTORS.loadMoreButton);

      await sleep(500);

      await page.click(SELECTORS.loadMoreButton);
      loadMoreClicks++;

      console.log(
        `   🔄 Clicked "Load more" (${loadMoreClicks}) - waiting for products...`
      );

      // Wait for new products to load
      await sleep(2000);

      // Wait until product count increases or timeout
      let waitAttempts = 0;
      const maxWaitAttempts = 10;

      while (waitAttempts < maxWaitAttempts) {
        const afterCount = await page.evaluate((selector) => {
          return document.querySelectorAll(selector).length;
        }, SELECTORS.productLink);

        if (afterCount > beforeCount) {
          console.log(`   📦 Products: ${beforeCount} → ${afterCount}`);
          break;
        }

        await sleep(500);
        waitAttempts++;
      }

      // Dismiss any popups that might appear
      await dismissPopupsAndBanners(page);
    } catch (error) {
      console.log(`   ⚠️ Could not click "Load more": ${error.message}`);
      break;
    }
  }

  if (loadMoreClicks >= maxClicks) {
    console.log(`   ⚠️ Reached max load more clicks (${maxClicks})`);
  }

  // Final scroll to ensure everything is loaded
  await scrollToBottom(page);
  await sleep(1000);
}

/**
 * Extract product URLs from category listing page
 */
async function scrapeProductListings(page, categoryUrl) {
  console.log(`\n📋 Scraping listings from: ${categoryUrl}`);

  await page.goto(categoryUrl, {
    waitUntil: "networkidle2",
    timeout: PAGE_LOAD_TIMEOUT,
  });
  await sleep(2000);

  // Dismiss any popups first
  await dismissPopupsAndBanners(page);

  // Wait for initial products to load
  await page
    .waitForSelector(SELECTORS.productLink, { timeout: 15000 })
    .catch(() => {
      console.log(`   ⚠️ Products not found immediately, continuing...`);
    });

  // Get initial product count
  const initialCount = await page.evaluate((selector) => {
    return document.querySelectorAll(selector).length;
  }, SELECTORS.productLink);

  console.log(`   📦 Initial products found: ${initialCount}`);

  // Load ALL products by clicking "Load more" button repeatedly
  console.log(`   📜 Loading all products...`);
  await loadAllProducts(page);

  // Final count
  const finalCount = await page.evaluate((selector) => {
    return document.querySelectorAll(selector).length;
  }, SELECTORS.productLink);

  console.log(`   📦 Total products after loading all: ${finalCount}`);

  // Extract all product links
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

  console.log(`   ✅ Found ${products.length} unique product links`);
  return products.map((p) => ({
    productUrl: buildProductUrl(p.href),
    title: p.title,
  }));
}

/**
 * Scrape detailed product information from PDP
 */
async function scrapeProductDetails(page, productUrl) {
  console.log(`  📄 Scraping: ${productUrl.substring(0, 70)}...`);

  try {
    await page.goto(productUrl, {
      waitUntil: "networkidle2",
      timeout: PAGE_LOAD_TIMEOUT,
    });

    // Dismiss popups FIRST
    await sleep(1500);
    await dismissPopupsAndBanners(page);
    await sleep(1000);

    // Check if content loaded
    const contentLoaded = await page.evaluate(() => {
      const hasTitle = document.querySelector('h6, h1, [class*="title"]');
      const hasPrice = document.querySelector('[class*="price"]');
      const hasImage = document.querySelector('img[src*="media.alshaya.com"]');
      return !!(hasTitle || hasPrice || hasImage);
    });

    if (!contentLoaded) {
      console.log(`     ⚠️ Waiting longer for content...`);
      await sleep(3000);
      await dismissPopupsAndBanners(page);
    }

    // Expand Product Details accordion
    await page.evaluate(() => {
      const accordion = document.querySelector(
        'details.pdp-product__description, details[class*="description"]'
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

      // Title
      const titleEl = trySelect(selectors.pdpTitle);
      if (titleEl) data.title = titleEl.textContent.trim();

      // Short Description
      const shortDescEl = trySelect(selectors.pdpShortDesc);
      if (shortDescEl) data.shortDesc = shortDescEl.textContent.trim();

      // Split if title contains shortDesc
      if (data.title && data.shortDesc && data.title.includes(data.shortDesc)) {
        data.title = data.title.replace(data.shortDesc, "").trim();
      }

      // Full Description
      const fullDescEl = trySelect(selectors.pdpDescriptionContent);
      if (fullDescEl) data.fullDesc = fullDescEl.textContent.trim();

      // Price
      const priceEl = trySelect(selectors.pdpPrice);
      if (priceEl) {
        const priceText = priceEl.textContent.replace(/\u00a0/g, " ").trim();
        const priceMatch = priceText.match(/[\d.]+/);
        data.price = priceMatch ? parseFloat(priceMatch[0]) : 0;
      }

      // Image
      const imgEl = trySelect(selectors.pdpImage);
      if (imgEl) {
        let imgSrc = imgEl.getAttribute("src") || imgEl.src;
        if (imgSrc && imgSrc.includes("?")) {
          imgSrc = imgSrc.split("?")[0] + "?width=1920";
        }
        data.imageUrl = imgSrc;
      }

      // Color
      const colorEl = trySelect(selectors.pdpColorLabel);
      if (colorEl) data.color = colorEl.textContent.trim();

      // Pattern
      const patternEl = document.querySelector(selectors.pdpPattern);
      if (patternEl) data.pattern = patternEl.textContent.trim();

      // Style
      const styleEl = document.querySelector(selectors.pdpStyle);
      if (styleEl) data.style = styleEl.textContent.trim();

      // SKU
      const skuEl = trySelect(selectors.pdpSku);
      if (skuEl) data.sku = skuEl.textContent.trim();

      // Care
      const careEl = document.querySelector(selectors.pdpCare);
      if (careEl) data.care = careEl.textContent.trim();

      // Sizes
      const sizeEls = document.querySelectorAll(selectors.pdpSizeList);
      sizeEls.forEach((el) => {
        const size = el.textContent.trim();
        const isDisabled =
          el.hasAttribute("disabled") || el.getAttribute("disabled") === "true";
        if (!isDisabled && size) data.availableSizes.push(size);
      });

      return data;
    }, SELECTORS);

    // Retry if no title found
    if (!productData.title) {
      console.log(
        `     ⚠️ Title not found - retrying after removing overlays...`
      );

      await page.evaluate(() => {
        const blockers = document.querySelectorAll(
          '.cookie-banner, .subbox-banner, .subbox-subscription-dialog, [class*="modal"], [class*="popup"], [class*="overlay"], [class*="backdrop"]'
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
              trySelect(selectors.pdpPrice)?.textContent.replace(/[^\d.]/g, "")
            ) || 0,
          imageUrl: trySelect(selectors.pdpImage)?.src || null,
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

    // Clean up title
    if (productData.title && productData.shortDesc) {
      if (productData.title.endsWith(productData.shortDesc)) {
        productData.title = productData.title
          .slice(0, -productData.shortDesc.length)
          .trim();
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

async function scrapePrimarkProducts(browser, categoryUrl, categoryName) {
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
    console.log(`🏪 PRIMARK SCRAPER`);
    console.log(`${"=".repeat(70)}`);
    console.log(`   Category: ${categoryName}`);
    console.log(`   URL: ${categoryUrl}`);
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
        console.log(`  ❌ No image - skipping`);
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
      if (productData.availableSizes?.length) {
        console.log(`     Sizes: ${productData.availableSizes.join(", ")}`);
      }

      console.log(`  🤖 AI extraction...`);
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
        }
      );

      console.log(`  🤖 Generating embedding...`);
      const searchKey = generateSearchContext(
        productData.title,
        extracted.specs,
        productData.price,
        productData.shortDesc
      );
      const vector = await getEmbedding(searchKey);

      let fullDescription = productData.shortDesc || "";
      if (productData.fullDesc)
        fullDescription += `\n\n${productData.fullDesc}`;
      if (productData.care)
        fullDescription += `\n\nCare: ${productData.care.replace(/;/g, ", ")}`;

      console.log(`  💾 Saving...`);
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
          specs: extracted.specs,
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

export default scrapePrimarkProducts;

// --- STANDALONE TESTING ---
import puppeteer from "puppeteer";

async function testRun() {
  const browser = await puppeteer.launch({
    headless: true, // Set to true for production
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    await scrapePrimarkProducts(
      browser,
      "https://www.primark.com.kw/en/shop-men/clothing/jeans/--physical_stores_codes-ra1_q737_prm",
      "CLOTHING"
    );
  } finally {
    await browser.close();
    await prisma.$disconnect();
  }
}

testRun().catch(console.error);
