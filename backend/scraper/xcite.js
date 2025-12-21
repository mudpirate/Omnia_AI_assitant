import puppeteer from "puppeteer";
import { PrismaClient, StockStatus, StoreName } from "@prisma/client";
import OpenAI from "openai";

// --- GLOBAL CONFIGURATION ---
const prisma = new PrismaClient();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const PRODUCT_SELECTOR = ".ProductList_tileWrapper__V1Z9h";
const SHOW_MORE_BUTTON_SELECTOR = "button.secondaryOnLight";
const MAX_CLICKS = 50;
const STORE_NAME_FIXED = StoreName.XCITE;
const DOMAIN = "https://www.xcite.com";
const MAX_RETRIES = 3;
const RETRY_DELAY = 5000;

// --- CONCURRENCY SETTING ---
const CONCURRENT_LIMIT = 3;
const LLM_MODEL = "gpt-4o-mini";

// --- ENHANCED SYSTEM PROMPT WITH STRICT NORMALIZATION ---
const SYSTEM_PROMPT = `
You are a strict Data Extraction AI for an E-commerce Database.
Your goal is to extract a flat JSON object of filtering attributes ("specs") from raw product data.

### 1. INPUT HIERARCHY (The "Triangle of Truth")
- **TIER 1 (Highest Authority):** PRODUCT TITLE. Trust this above all for determining the specific Variant (Color, Storage, Size, Model).
- **TIER 2 (High Detail):** SPECS TABLE. Use this for technical details missing from the title (Material, Voltage, Ingredients, Hz).
- **TIER 3 (Context):** DESCRIPTION. Use only as a fallback. NEVER use it to override the Title.

### 2. CRITICAL NORMALIZATION RULES (MANDATORY)
- **Keys:** Snake_case and lowercase ONLY (e.g., 'screen_size', 'ram', 'storage').
- **Values:** Lowercase strings (e.g., 'silver', not 'Silver' or 'SILVER').
- **Storage:** ALWAYS convert to 'gb' or 'tb' with NO spaces. Examples:
  * '256 GB' -> '256gb'
  * '1 TB' -> '1tb'
  * '512GB' -> '512gb'
  * '2TB' -> '2tb'
- **RAM:** ALWAYS convert to 'gb' with NO spaces. Examples:
  * '16 GB' -> '16gb'
  * '8GB' -> '8gb'
  * '32 GB RAM' -> '32gb'
- **Colors:** Normalize fancy marketing names to basic colors:
  * 'Midnight' -> 'black'
  * 'Starlight' -> 'silver'
  * 'Titanium Blue' -> 'blue'
  * 'Titanium Grey' -> 'gray'
  * 'Space Black' -> 'black'
  * 'Natural Titanium' -> 'silver'
- **Network:** Lowercase, no spaces: '5g', '4g', 'wifi', 'lte'
- **Variant:** Extract the model variant/suffix that appears AFTER the model number in the title.
  * Always lowercase, preserve spaces for multi-word variants
  * Common variants by brand:
    - Apple: "base", "plus", "pro", "pro max", "mini", "se"
    - Samsung: "base", "plus", "ultra", "fe", "fold", "flip"
    - Google: "base", "pro", "a", "fold"
    - OnePlus: "base", "pro", "r", "t", "nord"
    - Xiaomi: "base", "pro", "ultra", "lite"
    - Nothing: "base", "a"
    - Motorola: "edge", "edge pro", "g power", "razr ultra"
    - Honor: "base", "pro", "lite", "magic pro"
    - Oppo/Realme/Vivo: "find pro", "reno", "gt pro", "x pro"
  * If no variant suffix exists, use "base"
  * Examples:
    - "iPhone 15 Pro Max" → "pro max"
    - "Galaxy S24 Ultra" → "ultra"
    - "Pixel 8a" → "a"
    - "OnePlus 12R" → "r"
    - "Nothing Phone (2)" → "base"
    - "Galaxy Z Fold 5" → "fold"
    - "Xiaomi 14 Ultra" → "ultra"
    - "Moto Edge 40 Pro" → "edge pro"
- **Measurements:** Standardize units (no spaces):
  * '2 Liters' -> '2l'
  * '500 ML' -> '500ml'
  * '1.5 KG' -> '1.5kg'
  * '45mm' -> '45mm'

### 3. CATEGORY-SPECIFIC CRITICAL KEYS (MANDATORY)

**MOBILE PHONES** - MUST include these critical keys:
- \`ram\`: e.g., "6gb", "8gb", "12gb", "16gb"
- \`storage\`: e.g., "64gb", "128gb", "256gb", "512gb", "1tb"
- \`color\`: normalized color name
- \`network\`: e.g., "5g", "4g", "lte"
- \`variant\`: brand-specific variant suffix (see normalization rules above)
  * Apple: "base", "plus", "pro", "pro max", "mini", "se"
  * Samsung: "base", "plus", "ultra", "fe", "fold", "flip"
  * Google: "base", "pro", "a"
  * Others: extract the actual suffix from title
Optional keys: screen_size, battery, processor, camera, sim

Example (iPhone):
{
  "variant": "pro max",
  "ram": "12gb",
  "storage": "512gb",
  "color": "black",
  "network": "5g",
  "screen_size": "6.8in",
  "battery": "5000mah",
  "processor": "a17 pro",
  "camera": "200mp"
}

Example (Samsung):
{
  "variant": "ultra",
  "ram": "12gb",
  "storage": "256gb",
  "color": "titanium gray",
  "network": "5g",
  "screen_size": "6.8in",
  "processor": "snapdragon 8 gen 3"
}

Example (Google Pixel):
{
  "variant": "a",
  "ram": "8gb",
  "storage": "128gb",
  "color": "blue",
  "network": "5g",
  "screen_size": "6.1in"
}

**LAPTOPS** - MUST include these critical keys:
- \`ram\`: e.g., "8gb", "16gb", "32gb", "64gb"
- \`storage\`: e.g., "256gb", "512gb", "1tb", "2tb"
- \`processor\`: e.g., "m3 pro", "intel i7", "ryzen 7"
- \`screen_size\`: e.g., "13in", "14in", "15.6in", "16in"
Optional keys: graphics, os, color, keyboard

Example:
{
  "ram": "16gb",
  "storage": "512gb",
  "processor": "m3 pro",
  "screen_size": "14in",
  "graphics": "14-core gpu",
  "os": "macos",
  "color": "space black"
}

**TABLETS** - MUST include these critical keys:
- \`storage\`: e.g., "64gb", "128gb", "256gb", "512gb"
- \`connectivity\`: e.g., "wifi", "wifi + cellular"
- \`screen_size\`: e.g., "10.2in", "11in", "12.9in"
Optional keys: ram, color, processor, os

Example:
{
  "storage": "256gb",
  "connectivity": "wifi + cellular",
  "screen_size": "11in",
  "color": "blue",
  "processor": "m2"
}

**HEADPHONES** - MUST include these critical keys:
- \`type\`: e.g., "over-ear", "in-ear", "on-ear"
- \`connectivity\`: e.g., "wireless bluetooth", "wired", "wireless"
- \`color\`: normalized color name
Optional keys: noise_cancellation, battery_life, microphone

Example:
{
  "type": "over-ear",
  "connectivity": "wireless bluetooth",
  "color": "silver",
  "noise_cancellation": "active",
  "battery_life": "30 hours"
}

**SMARTWATCHES** - MUST include these critical keys:
- \`size\`: case size, e.g., "40mm", "44mm", "45mm"
- \`connectivity\`: e.g., "gps", "gps + cellular"
- \`color\`: normalized color name
Optional keys: case_material, strap_material, water_resistance

Example:
{
  "size": "45mm",
  "connectivity": "gps + cellular",
  "color": "black",
  "case_material": "aluminum",
  "strap_material": "sport band"
}

**CLOTHES/SHOES** - MUST include these critical keys:
- \`size\`: standardized format, e.g., "s", "m", "l", "xl" or "42", "43", "44"
- \`gender\`: e.g., "men", "women", "unisex", "kids"
- \`color\`: normalized color name
Optional keys: material, fit, style, pattern

Example:
{
  "size": "l",
  "gender": "men",
  "color": "white",
  "material": "cotton",
  "fit": "regular fit"
}

### 4. OUTPUT FORMAT RULES
- Return ONLY a flat JSON object
- ALL keys must be lowercase with underscores (snake_case)
- ALL values must be lowercase strings
- Do NOT include: Price, Stock, Store Name (stored separately)
- ALWAYS include the critical keys for the detected category
- If a critical key cannot be determined, set it to null but DO NOT omit it
- Do not hallucinate data - only extract what exists
- Additional non-critical keys are allowed but critical keys are MANDATORY
`;

// --- BRAND EXTRACTION PROMPT (AI-POWERED) ---
const BRAND_EXTRACTION_PROMPT = `
Extract the brand name from this product title.
Return ONLY a JSON object with a single "brand" field.
Rules:
- Return the actual brand/manufacturer name (e.g., "Apple", "Samsung", "Bose")
- If no brand is identifiable, return the first word of the title
- Be consistent with capitalization (e.g., "Apple" not "APPLE")
- Do not include model numbers or product types

Example outputs:
{"brand": "Apple"}
{"brand": "Samsung"}
{"brand": "Sony"}
`;

// -------------------------------------------------------------------
// --- HELPER FUNCTIONS ---
// -------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

// 🔥 AI-POWERED BRAND EXTRACTION (No hardcoded list)
async function extractBrandWithAI(title) {
  try {
    const completion = await openai.chat.completions.create({
      model: LLM_MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: BRAND_EXTRACTION_PROMPT },
        { role: "user", content: `Product title: "${title}"` },
      ],
      temperature: 0,
    });

    const result = JSON.parse(completion.choices[0].message.content);
    return result.brand || title.split(" ")[0];
  } catch (error) {
    console.error(
      `⚠️ Brand extraction failed for "${title.substring(0, 30)}...":`,
      error.message
    );
    // Fallback: return first word
    return title.split(" ")[0];
  }
}

async function generateSpecsWithAI(title, rawSpecsText, descriptionSnippet) {
  const userPrompt = `
  Analyze this product and generate the 'specs' JSON:
  
  PRODUCT TITLE (TIER 1): "${title}"
  SPECS TABLE DATA (TIER 2): 
  ${rawSpecsText}
  
  DESCRIPTION SNIPPET (TIER 3): "${descriptionSnippet.substring(0, 500)}..."
  `;

  try {
    const completion = await openai.chat.completions.create({
      model: LLM_MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0,
    });

    return JSON.parse(completion.choices[0].message.content);
  } catch (error) {
    console.error(
      `⚠️ AI Specs Extraction Failed for "${title.substring(0, 20)}...":`,
      error.message
    );
    return {};
  }
}

function generateCascadingContext(title, brand, specs, price, description) {
  let context = `${brand} ${title}.`;

  const specString = Object.entries(specs)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");

  if (specString) context += ` Specs: ${specString}.`;
  context += ` Price: ${price} KWD.`;

  if (description && description.length > 20) {
    const cleanDesc = description.substring(0, 300).replace(/\s+/g, " ").trim();
    context += ` Features: ${cleanDesc}`;
  }
  return context;
}

// -------------------------------------------------------------------
// --- SCRAPER LOGIC WITH RETRY ---
// -------------------------------------------------------------------

async function retryPageNavigation(page, url, maxRetries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`  Attempt ${attempt}/${maxRetries} - Loading: ${url}`);

      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });

      console.log(`  ✓ Page loaded successfully`);
      return true;
    } catch (error) {
      console.warn(`  ⚠️ Attempt ${attempt} failed: ${error.message}`);

      if (attempt < maxRetries) {
        console.log(`  ⏳ Waiting ${RETRY_DELAY / 1000}s before retry...`);
        await sleep(RETRY_DELAY);
      } else {
        throw new Error(
          `Failed to load page after ${maxRetries} attempts: ${error.message}`
        );
      }
    }
  }
}

async function getStockAndDescription(browser, url) {
  let page;
  let stockStatus = StockStatus.IN_STOCK;
  let description = "";
  let rawSpecsText = "";

  try {
    page = await browser.newPage();

    await page.setRequestInterception(true);
    page.on("request", (req) => {
      if (["image", "stylesheet", "font"].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });

    page.setDefaultTimeout(60000);

    await retryPageNavigation(page, url, 2);

    const pageDetails = await page.evaluate(() => {
      let availability = null;
      let rawDescription = null;
      let scrapedSpecs = "";

      const productSchema = document.querySelector(
        '[itemtype="https://schema.org/Product"]'
      );

      const outOfStockElement = document.querySelector(
        ".typography-small.text-functional-red-800"
      );
      if (
        outOfStockElement &&
        outOfStockElement.textContent
          .trim()
          .toLowerCase()
          .includes("out of stock online")
      ) {
        availability = "Out of stock online";
      }

      if (!availability && productSchema) {
        const offersSchema = productSchema.querySelector('[itemprop="offers"]');
        availability = offersSchema
          ? offersSchema
              .querySelector('[itemprop="availability"]')
              ?.getAttribute("content")
          : null;
      }

      if (!availability) {
        const inStockElement = document.querySelector(
          ".flex.items-center.gap-x-1 .typography-small"
        );
        if (
          inStockElement &&
          inStockElement.textContent.trim().toLowerCase().includes("in stock")
        ) {
          availability = "In Stock";
        }
      }

      const specContainer = document.querySelector(
        ".ProductOverview_list__7LEwB ul"
      );
      if (specContainer) {
        scrapedSpecs = Array.from(specContainer.querySelectorAll("li"))
          .map((li) => li.innerText.trim())
          .join("\n");
      }

      if (productSchema) {
        rawDescription = productSchema
          .querySelector('[itemprop="description"]')
          ?.getAttribute("content");
      }

      if (!rawDescription && scrapedSpecs) {
        rawDescription = scrapedSpecs.replace(/\n/g, " | ");
      }

      return {
        availability,
        rawDescription: rawDescription || "",
        scrapedSpecs,
      };
    });

    const { availability, rawDescription, scrapedSpecs } = pageDetails;

    if (availability) {
      const lowerCaseStatus = availability.toLowerCase();
      if (
        lowerCaseStatus.includes("out of stock") ||
        availability === "https://schema.org/OutOfStock"
      ) {
        stockStatus = StockStatus.OUT_OF_STOCK;
      }
    }

    description = rawDescription
      .replace(/(\*|\-|\u2022|&quot;)/g, "")
      .replace(/\s+/g, " ")
      .trim();

    rawSpecsText = scrapedSpecs;
  } catch (e) {
    console.warn(
      `\n⚠️ Failed to check details for ${url}. Error: ${e.message}`
    );
    stockStatus = StockStatus.OUT_OF_STOCK;
  } finally {
    if (page) await page.close();
  }

  return { stock: stockStatus, description, rawSpecsText };
}

// -------------------------------------------------------------------
// --- MAIN PROCESSOR ---
// -------------------------------------------------------------------

async function scrapeProducts(browser, TARGET_URL, categoryName) {
  // Normalize category name for database storage
  const CATEGORY = categoryName.toUpperCase().replace(/\s+/g, "_");

  let allProductsData = [];
  let createdCount = 0,
    updatedCount = 0,
    skippedCount = 0,
    errorCount = 0;

  let categoryPage;

  try {
    console.log(
      `\n🎯 Scraping Category: "${categoryName}" (stored as: ${CATEGORY})`
    );
    console.log(`📍 URL: ${TARGET_URL}\n`);

    categoryPage = await browser.newPage();
    categoryPage.setDefaultTimeout(60000);

    await retryPageNavigation(categoryPage, TARGET_URL);

    try {
      await categoryPage.waitForSelector(PRODUCT_SELECTOR, { timeout: 10000 });
      console.log("✓ Product grid loaded");
    } catch (e) {
      console.log(
        "⚠️ Product selector not found initially - page may be empty or layout changed"
      );
    }

    // --- PAGINATION LOGIC ---
    let clickCount = 0;
    let previousCount = 0;
    let stableCount = 0;

    while (clickCount < MAX_CLICKS) {
      try {
        const currentCount = await categoryPage
          .$$eval(PRODUCT_SELECTOR, (tiles) => tiles.length)
          .catch(() => 0);

        console.log(
          `  📦 Products loaded: ${currentCount} (click ${
            clickCount + 1
          }/${MAX_CLICKS})`
        );

        if (currentCount === previousCount) {
          stableCount++;
          if (stableCount >= 2) {
            console.log("  ✓ No more products loading. All loaded.");
            break;
          }
        } else {
          stableCount = 0;
        }

        if (currentCount === 0 && clickCount === 0) {
          console.log("  ⚠️ No products found on initial load");
          break;
        }

        previousCount = currentCount;

        const showMoreButton = await categoryPage.$(SHOW_MORE_BUTTON_SELECTOR);

        if (!showMoreButton) {
          console.log("  ✓ Show More button not found. All products loaded.");
          break;
        }

        const isVisible = await categoryPage.evaluate((sel) => {
          const btn = document.querySelector(sel);
          if (!btn) return false;
          const style = window.getComputedStyle(btn);
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            style.opacity !== "0"
          );
        }, SHOW_MORE_BUTTON_SELECTOR);

        if (!isVisible) {
          console.log(
            "  ✓ Show More button no longer visible. All products loaded."
          );
          break;
        }

        await showMoreButton.click();
        await sleep(3000);

        clickCount++;
      } catch (error) {
        console.log(`  ⚠️ Pagination ended: ${error.message}`);
        break;
      }
    }

    if (clickCount >= MAX_CLICKS) {
      console.log(
        `  ⚠️ Reached maximum click limit (${MAX_CLICKS}). Some products may not be loaded.`
      );
    }

    // --- SCROLL TO TRIGGER LAZY-LOADED IMAGES ---
    console.log("\n📸 Triggering lazy-load for all images...");

    const scrollHeight = await categoryPage.evaluate(
      () => document.body.scrollHeight
    );
    const viewportHeight = await categoryPage.evaluate(
      () => window.innerHeight
    );
    const scrollSteps = Math.ceil(scrollHeight / viewportHeight);

    for (let step = 0; step <= scrollSteps; step++) {
      await categoryPage.evaluate(
        (viewportHeight, step) => {
          window.scrollTo(0, viewportHeight * step);
        },
        viewportHeight,
        step
      );

      await sleep(800);
    }

    await categoryPage.evaluate(() => window.scrollTo(0, 0));
    await sleep(500);

    console.log("✓ Lazy-load scroll complete. Extracting images...\n");

    // --- ENHANCED IMAGE EXTRACTION WITH LAZY-LOAD SUPPORT ---
    allProductsData = await categoryPage.$$eval(
      PRODUCT_SELECTOR,
      (tiles, domain) => {
        return tiles
          .map((tile) => {
            try {
              const title =
                tile
                  .querySelector(".ProductTile_productName__wEJB5")
                  ?.textContent.trim() || "N/A";
              const relativeUrl = tile.querySelector("a")?.getAttribute("href");
              const productUrl = relativeUrl
                ? relativeUrl.startsWith("http")
                  ? relativeUrl
                  : domain + relativeUrl
                : "N/A";

              let priceText =
                tile
                  .querySelector("span.text-2xl.text-functional-red-800.block")
                  ?.textContent.trim() || "N/A";
              if (priceText === "N/A") {
                const h4 = tile.querySelector("h4");
                if (h4) priceText = h4.textContent.trim();
              }
              const price =
                parseFloat(
                  priceText.replace(/KD/gi, "").replace(/,/g, "").trim()
                ) || 0;

              let imageUrl = null;
              const allImages = Array.from(tile.querySelectorAll("img"));

              for (const img of allImages) {
                const src = img.getAttribute("src") || img.src || "";
                if (
                  src &&
                  src.startsWith("http") &&
                  src.includes("cdn") &&
                  !src.startsWith("data:") &&
                  !src.includes("placeholder") &&
                  src.length > 30
                ) {
                  imageUrl = src;
                  break;
                }
              }

              if (!imageUrl) {
                for (const img of allImages) {
                  const srcset = img.getAttribute("srcset") || "";
                  if (srcset) {
                    const srcsetUrls = srcset.split(",").map((s) => s.trim());
                    for (const entry of srcsetUrls) {
                      const url = entry.split(" ")[0].trim();
                      if (
                        url &&
                        url.startsWith("http") &&
                        url.includes("cdn") &&
                        !url.startsWith("data:") &&
                        !url.includes("placeholder") &&
                        url.length > 30
                      ) {
                        imageUrl = url;
                        break;
                      }
                    }
                    if (imageUrl) break;
                  }
                }
              }

              if (!imageUrl) {
                for (const img of allImages) {
                  const dataSrc = img.getAttribute("data-src") || "";
                  if (
                    dataSrc &&
                    dataSrc.startsWith("http") &&
                    dataSrc.includes("cdn") &&
                    !dataSrc.startsWith("data:") &&
                    !dataSrc.includes("placeholder") &&
                    dataSrc.length > 30
                  ) {
                    imageUrl = dataSrc;
                    break;
                  }
                }
              }

              if (!imageUrl) {
                for (const img of allImages) {
                  const src = img.getAttribute("src") || img.src || "";
                  if (
                    src &&
                    src.startsWith("http") &&
                    !src.startsWith("data:") &&
                    !src.includes("placeholder") &&
                    src.length > 30
                  ) {
                    imageUrl = src;
                    break;
                  }
                }
              }

              if (!imageUrl) {
                for (const img of allImages) {
                  const srcset = img.getAttribute("srcset") || "";
                  if (srcset) {
                    const srcsetUrls = srcset.split(",").map((s) => s.trim());
                    const highRes =
                      srcsetUrls.find((s) => s.includes("2x")) || srcsetUrls[0];
                    if (highRes) {
                      const url = highRes.split(" ")[0].trim();
                      if (
                        url &&
                        url.startsWith("http") &&
                        !url.startsWith("data:") &&
                        !url.includes("placeholder") &&
                        url.length > 30
                      ) {
                        imageUrl = url;
                        break;
                      }
                    }
                  }
                }
              }

              if (!imageUrl) {
                imageUrl = "https://via.placeholder.com/300x300?text=No+Image";
              }

              return { title, price, imageUrl, productUrl };
            } catch (e) {
              console.error("Tile extraction error:", e);
              return null;
            }
          })
          .filter((p) => p !== null);
      },
      DOMAIN
    );

    if (allProductsData.length > 0) {
      console.log("\n📸 Sample Image URLs (first 3 products):");
      allProductsData.slice(0, 3).forEach((p, i) => {
        console.log(`  ${i + 1}. ${p.title.substring(0, 40)}...`);
        console.log(`     Image: ${p.imageUrl}`);
      });

      const cdnCount = allProductsData.filter((p) =>
        p.imageUrl.includes("cdn")
      ).length;
      const placeholderCount = allProductsData.filter((p) =>
        p.imageUrl.includes("placeholder")
      ).length;
      console.log(`\n  ✓ CDN images: ${cdnCount}/${allProductsData.length}`);
      console.log(
        `  ⚠️ Placeholders: ${placeholderCount}/${allProductsData.length}\n`
      );
    }
  } catch (error) {
    console.error(`❌ Error during category page scraping: ${error.message}`);
    throw error;
  } finally {
    if (categoryPage) await categoryPage.close();
  }

  const validProducts = allProductsData.filter(
    (p) => p.title !== "N/A" && p.productUrl !== "N/A" && p.price > 0
  );
  console.log(
    `\n✅ Found ${validProducts.length} valid products. Starting detailed processing...\n`
  );

  if (validProducts.length === 0) {
    console.log("⚠️ No valid products found.");
    return;
  }

  // --- PROCESS PRODUCTS ---
  const productUpdateTask = async (product) => {
    const { stock, description, rawSpecsText } = await getStockAndDescription(
      browser,
      product.productUrl
    );

    // 🔥 AI-powered brand extraction (no hardcoded list)
    const brand = await extractBrandWithAI(product.title);

    const specs = await generateSpecsWithAI(
      product.title,
      rawSpecsText,
      description
    );

    const searchKey = generateCascadingContext(
      product.title,
      brand,
      specs,
      product.price,
      description
    );
    const vector = await getEmbedding(searchKey);

    const upsertData = {
      title: product.title,
      description: description,
      category: CATEGORY,
      price: product.price,
      imageUrl: product.imageUrl,
      stock: stock,
      lastSeenAt: new Date(),
      brand: brand,
      specs: specs,
      searchKey: searchKey,
    };

    const existing = await prisma.product.findUnique({
      where: {
        storeName_productUrl: {
          storeName: STORE_NAME_FIXED,
          productUrl: product.productUrl,
        },
      },
      select: { id: true, createdAt: true },
    });

    let record;
    if (existing) {
      record = await prisma.product.update({
        where: { id: existing.id },
        data: upsertData,
        select: { id: true, createdAt: true, title: true, stock: true },
      });
    } else {
      record = await prisma.product.create({
        data: {
          ...upsertData,
          storeName: STORE_NAME_FIXED,
          productUrl: product.productUrl,
          scrapedAt: new Date(),
        },
        select: { id: true, createdAt: true, title: true, stock: true },
      });
    }

    if (vector) {
      const vectorString = `[${vector.join(",")}]`;
      await prisma.$executeRaw`UPDATE "Product" SET "descriptionEmbedding" = ${vectorString}::vector WHERE id = ${record.id}`;
    }

    return {
      result: record,
      status: stock,
      isNew: !existing,
    };
  };

  // --- Batch Loop ---
  for (let i = 0; i < validProducts.length; i += CONCURRENT_LIMIT) {
    const batch = validProducts.slice(i, i + CONCURRENT_LIMIT);
    console.log(
      `➡️ Processing batch ${Math.ceil(
        (i + 1) / CONCURRENT_LIMIT
      )} of ${Math.ceil(validProducts.length / CONCURRENT_LIMIT)}...`
    );

    const batchResults = await Promise.allSettled(
      batch.map((p) => productUpdateTask(p))
    );

    for (const res of batchResults) {
      if (res.status === "fulfilled") {
        if (res.value.isNew) createdCount++;
        else updatedCount++;
      } else {
        errorCount++;
        console.error(`❌ Error: ${res.reason?.message || res.reason}`);
      }
    }
  }

  console.log(`\n=== JOB SUMMARY for "${categoryName}" ===`);
  console.log(
    `✅ Created: ${createdCount} | 🔄 Updated: ${updatedCount} | ❌ Errors: ${errorCount}`
  );
}

export default scrapeProducts;
