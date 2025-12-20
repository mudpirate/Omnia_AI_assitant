import puppeteer from "puppeteer";
import { PrismaClient, StockStatus, StoreName } from "@prisma/client";
import OpenAI from "openai";

// --- GLOBAL CONFIGURATION ---
const prisma = new PrismaClient();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Eureka Specific Selectors
const PRODUCT_SELECTOR = ".col-sm-3.width50";
const STORE_NAME_FIXED = StoreName.EUREKA;
const DOMAIN = "https://www.eureka.com.kw";
const MAX_SCROLL_ATTEMPTS = 30; // Increased for better coverage
const MAX_RETRIES = 3;
const RETRY_DELAY = 5000;

// --- CONCURRENCY SETTING ---
const CONCURRENT_LIMIT = 3;
const LLM_MODEL = "gpt-4o-mini";

// --- SYSTEM PROMPT ---
const SYSTEM_PROMPT = `
You are a strict Data Extraction AI for an E-commerce Database.
Your goal is to extract a flat JSON object of filtering attributes ("specs") from raw product data.

### 1. INPUT HIERARCHY (The "Triangle of Truth")
- **TIER 1 (Highest Authority):** PRODUCT TITLE. Trust this above all for determining the specific Variant (Color, Storage, Size, Model).
- **TIER 2 (High Detail):** SPECS TABLE. Use this for technical details missing from the title (Material, Voltage, Ingredients, Hz).
- **TIER 3 (Context):** DESCRIPTION. Use only as a fallback. NEVER use it to override the Title.

### 2. NORMALIZATION RULES (Crucial)
- **Keys:** Snake_case and lowercase (e.g., 'screen_size', not 'Screen Size').
- **Values:** Lowercase strings (e.g., 'silver', not 'Silver').
- **Storage:** Convert to 'gb' or 'tb' (no spaces). Example: '256 GB' -> '256gb', '1 TB' -> '1024gb'.
- **Colors:** Normalize fancy names. 'Midnight' -> 'black', 'Starlight' -> 'silver', 'Titanium Blue' -> 'blue'.
- **measurements:** Standardize units (e.g., '2 Liters' -> '2l', '500 ML' -> '500ml', '1.5 KG' -> '1.5kg').

### 3. CATEGORY-SPECIFIC LOGIC
- **Electronics:** - Extract 'variant' strictly as: 'pro', 'pro_max', 'plus', 'mini', or 'base'.
   - Extract 'network': '5g', '4g', 'wifi'.
   - Extract 'screen_size', 'resolution', 'refresh_rate', 'response_time' for monitors/TVs.
- **Fashion:** Extract 'gender' ('men', 'women', 'unisex', 'kids'), 'size', 'material'.
- **Grocery:** Extract 'dietary' (e.g., 'gluten_free'), 'volume', 'pack_count'.

### 4. OUTPUT FORMAT
- Return ONLY a flat JSON object.
- Do NOT include Price, Stock, or Store Name (these are stored elsewhere).
- If a field is not found, omit it. Do not hallucinate.
`;

// --- BRAND EXTRACTION PROMPT ---
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

// AI-POWERED BRAND EXTRACTION
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
// --- RETRY LOGIC ---
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

// -------------------------------------------------------------------
// --- ENHANCED PRODUCT DETAILS SCRAPER ---
// -------------------------------------------------------------------

async function getStockAndDescription(browser, url) {
  let page;
  let stockStatus = StockStatus.OUT_OF_STOCK;
  let description = "";
  let rawSpecsText = "";

  try {
    page = await browser.newPage();

    // Set realistic user agent
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    // Block unnecessary resources for faster loading
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

    // Wait for Angular to render
    try {
      await page.waitForSelector(".product_detail", { timeout: 8000 });
    } catch (e) {
      // Continue even if not fully ready
    }

    // CRITICAL: Wait for Angular to populate the ng-bind-html content
    // The .product-description div exists immediately, but Angular needs time to populate it
    let contentLoaded = false;
    try {
      await page.waitForFunction(
        () => {
          const descDiv = document.querySelector(
            ".product-description p.ng-binding"
          );
          return (
            descDiv &&
            descDiv.textContent &&
            descDiv.textContent.trim().length > 50
          );
        },
        { timeout: 15000 } // Increased to 15 seconds
      );
      console.log(`  ✓ Angular content loaded`);
      contentLoaded = true;
    } catch (e) {
      console.log(
        `  ⚠️ Angular content didn't load in 15s, trying alternative selectors...`
      );
    }

    // If primary method failed, try waiting for specs table as indicator that page is ready
    if (!contentLoaded) {
      try {
        await page.waitForFunction(
          () => {
            const specTable = document.querySelector(
              ".sdbx#specificationDetails table"
            );
            return (
              specTable && specTable.querySelectorAll("tbody tr").length > 10
            );
          },
          { timeout: 10000 }
        );
        console.log(`  ✓ Specs table loaded, page should be ready`);
        // Give Angular a bit more time to populate description
        await sleep(2000);
      } catch (e) {
        console.log(
          `  ⚠️ Page may not be fully rendered, proceeding anyway...`
        );
        await sleep(3000);
      }
    }

    const pageDetails = await page.evaluate(() => {
      let isAvailable = false;
      let rawDescription = "";
      let scrapedSpecs = "";

      // Debug object to track what we find
      const debug = {
        foundElements: [],
        attempts: [],
      };

      // --- 1. STOCK CHECK ---
      const stockElement = document.querySelector(".product-stock .stock-text");
      if (stockElement) {
        const text = stockElement.textContent.trim().toLowerCase();
        if (text.includes("in stock") || text.includes("available")) {
          isAvailable = true;
        }
      }

      // Fallback: Check Buy buttons
      if (!isAvailable) {
        const addToCartBtn = document.getElementById("AddToCart");
        if (addToCartBtn && addToCartBtn.offsetParent !== null) {
          isAvailable = true;
        }
      }

      if (!isAvailable) {
        const buyNowBtn = document.querySelector(".abynwcart");
        if (buyNowBtn && buyNowBtn.offsetParent !== null) {
          isAvailable = true;
        }
      }

      // --- 2. SPECIFICATIONS TABLE ---
      const allSdbxDivs = Array.from(
        document.querySelectorAll(".sdbx#specificationDetails")
      );
      debug.foundElements.push(
        `Found ${allSdbxDivs.length} .sdbx#specificationDetails divs`
      );

      let specsDiv = null;
      for (const div of allSdbxDivs) {
        const hasTable = div.querySelector("table") !== null;
        debug.attempts.push(`sdbx div has table: ${hasTable}`);

        if (hasTable) {
          specsDiv = div;
          break;
        }
      }

      if (specsDiv) {
        const specTable = specsDiv.querySelector("table");
        if (specTable) {
          const rows = Array.from(specTable.querySelectorAll("tbody tr"));
          debug.attempts.push(`Specs table found with ${rows.length} rows`);
          scrapedSpecs = rows
            .map((row) => {
              const cells = row.querySelectorAll("td");
              if (cells.length >= 2) {
                const key = cells[0].textContent.trim();
                const value = cells[1].textContent.trim();
                return `${key}: ${value}`;
              }
              return "";
            })
            .filter((line) => line.length > 0)
            .join("\n");
        }
      }

      // --- 3. PRODUCT DESCRIPTION / KEY FEATURES ---
      // ATTEMPT 1: Primary target with itemprop
      debug.attempts.push(
        "ATTEMPT 1: Looking for div.product-description[itemprop='description']"
      );
      const productDescDiv = document.querySelector(
        'div.product-description[itemprop="description"]'
      );
      if (productDescDiv) {
        debug.foundElements.push(
          "Found div.product-description[itemprop='description']"
        );

        // Get all p tags inside
        const allPTags = productDescDiv.querySelectorAll("p");
        debug.attempts.push(
          `Found ${allPTags.length} p tags inside product-description`
        );

        if (allPTags.length > 0) {
          const texts = Array.from(allPTags)
            .map((p) => {
              const text = p.textContent.trim();
              debug.attempts.push(
                `P tag text sample: "${text.substring(0, 50)}..."`
              );
              return text;
            })
            .filter((text) => text.length > 0);

          debug.attempts.push(
            `Extracted ${texts.length} non-empty text blocks from p tags`
          );
          rawDescription = texts.join(" ");
          debug.attempts.push(
            `Description length after join: ${rawDescription.length} chars`
          );
        }

        // If still empty, get all text from div
        if (!rawDescription) {
          debug.attempts.push("P tags empty, trying to get all text from div");
          const clone = productDescDiv.cloneNode(true);
          const h3 = clone.querySelector("h3");
          if (h3) {
            debug.attempts.push("Removing h3 'Key Features' header");
            h3.remove();
          }
          rawDescription = clone.textContent.trim();
          debug.attempts.push(
            `Description from clone: length ${rawDescription.length}`
          );
        }
      } else {
        debug.attempts.push(
          "div.product-description[itemprop='description'] NOT FOUND"
        );
      }

      // ATTEMPT 2: Simpler selector
      if (!rawDescription) {
        debug.attempts.push(
          "ATTEMPT 2: Looking for .product-description p.ng-binding"
        );
        const descParagraph = document.querySelector(
          ".product-description p.ng-binding"
        );
        if (descParagraph) {
          debug.foundElements.push("Found .product-description p.ng-binding");
          rawDescription = descParagraph.textContent.trim();
          debug.attempts.push(
            `Description from p.ng-binding: length ${rawDescription.length}`
          );
        } else {
          debug.attempts.push(".product-description p.ng-binding NOT FOUND");
        }
      }

      // ATTEMPT 3: Any .product-description div
      if (!rawDescription) {
        debug.attempts.push("ATTEMPT 3: Looking for any .product-description");
        const anyProdDesc = document.querySelector(".product-description");
        if (anyProdDesc) {
          debug.foundElements.push("Found .product-description");
          const clone = anyProdDesc.cloneNode(true);
          const h3 = clone.querySelector("h3");
          if (h3) h3.remove();
          rawDescription = clone.textContent.trim();
          debug.attempts.push(
            `Description from any .product-description: length ${rawDescription.length}`
          );
        } else {
          debug.attempts.push(".product-description NOT FOUND");
        }
      }

      // ATTEMPT 4: Product Description from PrdDescription_Details
      if (!rawDescription) {
        debug.attempts.push(
          "ATTEMPT 4: Looking for #PrdDescription_Details #specificationDetails"
        );
        const descDiv = document.querySelector(
          "#PrdDescription_Details #specificationDetails"
        );
        if (descDiv && !descDiv.querySelector("table")) {
          debug.foundElements.push(
            "Found #PrdDescription_Details #specificationDetails (no table)"
          );
          rawDescription = descDiv.textContent.trim();
          debug.attempts.push(
            `Description from PrdDescription_Details: length ${rawDescription.length}`
          );
        } else {
          debug.attempts.push(
            "#PrdDescription_Details #specificationDetails NOT FOUND or has table"
          );
        }
      }

      // ATTEMPT 5: Key Features from keyfbx
      if (!rawDescription) {
        debug.attempts.push("ATTEMPT 5: Looking for .keyfbx p");
        const keyFeaturesDiv = document.querySelector(".keyfbx p");
        if (keyFeaturesDiv) {
          debug.foundElements.push("Found .keyfbx p");
          rawDescription = keyFeaturesDiv.textContent.trim();
          debug.attempts.push(
            `Description from keyfbx: length ${rawDescription.length}`
          );
        } else {
          debug.attempts.push(".keyfbx p NOT FOUND");
        }
      }

      return { isAvailable, rawDescription, scrapedSpecs, debug };
    });

    if (pageDetails.isAvailable) {
      stockStatus = StockStatus.IN_STOCK;
    }

    if (pageDetails.rawDescription) {
      description = pageDetails.rawDescription
        .replace(/(\*|\-|\u2022|&quot;)/g, "")
        .replace(/\s+/g, " ")
        .trim();
    }

    rawSpecsText = pageDetails.scrapedSpecs;

    // Always show debug logging for first few products
    console.log(`\n🔍 DEBUG: ${url.substring(url.lastIndexOf("/") + 1)}`);
    console.log(`📊 Stock: ${stockStatus}`);
    console.log(`📝 Description length: ${description.length} chars`);
    console.log(`📋 Specs lines: ${rawSpecsText.split("\n").length}`);

    if (pageDetails.debug) {
      console.log(`\n🔎 Elements found:`);
      pageDetails.debug.foundElements.forEach((e) => console.log(`   ✓ ${e}`));

      console.log(`\n🔎 Extraction attempts:`);
      pageDetails.debug.attempts
        .slice(0, 10)
        .forEach((a) => console.log(`   • ${a}`));
    }

    if (description) {
      console.log(
        `\n📄 First 150 chars of description:\n   "${description.substring(
          0,
          150
        )}..."`
      );
    } else {
      console.log(`   ⚠️ NO DESCRIPTION FOUND!`);
    }

    if (rawSpecsText) {
      console.log(`\n📊 First 3 spec lines:`);
      rawSpecsText
        .split("\n")
        .slice(0, 3)
        .forEach((line) => console.log(`   ${line}`));
    }

    console.log(`\n${"=".repeat(80)}\n`);
  } catch (e) {
    console.warn(
      `\n⚠️ Failed to check details for ${url}. Error: ${e.message}`
    );
  } finally {
    if (page) await page.close();
  }

  return { stock: stockStatus, description, rawSpecsText };
}

// -------------------------------------------------------------------
// --- MAIN SCRAPER ---
// -------------------------------------------------------------------

async function scrapeProducts(browser, TARGET_URL, categoryName) {
  // Normalize category name for database storage
  const CATEGORY = categoryName.toUpperCase().replace(/\s+/g, "_");

  let allProductsData = [];
  let createdCount = 0;
  let updatedCount = 0;
  let errorCount = 0;

  let categoryPage;

  try {
    console.log(
      `\n🎯 Scraping Category: "${categoryName}" (stored as: ${CATEGORY})`
    );
    console.log(`📍 URL: ${TARGET_URL}\n`);

    categoryPage = await browser.newPage();
    categoryPage.setDefaultTimeout(90000);
    await categoryPage.setViewport({ width: 1280, height: 800 });

    await retryPageNavigation(categoryPage, TARGET_URL);

    // --- INFINITE SCROLL LOGIC ---
    console.log("📜 Starting infinite scroll to load all products...");

    let previousHeight = 0;
    let scrollAttempts = 0;
    let stableCount = 0;

    while (scrollAttempts < MAX_SCROLL_ATTEMPTS) {
      scrollAttempts++;

      const currentProductCount = await categoryPage
        .$$eval(PRODUCT_SELECTOR, (tiles) => tiles.length)
        .catch(() => 0);

      console.log(
        `  📦 Products loaded: ${currentProductCount} (scroll ${scrollAttempts}/${MAX_SCROLL_ATTEMPTS})`
      );

      previousHeight = await categoryPage.evaluate(
        "document.body.scrollHeight"
      );

      // Scroll to bottom
      await categoryPage.evaluate(
        "window.scrollTo(0, document.body.scrollHeight)"
      );

      // Wait for Angular to render new content
      await sleep(2000);

      // Check if "Load More" button exists and click it
      const loadMoreButton = await categoryPage.$("#btnLoadMore");
      if (loadMoreButton) {
        try {
          const isVisible = await categoryPage.evaluate((sel) => {
            const btn = document.querySelector(sel);
            if (!btn) return false;
            const style = window.getComputedStyle(btn);
            return (
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              style.opacity !== "0"
            );
          }, "#btnLoadMore");

          if (isVisible) {
            await loadMoreButton.click();
            console.log("  ✓ Clicked 'Load More' button");
            await sleep(2000);
          }
        } catch (e) {
          // Button might not be clickable
        }
      }

      const newHeight = await categoryPage.evaluate(
        "document.body.scrollHeight"
      );

      const newProductCount = await categoryPage
        .$$eval(PRODUCT_SELECTOR, (tiles) => tiles.length)
        .catch(() => 0);

      // Check if we've stopped loading new products
      if (
        newHeight === previousHeight &&
        newProductCount === currentProductCount
      ) {
        stableCount++;
        if (stableCount >= 3) {
          console.log("  ✓ No new products loading. All products loaded.");
          break;
        }
      } else {
        stableCount = 0;
      }
    }

    if (scrollAttempts >= MAX_SCROLL_ATTEMPTS) {
      console.log(
        `  ⚠️ Reached maximum scroll attempts (${MAX_SCROLL_ATTEMPTS})`
      );
    }

    // --- TRIGGER LAZY-LOADED IMAGES ---
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
      await sleep(500);
    }

    await categoryPage.evaluate(() => window.scrollTo(0, 0));
    await sleep(500);

    console.log("✓ Lazy-load scroll complete. Extracting data...\n");

    // --- EXTRACT PRODUCT DATA ---
    allProductsData = await categoryPage.$$eval(
      PRODUCT_SELECTOR,
      (tiles, domain) => {
        return tiles
          .map((tile) => {
            try {
              // 1. Title
              const titleEl = tile.querySelector(".caption .sobrTxt span");
              const title = titleEl ? titleEl.textContent.trim() : "N/A";

              // 2. URL
              const anchor = tile.querySelector("a.prdimg");
              let productUrl = "N/A";
              if (anchor && anchor.getAttribute("href")) {
                const href = anchor.getAttribute("href");
                productUrl = href.startsWith("http") ? href : domain + href;
              }

              // 3. Price
              let price = 0;
              const priceEl = tile.querySelector(
                ".caption span[style*='color:red']"
              );
              if (priceEl) {
                const priceTxt = priceEl.textContent.replace("KD", "").trim();
                price = parseFloat(priceTxt) || 0;
              }

              // 4. Image URL (Enhanced with lazy-load support)
              let imageUrl = "";
              const imgEl = tile.querySelector(".prdimg img");
              if (imgEl) {
                // Check for lazy-load attribute first
                const lazySrc = imgEl.getAttribute("bn-lazy-src");
                const normalSrc = imgEl.getAttribute("src");
                const dataSrc = imgEl.getAttribute("data-src");

                imageUrl = lazySrc || dataSrc || normalSrc || "";

                // Make relative URLs absolute
                if (imageUrl && !imageUrl.startsWith("http")) {
                  imageUrl = imageUrl.startsWith("/")
                    ? domain + imageUrl
                    : domain + "/" + imageUrl;
                }

                // Skip placeholder/loading images
                if (
                  imageUrl.includes("placeholder") ||
                  imageUrl.includes("loading")
                ) {
                  imageUrl = "";
                }
              }

              // Fallback to placeholder if no valid image
              if (!imageUrl) {
                imageUrl = "https://via.placeholder.com/300x300?text=No+Image";
              }

              return { title, price, imageUrl, productUrl };
            } catch (e) {
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

      const validImageCount = allProductsData.filter(
        (p) => !p.imageUrl.includes("placeholder")
      ).length;
      const placeholderCount = allProductsData.filter((p) =>
        p.imageUrl.includes("placeholder")
      ).length;
      console.log(
        `\n  ✓ Valid images: ${validImageCount}/${allProductsData.length}`
      );
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

  // Filter valid products
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

  // --- PROCESS PRODUCTS WITH AI ---
  const productUpdateTask = async (product) => {
    // 1. Scrape details with specs table
    const { stock, description, rawSpecsText } = await getStockAndDescription(
      browser,
      product.productUrl
    );

    // 2. AI-powered brand extraction
    const brand = await extractBrandWithAI(product.title);

    // 3. AI-powered specs generation
    const specs = await generateSpecsWithAI(
      product.title,
      rawSpecsText,
      description
    );

    // 4. Generate search context
    const searchKey = generateCascadingContext(
      product.title,
      brand,
      specs,
      product.price,
      description
    );

    // 5. Generate embedding
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

    // 6. Check if product exists
    const existing = await prisma.product.findUnique({
      where: {
        storeName_productUrl: {
          storeName: STORE_NAME_FIXED,
          productUrl: product.productUrl,
        },
      },
      select: { id: true, createdAt: true },
    });

    // 7. Update or Create
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

    // 8. Update vector embedding
    if (vector) {
      const vectorString = `[${vector.join(",")}]`;
      await prisma.$executeRaw`
        UPDATE "Product"
        SET "descriptionEmbedding" = ${vectorString}::vector
        WHERE id = ${record.id}
      `;
    }

    return {
      result: record,
      status: stock,
      isNew: !existing,
    };
  };

  // --- BATCH PROCESSING LOOP ---
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
