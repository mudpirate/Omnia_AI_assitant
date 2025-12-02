import puppeteer from "puppeteer";
import { PrismaClient, StockStatus, StoreName, Category } from "@prisma/client";
import OpenAI from "openai";

// --- GLOBAL CONFIGURATION ---
const prisma = new PrismaClient();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); // Ensure OPENAI_API_KEY is in .env

const PRODUCT_SELECTOR = "best-product-grid-item"; // Selector for product tiles
const DOMAIN = "https://best.com.kw";
const STORE_NAME_FIXED = StoreName.BEST_KW; // Using strict Enum

// --- CONCURRENCY SETTING ---
const CONCURRENT_LIMIT = 5; // Reduced slightly to ensure OpenAI rate limits are respected

// -------------------------------------------------------------------
// --- HELPER FUNCTIONS FOR AI CONTEXT & VECTORS ---
// -------------------------------------------------------------------

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

function mapCategory(rawInput) {
  const lower = rawInput.toLowerCase();

  // 1. Check Specific Audio Categories FIRST (because they might contain "phone")
  if (lower.includes("headphone") || lower.includes("headset"))
    return Category.HEADPHONE;
  if (
    lower.includes("earphone") ||
    lower.includes("buds") ||
    lower.includes("airpods")
  )
    return Category.EARPHONE;

  // 2. Check Laptops/Tablets
  if (lower.includes("laptop") || lower.includes("macbook"))
    return Category.LAPTOP;
  if (
    lower.includes("tablet") ||
    lower.includes("ipad") ||
    lower.includes("tab")
  )
    return Category.TABLET;
  if (lower.includes("watch")) return Category.WATCH;

  // 3. Check Mobile Phones LAST (Generic "phone" catch-all)
  if (lower.includes("phone") || lower.includes("mobile"))
    return Category.MOBILE_PHONE;

  return Category.ACCESSORY;
}

function extractSpecs(title, description) {
  const text = (title + " " + description).toLowerCase();
  const specs = {};

  const storageMatch = text.match(/(\d{3}|\d{2}|\d{1})\s?(gb|tb)/);
  if (storageMatch) specs.storage = storageMatch[0].toUpperCase();

  const ramMatch = text.match(/(\d{1,2})\s?gb\s?ram/);
  if (ramMatch) specs.ram = ramMatch[0].toUpperCase();

  const colors = [
    "black",
    "white",
    "silver",
    "gold",
    "blue",
    "red",
    "green",
    "grey",
    "gray",
    "titanium",
    "purple",
  ];
  const foundColor = colors.find((c) => text.includes(c));
  if (foundColor)
    specs.color = foundColor.charAt(0).toUpperCase() + foundColor.slice(1);

  return specs;
}

function extractBrand(title) {
  const knownBrands = [
    "Apple",
    "Samsung",
    "Xiaomi",
    "Huawei",
    "Honor",
    "Lenovo",
    "HP",
    "Dell",
    "Asus",
    "Sony",
    "Bose",
    "JBL",
    "Microsoft",
  ];
  const titleLower = title.toLowerCase();
  for (const brand of knownBrands) {
    if (titleLower.includes(brand.toLowerCase())) return brand;
  }
  return title.split(" ")[0];
}

function generateCascadingContext(title, brand, specs, price, description) {
  let context = `${brand} ${title}.`;

  const specList = [];
  if (specs.ram) specList.push(`${specs.ram} RAM`);
  if (specs.storage) specList.push(`${specs.storage} Storage`);
  if (specs.color) specList.push(`Color: ${specs.color}`);

  if (specList.length > 0) context += ` Specs: ${specList.join(", ")}.`;

  context += ` Price: ${price} KWD.`;

  if (description && description.length > 20) {
    const cleanDesc = description.substring(0, 300).replace(/\s+/g, " ").trim();
    context += ` Features: ${cleanDesc}`;
  }
  return context;
}

// -------------------------------------------------------------------
// --- UNIFIED FUNCTION: SCRAPE STOCK AND DESCRIPTION (BEST.KW SPECIFIC) ---
// -------------------------------------------------------------------

/**
 * Executes a dedicated page navigation to scrape both stock and description efficiently.
 *
 * @param {puppeteer.Browser} browser - The shared browser instance.
 * @param {string} url - The URL of the product page.
 * @returns {Promise<{stock: StockStatus, description: string}>} The determined status and cleaned description.
 */
async function getStockAndDescription(browser, url) {
  const page = await browser.newPage();
  // Increased timeout because Angular sites can be slow to render specific components
  page.setDefaultTimeout(45000);

  let stockStatus = StockStatus.IN_STOCK;
  let description = "";

  try {
    // 1. Navigate
    await page.goto(url, { waitUntil: "networkidle2" });

    // 2. WAIT for the product summary to ensure the DOM is populated
    await page.waitForSelector("best-product-summary", { timeout: 20000 });

    // --- IN-BROWSER LOGIC ---
    const pageDetails = await page.evaluate(() => {
      let isOutOfStock = false;
      let rawDescription = "";

      // --- CHECK 1: BUTTON STATE (Stock Check) ---
      const addToCartBtn = document.querySelector("button.add-to-cart-btn");
      const buyNowBtn = document.querySelector("button.buy-now-btn");

      const isCartDisabled = addToCartBtn
        ? addToCartBtn.hasAttribute("disabled")
        : false;
      const isBuyDisabled = buyNowBtn
        ? buyNowBtn.hasAttribute("disabled")
        : false;

      // --- CHECK 2: EXPLICIT TEXT CLASS (Stock Check) ---
      const outOfStockLabel = document.querySelector(".outofstock");

      if (isCartDisabled || isBuyDisabled || outOfStockLabel) {
        isOutOfStock = true;
      }

      // --- DESCRIPTION SCRAPING ---

      // Target the specific container from your HTML snippet:
      // <best-product-details-tab ...> <div class="container-fluid"> <ul>...
      const descriptionContainer = document.querySelector(
        "best-product-details-tab .container-fluid"
      );

      if (descriptionContainer) {
        // Option A: If it is a list (<ul>), join items with a separator
        const listItems = Array.from(
          descriptionContainer.querySelectorAll("li")
        );
        if (listItems.length > 0) {
          rawDescription = listItems
            .map((li) => li.innerText.replace(/\s+/g, " ").trim()) // Clean individual lines
            .join(" | "); // Join with a separator
        } else {
          // Option B: If no list, just take the paragraph text
          rawDescription = descriptionContainer.innerText;
        }
      }

      // Fallback: Try the summary description if the tab is empty
      if (!rawDescription) {
        const summaryDesc = document.querySelector(
          ".best-product-summary .description"
        );
        if (summaryDesc) {
          rawDescription = summaryDesc.innerText;
        }
      }

      return { isOutOfStock, rawDescription: rawDescription || "" };
    });

    // --- Node.js Side Processing ---
    if (pageDetails.isOutOfStock) {
      stockStatus = StockStatus.OUT_OF_STOCK;
    }

    // Final clean up of the string
    description = pageDetails.rawDescription
      .replace(/(\r\n|\n|\r)/gm, " ") // Remove newlines
      .replace(/\s+/g, " ") // Replace multiple spaces with single space
      .trim()
      .substring(0, 1000); // Truncate to safe database length
  } catch (e) {
    console.warn(`\n⚠️ Failed details for ${url}: ${e.message}`);
    // Default to OUT_OF_STOCK on error to avoid false positives
    stockStatus = StockStatus.OUT_OF_STOCK;
    description = "";
  } finally {
    await page.close();
  }

  return { stock: stockStatus, description: description };
}

// -------------------------------------------------------------------
// --- MAIN SCRAPER ---
// -------------------------------------------------------------------

/**
 * Main function to launch the browser, navigate, scrape, and save to DB.
 */
async function scrapeProducts(browser, TARGET_URL, RAW_CATEGORY_NAME) {
  // 1. Map the Category immediately
  const STRICT_CATEGORY = mapCategory(RAW_CATEGORY_NAME);

  let allProductsData = [];
  let createdCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  let totalProcessed = 0;

  // --- Initial Category Page Crawl Logic ---
  const categoryPage = await browser.newPage();
  categoryPage.setDefaultTimeout(90000);
  await categoryPage.setViewport({ width: 1280, height: 800 });

  try {
    console.log(
      `🚀 Starting category scrape for ${RAW_CATEGORY_NAME} (Mapped: ${STRICT_CATEGORY}) at ${TARGET_URL}`
    );

    let currentUrl = TARGET_URL;
    let pageNum = 1;
    let hasNextPage = true;

    // --- WHILE LOOP: KEEP GOING UNTIL NO NEXT PAGE ---
    while (hasNextPage) {
      console.log(`\n➡️ Processing Page ${pageNum}: ${currentUrl}`);

      try {
        await categoryPage.goto(currentUrl, { waitUntil: "networkidle2" });

        // Wait for product grid OR valid empty state
        try {
          await categoryPage.waitForSelector(PRODUCT_SELECTOR, {
            timeout: 20000,
          });
        } catch (e) {
          console.warn(
            "⚠️ No products found on this page (selector timeout). checking if pagination exists..."
          );
        }

        // 1. Scroll to trigger lazy loading
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

        // 2. Extract Data
        const pageProducts = await categoryPage.$$eval(
          PRODUCT_SELECTOR,
          (tiles, domain, storeEnum) => {
            const extractProductData = (tile) => {
              try {
                const cleanPrice = (txt) =>
                  parseFloat(txt.replace("KD", "").replace(/,/g, "").trim()) ||
                  0;
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

                let imageUrl = "https://example.com/placeholder-image.png";
                const imgElement =
                  tile.querySelector("cx-media img") ||
                  tile.querySelector("img");
                if (imgElement) {
                  const src = imgElement.getAttribute("src");
                  if (src && src.startsWith("http")) imageUrl = src;
                }

                const currentPriceElement =
                  tile.querySelector(".cx-product-price");
                const price = currentPriceElement
                  ? cleanPrice(currentPriceElement.textContent)
                  : 0;

                return {
                  storeName: storeEnum,
                  title,
                  price,
                  imageUrl,
                  productUrl,
                };
              } catch (e) {
                return null;
              }
            };
            return tiles
              .map(extractProductData)
              .filter((data) => data && data.price > 0 && data.title !== "N/A");
          },
          DOMAIN,
          STORE_NAME_FIXED
        );

        if (pageProducts.length === 0) {
          console.log(`⚠️ Page ${pageNum} loaded but found zero products.`);
        } else {
          console.log(
            `   ✅ Scraped ${pageProducts.length} products from page ${pageNum}.`
          );
          allProductsData = allProductsData.concat(pageProducts);
        }

        // 3. CHECK FOR NEXT PAGE
        const nextPageInfo = await categoryPage.evaluate(() => {
          // Select the "Next" button (The right arrow)
          const nextBtn = document.querySelector(".cx-pagination a.next");

          if (nextBtn) {
            // Check if it has the "disabled" class (as seen in your HTML)
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
          // Prepare URL for next loop
          if (nextPageInfo.href.startsWith("http")) {
            currentUrl = nextPageInfo.href;
          } else {
            // Ensure we don't double slash if domain ends with / and href starts with /
            const baseUrl = "https://best.com.kw";
            currentUrl = `${baseUrl}${
              nextPageInfo.href.startsWith("/") ? "" : "/"
            }${nextPageInfo.href}`;
          }
          pageNum++;
          hasNextPage = true;
        } else {
          console.log(
            `🛑 Reached last page (Next button is disabled or missing). Stopping crawl.`
          );
          hasNextPage = false;
        }
      } catch (e) {
        console.error(`⚠️ Error on page ${pageNum}: ${e.message}`);
        hasNextPage = false; // Stop on critical error
      }
    } // End While Loop
  } catch (error) {
    throw error;
  } finally {
    if (categoryPage) await categoryPage.close();
  }

  // --- PROCESSING VALID PRODUCTS ---

  const validProducts = allProductsData.filter(
    (product) =>
      product.title &&
      product.title !== "N/A" &&
      product.productUrl &&
      product.productUrl !== "N/A" &&
      product.price > 0
  );

  skippedCount = allProductsData.length - validProducts.length;

  console.log(
    `\nStarting concurrent stock/description check for ${validProducts.length} valid products...`
  );

  // --- CONCURRENT BATCH PROCESSING WITH VECTORS ---

  const productUpdateTask = async (product) => {
    // 1. Scrape Stock & Description (Using your existing logic)
    const { stock: currentStockStatus, description } =
      await getStockAndDescription(browser, product.productUrl);

    // 2. Generate Intelligent Fields (Brand, Specs, SearchKey)
    const brand = extractBrand(product.title);
    const specs = extractSpecs(product.title, description);
    const searchKey = generateCascadingContext(
      product.title,
      brand,
      specs,
      product.price,
      description
    );

    // 3. Generate Vector
    const vector = await getEmbedding(searchKey);

    const upsertData = {
      title: product.title,
      description: description,
      category: STRICT_CATEGORY, // Use Strict Enum
      price: product.price,
      imageUrl: product.imageUrl,
      stock: currentStockStatus,
      lastSeenAt: new Date(),
      brand: brand,
      specs: specs,
      searchKey: searchKey,
    };

    // 4. Upsert Data (Standard Fields)
    const record = await prisma.product.upsert({
      where: {
        storeName_productUrl: {
          storeName: product.storeName,
          productUrl: product.productUrl,
        },
      },
      update: upsertData,
      create: {
        ...upsertData,
        storeName: product.storeName,
        productUrl: product.productUrl,
        scrapedAt: new Date(),
      },
      select: { id: true, createdAt: true, title: true, stock: true },
    });

    // 5. Save Vector (Raw SQL)
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
      status: currentStockStatus,
      isNew: record.createdAt.getTime() > Date.now() - 5000,
    };
  };

  // --- Batch Loop ---
  for (let i = 0; i < validProducts.length; i += CONCURRENT_LIMIT) {
    const batch = validProducts.slice(i, i + CONCURRENT_LIMIT);
    console.log(
      `\n➡️ Processing batch ${Math.ceil(
        (i + 1) / CONCURRENT_LIMIT
      )}/${Math.ceil(validProducts.length / CONCURRENT_LIMIT)}...`
    );
    const batchPromises = batch.map((product) => productUpdateTask(product));
    const batchResults = await Promise.allSettled(batchPromises);

    for (const stockResult of batchResults) {
      totalProcessed++;
      if (stockResult.status === "fulfilled") {
        const res = stockResult.value;
        if (res.isNew) createdCount++;
        else updatedCount++;
      } else {
        errorCount++;
        console.error(`❌ Batch Error: ${stockResult.reason}`);
      }
    }
  }

  // Final Summary
  console.log(`\n=== JOB SUMMARY: ${RAW_CATEGORY_NAME.toUpperCase()} ===`);
  console.log(
    `Total Found: ${allProductsData.length} | Created: ${createdCount} | Updated: ${updatedCount} | Errors: ${errorCount}`
  );
}

export default scrapeProducts;
