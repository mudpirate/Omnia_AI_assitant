import puppeteer from "puppeteer";
import { PrismaClient, StockStatus, StoreName } from "@prisma/client";
import OpenAI from "openai";

// --- GLOBAL CONFIGURATION ---
const prisma = new PrismaClient();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const PRODUCT_SELECTOR = "best-product-grid-item";
const DOMAIN = "https://best.com.kw";
const STORE_NAME_FIXED = StoreName.BEST_KW;
const MAX_RETRIES = 3;
const RETRY_DELAY = 5000;

// --- CONCURRENCY SETTING ---
const CONCURRENT_LIMIT = 2;
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
  - **Fashion:** Extract 'gender' ('men', 'women', 'unisex', 'kids'), 'size', 'material'.
  - **Grocery:** Extract 'dietary' (e.g., 'gluten_free'), 'volume', 'pack_count'.

  ### 4. OUTPUT FORMAT
  - Return ONLY a flat JSON object.
  - Do NOT include Price, Stock, or Store Name (these are stored elsewhere).
  - If a field is not found, omit it. Do not hallucinate.
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
        timeout: 90000, // Increased from 60s
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

async function getStockAndDescription(browser, url, retryCount = 0) {
  const MAX_CONTENT_RETRIES = 2;

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

    // Increased timeout to 90 seconds
    page.setDefaultTimeout(90000);

    await retryPageNavigation(page, url, 3); // Increased retries to 3

    // 🔥 COOKIE BANNER HANDLING - Dismiss all popups/modals first
    try {
      // Try to find and click common cookie/modal close buttons
      const closeButtonSelectors = [
        'button[aria-label="Close"]',
        "button.close",
        ".modal-close",
        ".cookie-accept",
        ".cookie-dismiss",
        '[class*="cookie"] button',
        '[id*="cookie"] button',
        'button:has-text("Accept")',
        'button:has-text("OK")',
        'button:has-text("Close")',
        ".btn-close",
      ];

      for (const selector of closeButtonSelectors) {
        try {
          const button = await page.$(selector);
          if (button) {
            await button.click();
            console.log(`  ✓ Dismissed popup using: ${selector}`);
            await sleep(500); // Wait for animation
            break;
          }
        } catch (e) {
          // Continue to next selector
        }
      }

      // Also try to remove cookie banners via CSS
      await page.evaluate(() => {
        const cookieSelectors = [
          '[class*="cookie"]',
          '[id*="cookie"]',
          '[class*="consent"]',
          '[id*="consent"]',
          ".modal-backdrop",
          '[class*="overlay"]',
        ];

        cookieSelectors.forEach((selector) => {
          const elements = document.querySelectorAll(selector);
          elements.forEach((el) => {
            // Only remove if it contains cookie/consent related text
            const text = el.textContent?.toLowerCase() || "";
            if (
              text.includes("cookie") ||
              text.includes("consent") ||
              text.includes("privacy")
            ) {
              el.remove();
            }
          });
        });
      });
    } catch (e) {
      console.log(`  ⚠️ Could not dismiss popups: ${e.message}`);
    }

    // 🔥 IMPROVED: Wait for multiple possible selectors with increased timeout
    const selectorOptions = [
      "best-product-summary",
      ".product-details",
      ".main-cnt",
      "best-product-details-tab",
    ];

    let selectorFound = false;
    for (const selector of selectorOptions) {
      try {
        await page.waitForSelector(selector, { timeout: 30000 });
        console.log(`  ✓ Found selector: ${selector}`);
        selectorFound = true;
        break;
      } catch (e) {
        console.log(`  ⚠️ Selector not found: ${selector}`);
      }
    }

    if (!selectorFound) {
      console.warn(
        `  ⚠️ No primary selectors found, attempting to scrape anyway...`
      );
    }

    // 🔥 IMPROVED: Add extra wait for dynamic content
    await sleep(3000); // Increased to 3 seconds for JS to finish rendering

    // 🔥 DEBUGGING: Take a screenshot if nothing was found
    const takeDebugScreenshot = async () => {
      try {
        const timestamp = Date.now();
        await page.screenshot({
          path: `debug-${timestamp}.png`,
          fullPage: false,
        });
        console.log(`  📸 Debug screenshot saved: debug-${timestamp}.png`);
      } catch (e) {
        // Ignore screenshot errors
      }
    };

    // 🔥 IMPROVED: More comprehensive page details extraction with enhanced debugging
    const pageDetails = await page.evaluate(() => {
      let isOutOfStock = false;
      let rawDescription = "";
      let scrapedSpecs = "";

      // --- STOCK CHECK ---
      const addToCartBtn = document.querySelector("button.add-to-cart-btn");
      const buyNowBtn = document.querySelector("button.buy-now-btn");
      const outOfStockLabel = document.querySelector(".outofstock");

      const isCartDisabled = addToCartBtn?.hasAttribute("disabled") || false;
      const isBuyDisabled = buyNowBtn?.hasAttribute("disabled") || false;

      if (isCartDisabled || isBuyDisabled || outOfStockLabel) {
        isOutOfStock = true;
      }

      // --- DESCRIPTION EXTRACTION (Multiple fallback strategies) ---

      // Strategy 1: Primary description location
      let descriptionElement = document.querySelector(
        ".main-cnt .description.ng-star-inserted"
      );

      // Strategy 2: Alternative description selectors
      if (!descriptionElement || !descriptionElement.innerText?.trim()) {
        const alternativeSelectors = [
          ".main-cnt .description",
          ".product-description",
          ".description.ng-star-inserted",
          "best-product-summary .description",
          ".product-details .description",
          "[class*='description']",
        ];

        for (const selector of alternativeSelectors) {
          const el = document.querySelector(selector);
          if (el && el.innerText?.trim()) {
            descriptionElement = el;
            break;
          }
        }
      }

      if (descriptionElement) {
        rawDescription = descriptionElement.innerText
          .replace(/\s+/g, " ")
          .replace(/&nbsp;/g, " ")
          .trim();
      }

      // 🔥 FILTER OUT COOKIE/CONSENT BANNERS
      const cookieKeywords = [
        "we use cookies",
        "cookie policy",
        "privacy policy",
        "personalize the content",
        "improve user experience",
        "accept cookies",
        "cookie consent",
        "by continuing to use",
        "data protection",
        "gdpr",
        "this website uses cookies",
      ];

      if (rawDescription) {
        const lowerDesc = rawDescription.toLowerCase();
        const isCookieBanner = cookieKeywords.some((keyword) =>
          lowerDesc.includes(keyword)
        );

        // If it's a cookie banner and it's short (< 200 chars), discard it
        if (isCookieBanner && rawDescription.length < 200) {
          console.log("⚠️ Filtered out cookie banner text");
          rawDescription = "";
        }
      }

      // --- SPECS EXTRACTION (Multiple fallback strategies) ---

      // Strategy 1: Primary specs location
      const activeTab = document.querySelector("div.active.ng-star-inserted");
      let specsContainer = null;

      if (activeTab) {
        specsContainer = activeTab.querySelector(
          "best-product-details-tab .container-fluid"
        );
      }

      // Strategy 2: Fallback without active class filter
      if (!specsContainer) {
        specsContainer = document.querySelector(
          "best-product-details-tab .container-fluid"
        );
      }

      // Strategy 3: Try other possible specs containers
      if (!specsContainer) {
        const specsSelectors = [
          "best-product-details-tab",
          ".product-specifications",
          ".specifications",
          ".product-details-tab",
          "[class*='specification']",
          "[class*='details-tab']",
        ];

        for (const selector of specsSelectors) {
          const el = document.querySelector(selector);
          if (el) {
            specsContainer = el;
            break;
          }
        }
      }

      if (specsContainer) {
        // Try to get list items first
        const listItems = Array.from(
          specsContainer.querySelectorAll("ul li, ol li, li")
        );
        if (listItems.length > 0) {
          scrapedSpecs = listItems
            .map((li) => {
              return li.innerText
                .replace(/\s+/g, " ")
                .replace(/&nbsp;/g, " ")
                .trim();
            })
            .filter((text) => text.length > 0)
            .join("\n");

          // If description is still empty, use specs as fallback
          if (!rawDescription || rawDescription.length < 10) {
            rawDescription = listItems
              .map((li) => {
                return li.innerText
                  .replace(/\s+/g, " ")
                  .replace(/&nbsp;/g, " ")
                  .trim();
              })
              .filter((text) => text.length > 0)
              .join(" | ");
          }
        } else {
          // If no list items, get all text content
          const allText = specsContainer.innerText
            .replace(/\s+/g, " ")
            .replace(/&nbsp;/g, " ")
            .trim();
          scrapedSpecs = allText;

          // Use as description fallback if needed
          if (!rawDescription || rawDescription.length < 10) {
            rawDescription = allText;
          }
        }
      }

      // Strategy 4: Final fallback - try to get ANY text content from product area
      if (!rawDescription || rawDescription.length < 10) {
        const summaryDesc = document.querySelector(
          "best-product-summary .description"
        );
        if (summaryDesc) {
          rawDescription = summaryDesc.innerText.replace(/\s+/g, " ").trim();
        }
      }

      // Strategy 5: Last resort - get all visible text from main product area
      if (!rawDescription || rawDescription.length < 10) {
        const productAreas = [
          "best-product-summary",
          ".product-info",
          ".product-content",
          "main",
        ];

        for (const selector of productAreas) {
          const area = document.querySelector(selector);
          if (area) {
            const text = area.innerText?.trim();
            if (text && text.length > 20) {
              rawDescription = text
                .substring(0, 1000)
                .replace(/\s+/g, " ")
                .trim();

              // Check again for cookie text even in fallback
              const lowerText = rawDescription.toLowerCase();
              const hasCookieText = [
                "we use cookies",
                "cookie policy",
                "personalize the content",
              ].some((keyword) => lowerText.includes(keyword));

              if (!hasCookieText) {
                break;
              } else {
                rawDescription = ""; // Discard and continue
              }
            }
          }
        }
      }

      // If specs are empty, use description as specs for AI processing
      if (!scrapedSpecs && rawDescription) {
        scrapedSpecs = rawDescription;
      }

      return {
        isOutOfStock,
        rawDescription: rawDescription || "",
        scrapedSpecs: scrapedSpecs || "",
      };
    });

    const { isOutOfStock, rawDescription, scrapedSpecs } = pageDetails;

    if (isOutOfStock) {
      stockStatus = StockStatus.OUT_OF_STOCK;
    }

    description = rawDescription
      .replace(/(\*|\-|\u2022|&quot;)/g, "")
      .replace(/\s+/g, " ")
      .trim();

    // 🔥 FINAL COOKIE FILTER - Double check after extraction
    const cookiePatterns = [
      /we use cookies/i,
      /cookie policy/i,
      /privacy policy/i,
      /personalize the content/i,
      /improve user experience/i,
      /accept.*cookies/i,
      /cookie consent/i,
      /browser.*storage/i,
      /by continuing to use/i,
    ];

    const containsCookieText = cookiePatterns.some((pattern) =>
      pattern.test(description)
    );

    // If description is short AND contains cookie keywords, clear it
    if (containsCookieText && description.length < 250) {
      console.warn(`  ⚠️ Filtered cookie banner from description`);
      description = "";
    }

    // If description is ONLY cookie text (very similar to known patterns), clear it
    if (
      description.toLowerCase().includes("we use cookies") &&
      description.toLowerCase().includes("personalize") &&
      description.length < 300
    ) {
      console.warn(`  ⚠️ Description is cookie banner only - clearing`);
      description = "";
    }

    rawSpecsText = scrapedSpecs;

    // 🔥 IMPROVED: Log if description is still empty
    if (!description || description.length < 10) {
      console.warn(`  ⚠️ Empty/short description for: ${url}`);
      console.log(`     Raw description length: ${rawDescription.length}`);
      console.log(`     Specs text length: ${scrapedSpecs.length}`);
    } else {
      console.log(`  ✓ Description extracted (${description.length} chars)`);
    }
  } catch (e) {
    console.error(`\n❌ Failed to check details for ${url}`);
    console.error(`   Error type: ${e.name}`);
    console.error(`   Error message: ${e.message}`);
    console.error(
      `   Stack trace: ${e.stack?.split("\n").slice(0, 3).join("\n")}`
    );

    // Don't immediately mark as out of stock - try to continue
    // stockStatus = StockStatus.OUT_OF_STOCK;
  } finally {
    if (page) {
      try {
        await page.close();
      } catch (closeError) {
        console.warn(`  ⚠️ Error closing page: ${closeError.message}`);
      }
    }
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
    categoryPage.setDefaultTimeout(90000);
    await categoryPage.setViewport({ width: 1280, height: 800 });

    let currentUrl = TARGET_URL;
    let pageNum = 1;
    let hasNextPage = true;

    // --- PAGINATION LOOP ---
    while (hasNextPage) {
      console.log(`\n➡️ Processing Page ${pageNum}: ${currentUrl}`);

      try {
        await retryPageNavigation(categoryPage, currentUrl);

        // Wait for product grid
        try {
          await categoryPage.waitForSelector(PRODUCT_SELECTOR, {
            timeout: 20000,
          });
          console.log("✓ Product grid loaded");
        } catch (e) {
          console.warn(
            "⚠️ Product selector not found - checking pagination..."
          );
        }

        // Scroll to trigger lazy loading
        console.log("📸 Triggering lazy-load for images...");
        await categoryPage.evaluate(async () => {
          const scrollStep = 500;
          let totalHeight = 0;
          const bodyHeight = document.body.scrollHeight;
          while (totalHeight < bodyHeight) {
            window.scrollBy(0, scrollStep);
            totalHeight += scrollStep;
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          window.scrollTo(0, 0);
          await new Promise((resolve) => setTimeout(resolve, 1000));
        });

        // Extract products from current page
        const pageProducts = await categoryPage.$$eval(
          PRODUCT_SELECTOR,
          (tiles, domain) => {
            return tiles
              .map((tile) => {
                try {
                  const linkElement = tile.querySelector(
                    'a.cx-product-name, a[class="cx-product-name"]'
                  );
                  const relativeUrl = linkElement?.getAttribute("href");
                  const productUrl = relativeUrl
                    ? relativeUrl.startsWith("http")
                      ? relativeUrl
                      : `${domain}${relativeUrl}`
                    : "N/A";
                  const title = linkElement?.textContent.trim() || "N/A";

                  // Enhanced image extraction
                  let imageUrl = null;
                  const allImages = Array.from(tile.querySelectorAll("img"));

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

                  if (!imageUrl) {
                    for (const img of allImages) {
                      const srcset = img.getAttribute("srcset") || "";
                      if (srcset) {
                        const srcsetUrls = srcset
                          .split(",")
                          .map((s) => s.trim());
                        for (const entry of srcsetUrls) {
                          const url = entry.split(" ")[0].trim();
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
                        if (imageUrl) break;
                      }
                    }
                  }

                  if (!imageUrl) {
                    imageUrl =
                      "https://via.placeholder.com/300x300?text=No+Image";
                  }

                  const currentPriceElement =
                    tile.querySelector(".cx-product-price");
                  const priceText = currentPriceElement?.textContent || "0";
                  // 🔥 FIX: Remove commas first, then keep only numbers and dots
                  const price =
                    parseFloat(
                      priceText.replace(/,/g, "").replace(/[^\d.]/g, "")
                    ) || 0;

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

        if (pageProducts.length === 0) {
          console.log(`⚠️ Page ${pageNum} loaded but found zero products.`);
        } else {
          console.log(
            `   ✅ Scraped ${pageProducts.length} products from page ${pageNum}.`
          );
          allProductsData = allProductsData.concat(pageProducts);
        }

        // Check for next page
        const nextPageInfo = await categoryPage.evaluate(() => {
          const nextBtn = document.querySelector(".cx-pagination a.next");

          if (nextBtn) {
            const isDisabled = nextBtn.classList.contains("disabled");
            const href = nextBtn.getAttribute("href");
            return { exists: true, isDisabled, href };
          }
          return { exists: false };
        });

        if (
          nextPageInfo.exists &&
          !nextPageInfo.isDisabled &&
          nextPageInfo.href
        ) {
          if (nextPageInfo.href.startsWith("http")) {
            currentUrl = nextPageInfo.href;
          } else {
            currentUrl = `${DOMAIN}${
              nextPageInfo.href.startsWith("/") ? "" : "/"
            }${nextPageInfo.href}`;
          }
          pageNum++;
          hasNextPage = true;
        } else {
          console.log(
            `🛑 Reached last page (Next button is disabled or missing).`
          );
          hasNextPage = false;
        }
      } catch (e) {
        console.error(`⚠️ Error on page ${pageNum}: ${e.message}`);
        hasNextPage = false;
      }
    }

    if (allProductsData.length > 0) {
      console.log("\n📸 Sample Image URLs (first 3 products):");
      allProductsData.slice(0, 3).forEach((p, i) => {
        console.log(`  ${i + 1}. ${p.title.substring(0, 40)}...`);
        console.log(`     Image: ${p.imageUrl}`);
      });

      const cdnCount = allProductsData.filter(
        (p) => p.imageUrl.includes("cdn") || !p.imageUrl.includes("placeholder")
      ).length;
      const placeholderCount = allProductsData.filter((p) =>
        p.imageUrl.includes("placeholder")
      ).length;
      console.log(`\n  ✓ Valid images: ${cdnCount}/${allProductsData.length}`);
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
    try {
      const { stock, description, rawSpecsText } = await getStockAndDescription(
        browser,
        product.productUrl
      );

      // 🔥 AI-powered brand extraction
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
    } catch (error) {
      console.error(
        `❌ Failed to process product: ${product.title.substring(0, 30)}...`
      );
      console.error(`   Error: ${error.message}`);
      throw error;
    }
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
