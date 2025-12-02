import puppeteer from "puppeteer";
import { PrismaClient, StockStatus, StoreName, Category } from "@prisma/client";
import OpenAI from "openai";

// --- GLOBAL CONFIGURATION ---
const prisma = new PrismaClient();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); // Ensure OPENAI_API_KEY is in your .env

const PRODUCT_SELECTOR = ".ProductList_tileWrapper__V1Z9h";
const SHOW_MORE_BUTTON_SELECTOR = "button.secondaryOnLight";
const MAX_CLICKS = 50;
const STORE_NAME_FIXED = StoreName.XCITE; // Using Enum
const DOMAIN = "https://www.xcite.com";

// --- CONCURRENCY SETTING ---
const CONCURRENT_LIMIT = 5; // Reduced slightly to handle OpenAI rate limits safely

/**
 * Maps Schema.org availability strings to the Prisma StockStatus Enum.
 */
const AVAILABILITY_MAP = {
  "https://schema.org/InStock": StockStatus.IN_STOCK,
  "https://schema.org/OutOfStock": StockStatus.OUT_OF_STOCK,
};

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
// --- UNIFIED FUNCTION: SCRAPE STOCK AND DESCRIPTION ---
// -------------------------------------------------------------------

async function getStockAndDescription(browser, url) {
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  let stockStatus = StockStatus.IN_STOCK;
  let description = "";

  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });

    // --- UNIFIED IN-BROWSER LOGIC ---
    const pageDetails = await page.evaluate(() => {
      let availability = null;
      let rawDescription = null;

      const productSchema = document.querySelector(
        '[itemtype="https://schema.org/Product"]'
      );

      // Stock Check 1: Visible "Out of Stock" element (Highest Priority)
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

      if (productSchema) {
        // Get description from schema meta tag
        rawDescription = productSchema
          .querySelector('[itemprop="description"]')
          ?.getAttribute("content");

        // Stock Check 2: Schema fallback
        if (availability === null) {
          const offersSchema = productSchema.querySelector(
            '[itemprop="offers"]'
          );
          availability = offersSchema
            ? offersSchema
                .querySelector('[itemprop="availability"]')
                ?.getAttribute("content")
            : null;
        }
      }

      // Stock Check 3: Last fallback for "In Stock" text
      if (availability === null) {
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

      // Fallback description from specifications list if schema description is null
      if (!rawDescription) {
        const specList = document.querySelector(
          ".ProductOverview_list__7LEwB ul"
        );
        if (specList) {
          rawDescription = Array.from(specList.querySelectorAll("li"))
            .map((li) => li.textContent.trim())
            .join(" | ");
        }
      }

      return { availability, rawDescription: rawDescription || "" };
    });

    // --- Node.js Side: Cleaning and Mapping ---
    const { availability, rawDescription } = pageDetails;

    // 1. Map Stock Status
    if (availability) {
      const lowerCaseStatus = availability.toLowerCase();
      if (
        lowerCaseStatus.includes("out of stock online") ||
        availability === AVAILABILITY_MAP["https://schema.org/OutOfStock"]
      ) {
        stockStatus = StockStatus.OUT_OF_STOCK;
      } else if (
        lowerCaseStatus.includes("in stock") ||
        availability === AVAILABILITY_MAP["https://schema.org/InStock"]
      ) {
        stockStatus = StockStatus.IN_STOCK;
      }
    }

    // 2. Clean Description (Applying Regex Filter)
    description = rawDescription
      .replace(/(\*|\-|\u2022|&quot;)/g, "") // Remove bullet points (*, -, unicode bullet, &quot;)
      .replace(/\s+/g, " ") // Replace multiple spaces/newlines with a single space
      .trim();
  } catch (e) {
    console.warn(
      `\n⚠️ Failed to check details for ${url}. Error: ${e.message}`
    );
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
 * Main function to navigate, scrape, and save to DB.
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

  // --- Category Crawl Logic (Using shared browser instance) ---
  const categoryPage = await browser.newPage();
  categoryPage.setDefaultTimeout(90000);
  await categoryPage.setViewport({ width: 1280, height: 800 });

  try {
    console.log(
      `Navigating to category page (${RAW_CATEGORY_NAME} mapped to ${STRICT_CATEGORY})...`
    );
    await categoryPage.goto(TARGET_URL, {
      waitUntil: "networkidle2",
      timeout: 60000,
    });

    // --- Pagination Logic ---
    await categoryPage.waitForSelector(PRODUCT_SELECTOR, { timeout: 30000 });
    await new Promise((resolve) => setTimeout(resolve, 2000));
    let productsCount = await categoryPage.$$eval(
      PRODUCT_SELECTOR,
      (tiles) => tiles.length
    );

    let clickCount = 0;
    let consecutiveFailures = 0;
    const MAX_CONSECUTIVE_FAILURES = 3;

    while (clickCount < MAX_CLICKS) {
      clickCount++;
      await categoryPage.evaluate(() =>
        window.scrollTo(0, document.body.scrollHeight)
      );
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const currentCount = await categoryPage.$$eval(
        PRODUCT_SELECTOR,
        (tiles) => tiles.length
      );
      try {
        const buttonExists = await categoryPage.$(SHOW_MORE_BUTTON_SELECTOR);
        if (!buttonExists) {
          consecutiveFailures++;
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            productsCount = currentCount;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 2000));
          continue;
        }
        await categoryPage.waitForSelector(SHOW_MORE_BUTTON_SELECTOR, {
          visible: true,
          timeout: 8000,
        });
        await categoryPage.click(SHOW_MORE_BUTTON_SELECTOR);
        await new Promise((resolve) => setTimeout(resolve, 6000));
        const newCount = await categoryPage.$$eval(
          PRODUCT_SELECTOR,
          (tiles) => tiles.length
        );
        if (newCount > currentCount) {
          productsCount = newCount;
          consecutiveFailures = 0;
        } else {
          consecutiveFailures++;
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            productsCount = newCount;
            break;
          }
        }
      } catch (e) {
        consecutiveFailures++;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          productsCount = await categoryPage.$$eval(
            PRODUCT_SELECTOR,
            (tiles) => tiles.length
          );
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
    console.log(
      `✅ Finished loading phase. Total tiles found: ${productsCount}`
    );

    // Extracting data from tiles
    await categoryPage.evaluate(async (selector) => {
      const tiles = document.querySelectorAll(selector);
      for (let i = 0; i < tiles.length; i++) {
        tiles[i].scrollIntoView({ behavior: "auto", block: "center" });
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }, PRODUCT_SELECTOR);

    allProductsData = await categoryPage.$$eval(
      PRODUCT_SELECTOR,
      (tiles, category, store, domain) => {
        const extractProductData = (tile) => {
          try {
            const storeName = store;
            const title =
              tile
                .querySelector(".ProductTile_productName__wEJB5")
                ?.textContent.trim() || "N/A";
            const relativeUrl = tile.querySelector("a")?.getAttribute("href");
            let productUrl = relativeUrl
              ? relativeUrl.startsWith("http")
                ? relativeUrl
                : `${domain}${
                    relativeUrl.startsWith("/")
                      ? relativeUrl
                      : "/" + relativeUrl
                  }`
              : "N/A";

            let priceText =
              tile
                .querySelector("span.text-2xl.text-functional-red-800.block")
                ?.textContent.trim() || "N/A";
            if (priceText === "N/A") {
              const h4 = tile.querySelector("h4");
              if (h4)
                priceText = Array.from(h4.childNodes)
                  .filter((node) => node.nodeType === 3)
                  .map((node) => node.textContent.trim())
                  .join(" ")
                  .trim();
            }
            const price =
              parseFloat(
                priceText.replace(/KD/gi, "").replace(/,/g, "").trim()
              ) || 0;

            let imageUrl = "https://example.com/placeholder-image.png";
            const imgElement =
              tile.querySelector("img[data-cs-capture]") ||
              tile.querySelector("img");
            if (imgElement) {
              const srcset = imgElement.getAttribute("srcset") || "";
              if (srcset) {
                const srcsetUrls = srcset.split(",").map((s) => s.trim());
                const highRes = srcsetUrls.find((s) => s.includes("2x"));
                let urlToUse = highRes
                  ? highRes.split(" ")[0]
                  : srcsetUrls.length > 0
                  ? srcsetUrls[0].split(" ")[0]
                  : null;
                if (urlToUse && urlToUse.startsWith("http"))
                  imageUrl = urlToUse;
              } else {
                const src = imgElement.getAttribute("src") || "";
                if (
                  src &&
                  src.startsWith("http") &&
                  !src.includes("data:image")
                )
                  imageUrl = src;
              }
            }

            return { storeName, title, price, imageUrl, productUrl }; // Note: category passed via scope but not needed in return for now
          } catch (e) {
            return null;
          }
        };
        return tiles.map(extractProductData).filter((data) => data !== null);
      },
      STRICT_CATEGORY,
      STORE_NAME_FIXED,
      DOMAIN
    );
  } catch (error) {
    throw error;
  } finally {
    if (categoryPage) await categoryPage.close();
  }

  // Filter invalid products before processing
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
    `Starting concurrent stock/description check for ${validProducts.length} valid products...`
  );

  // --- CONCURRENT BATCH PROCESSING FOR STOCK/DESCRIPTION/VECTOR CHECK & DB SAVE ---

  const productUpdateTask = async (product) => {
    // 1. Scrape stock and description
    const { stock: currentStockStatus, description } =
      await getStockAndDescription(browser, product.productUrl);

    // 2. Generate Intelligent Fields
    const brand = extractBrand(product.title);
    const specs = extractSpecs(product.title, description);

    // 3. Generate Search Key (The Text Context)
    const searchKey = generateCascadingContext(
      product.title,
      brand,
      specs,
      product.price,
      description
    );

    // 4. Generate Embedding (The Vector)
    const vector = await getEmbedding(searchKey);

    const upsertData = {
      title: product.title,
      description: description,
      category: STRICT_CATEGORY, // Use Strict Enum
      price: product.price,
      imageUrl: product.imageUrl,
      stock: currentStockStatus,
      lastSeenAt: new Date(),
      brand: brand, // New field
      specs: specs, // New field (Json)
      searchKey: searchKey, // New field (Text)
    };

    // 5. Save Standard Data
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

    // 6. Save Vector Data (Using Raw SQL)
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

  // --- Batch Processing Loop ---
  for (let i = 0; i < validProducts.length; i += CONCURRENT_LIMIT) {
    const batch = validProducts.slice(i, i + CONCURRENT_LIMIT);

    console.log(
      `\n➡️ Processing batch ${Math.ceil(
        (i + 1) / CONCURRENT_LIMIT
      )}/${Math.ceil(validProducts.length / CONCURRENT_LIMIT)} (${
        i + 1
      } to ${Math.min(i + CONCURRENT_LIMIT, validProducts.length)})...`
    );

    const batchPromises = batch.map((product) => productUpdateTask(product));
    const batchResults = await Promise.allSettled(batchPromises);

    for (const stockResult of batchResults) {
      totalProcessed++;
      if (stockResult.status === "fulfilled") {
        const res = stockResult.value;
        if (res.isNew) createdCount++;
        else updatedCount++;
        if (res.status !== StockStatus.IN_STOCK) {
          console.log(`   [${res.status}] ${res.result.title}`);
        }
      } else {
        errorCount++;
        console.error(
          `❌ Batch Error: A product check failed: ${stockResult.reason}`
        );
      }
    }
  }

  // --- FINAL SUMMARY & SAMPLE ---
  let totalSavedCount = createdCount + updatedCount;

  console.log(`\n=== JOB SUMMARY: ${RAW_CATEGORY_NAME.toUpperCase()} ===`);
  console.log(`Total Products Extracted: ${allProductsData.length}`);
  console.log(`✅ Created: ${createdCount}`);
  console.log(`🔄 Updated: ${updatedCount}`);
  console.log(`⏭️  Skipped (Invalid Data): ${skippedCount}`);
  console.log(`❌ Errors (Stock/DB): ${errorCount}`);
  console.log(`📊 FINAL UNIQUE PRODUCTS SAVED/UPDATED: ${totalSavedCount}`);
  console.log("========================================\n");
}

export default scrapeProducts;
