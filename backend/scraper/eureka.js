import puppeteer from "puppeteer";
import { PrismaClient, StockStatus, StoreName, Category } from "@prisma/client";
import OpenAI from "openai";

// --- GLOBAL CONFIGURATION ---
const prisma = new PrismaClient();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Eureka Specific Selectors based on your HTML
const PRODUCT_SELECTOR = ".col-sm-3.width50"; // The wrapper for the tile
const SHOW_MORE_BUTTON_SELECTOR = "#btnLoadMore"; // Common ID for Eureka, or we rely on scroll
const STORE_NAME_FIXED = StoreName.EUREKA; // Ensure 'EUREKA' is in your Prisma Enum
const DOMAIN = "https://www.eureka.com.kw";

// --- CONCURRENCY SETTING ---
const CONCURRENT_LIMIT = 5;

/**
 * Maps Schema.org availability strings to the Prisma StockStatus Enum.
 */
const AVAILABILITY_MAP = {
  "https://schema.org/InStock": StockStatus.IN_STOCK,
  "https://schema.org/OutOfStock": StockStatus.OUT_OF_STOCK,
};

// -------------------------------------------------------------------
// --- HELPER FUNCTIONS (Shared Logic) ---
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

  if (lower.includes("headphone") || lower.includes("headset"))
    return Category.HEADPHONE;
  if (
    lower.includes("earphone") ||
    lower.includes("buds") ||
    lower.includes("airpods")
  )
    return Category.EARPHONE;
  if (lower.includes("laptop") || lower.includes("macbook"))
    return Category.LAPTOP;
  if (
    lower.includes("tablet") ||
    lower.includes("ipad") ||
    lower.includes("tab")
  )
    return Category.TABLET;
  if (lower.includes("watch")) return Category.WATCH;
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
    "charcoal",
  ];
  const foundColor = colors.find((c) => text.includes(c));
  if (foundColor)
    specs.color = foundColor.charAt(0).toUpperCase() + foundColor.slice(1);

  return specs;
}

function extractBrand(title, explicitBrand) {
  // Eureka sometimes provides a hidden input with the exact brand
  if (explicitBrand && explicitBrand.length > 1) return explicitBrand;

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
    "Nokia",
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
// --- EUREKA SPECIFIC: SCRAPE STOCK AND DESCRIPTION ---
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// --- EUREKA SPECIFIC: SCRAPE STOCK AND DESCRIPTION (FIXED) ---
// -------------------------------------------------------------------

async function getStockAndDescription(browser, url) {
  const page = await browser.newPage();
  // Use a realistic user agent to prevent bot detection blocking dynamic content
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );
  page.setDefaultTimeout(45000);

  // Default values
  let stockStatus = StockStatus.OUT_OF_STOCK;
  let description = "";
  let brand = "";

  try {
    await page.goto(url, { waitUntil: "networkidle2" });

    // Wait briefly for Angular to render the stock element
    try {
      await page.waitForSelector(".product_detail", { timeout: 8000 });
    } catch (e) {
      // Proceed even if main container isn't fully ready, we might still find data
    }

    const pageDetails = await page.evaluate(() => {
      let isAvailable = false;
      let rawDescription = "";
      let explicitBrand = "";

      // --- 1. STOCK CHECK (Updated based on your HTML) ---
      const stockElement = document.querySelector(".product-stock .stock-text");

      if (stockElement) {
        const text = stockElement.textContent.trim().toLowerCase();
        // Check if the element has text "in stock" and is visible
        if (text.includes("in stock") || text.includes("available")) {
          isAvailable = true;
        }
      }

      // Fallback: Check for the Buy buttons if the text check fails
      const addToCartBtn = document.getElementById("AddToCart");
      if (!isAvailable && addToCartBtn && addToCartBtn.offsetParent !== null) {
        isAvailable = true;
      }

      const buyNowBtn = document.querySelector(".abynwcart");
      if (!isAvailable && buyNowBtn && buyNowBtn.offsetParent !== null) {
        isAvailable = true;
      }

      // --- 2. DESCRIPTION ---
      const keyFeatures = document.querySelector(".product-description");
      if (keyFeatures) rawDescription += keyFeatures.innerText;

      const summary = document.querySelector("#specificationDetails");
      if (summary) rawDescription += " " + summary.innerText;

      // --- 3. BRAND ---
      const brandInput = document.querySelector("input#ItemBrand");
      if (brandInput) explicitBrand = brandInput.value;

      return { isAvailable, rawDescription, explicitBrand };
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

    brand = pageDetails.explicitBrand;
  } catch (e) {
    console.warn(
      `\n⚠️ Failed to check details for ${url}. Error: ${e.message}`
    );
  } finally {
    await page.close();
  }

  return { stock: stockStatus, description, explicitBrand: brand };
}
// -------------------------------------------------------------------
// --- MAIN SCRAPER ---
// -------------------------------------------------------------------

async function scrapeProducts(browser, TARGET_URL, RAW_CATEGORY_NAME) {
  const STRICT_CATEGORY = mapCategory(RAW_CATEGORY_NAME);

  let allProductsData = [];
  let createdCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  const categoryPage = await browser.newPage();
  categoryPage.setDefaultTimeout(90000);
  await categoryPage.setViewport({ width: 1280, height: 800 });

  try {
    console.log(`Navigating to Eureka category (${RAW_CATEGORY_NAME})...`);
    await categoryPage.goto(TARGET_URL, {
      waitUntil: "networkidle2",
      timeout: 60000,
    });

    // --- Infinite Scroll / Loading Logic ---
    // Eureka is Angular based. We need to scroll down to trigger lazy loading
    // or click "Load More" if it exists.
    let previousHeight = 0;
    let scrollAttempts = 0;
    const MAX_SCROLL_ATTEMPTS = 20; // Adjust based on how many items you want

    while (scrollAttempts < MAX_SCROLL_ATTEMPTS) {
      scrollAttempts++;
      previousHeight = await categoryPage.evaluate(
        "document.body.scrollHeight"
      );
      await categoryPage.evaluate(
        "window.scrollTo(0, document.body.scrollHeight)"
      );

      // Wait for network idle or timeout to allow Angular to render ng-repeat
      await new Promise((r) => setTimeout(r, 2000));

      // Check if a "Load More" button exists and click it (Common in some Eureka views)
      const loadMoreVisible = await categoryPage.$(SHOW_MORE_BUTTON_SELECTOR);
      if (loadMoreVisible) {
        try {
          await categoryPage.click(SHOW_MORE_BUTTON_SELECTOR);
          await new Promise((r) => setTimeout(r, 2000));
        } catch (e) {
          /* ignore click errors */
        }
      }

      const newHeight = await categoryPage.evaluate(
        "document.body.scrollHeight"
      );
      if (newHeight === previousHeight && !loadMoreVisible) {
        break; // Stop if no new content loaded
      }
    }

    // --- Extract Data from Tiles ---
    allProductsData = await categoryPage.$$eval(
      PRODUCT_SELECTOR,
      (tiles, category, store, domain) => {
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

              // 3. Price (Eureka uses two spans usually, current price is red)
              let price = 0;
              // Look for the specific red span from your HTML snippet
              const priceEl = tile.querySelector(
                ".caption span[style*='color:red']"
              );
              if (priceEl) {
                const priceTxt = priceEl.textContent.replace("KD", "").trim();
                price = parseFloat(priceTxt) || 0;
              }

              // 4. Image (Handle Eureka Lazy Loading)
              let imageUrl = "";
              const imgEl = tile.querySelector(".prdimg img");
              if (imgEl) {
                // Eureka uses 'bn-lazy-src' for lazy loading, 'src' might be a placeholder
                const lazySrc = imgEl.getAttribute("bn-lazy-src");
                const normalSrc = imgEl.getAttribute("src");
                imageUrl = lazySrc || normalSrc || "";

                if (imageUrl && !imageUrl.startsWith("http")) {
                  // Sometimes images are relative
                  imageUrl = imageUrl.startsWith("/")
                    ? domain + imageUrl
                    : imageUrl;
                }
              }

              return { storeName: store, title, price, imageUrl, productUrl };
            } catch (e) {
              return null;
            }
          })
          .filter((p) => p !== null);
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

  // Filter invalid products
  const validProducts = allProductsData.filter(
    (p) => p.title !== "N/A" && p.productUrl !== "N/A" && p.price > 0
  );

  console.log(
    `Extracted ${validProducts.length} items. Starting detailed check...`
  );

  // --- PROCESSING LOOP (Details & DB) ---
  const productUpdateTask = async (product) => {
    // 1. Scrape details
    const { stock, description, explicitBrand } = await getStockAndDescription(
      browser,
      product.productUrl
    );

    // 2. Intelligence
    const brand = extractBrand(product.title, explicitBrand);
    const specs = extractSpecs(product.title, description);
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
      category: STRICT_CATEGORY,
      price: product.price,
      imageUrl: product.imageUrl,
      stock: stock,
      lastSeenAt: new Date(),
      brand: brand,
      specs: specs,
      searchKey: searchKey,
    };

    // 3. Save to DB
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
      select: { id: true, createdAt: true },
    });

    // 4. Update Vector
    if (vector) {
      const vectorString = `[${vector.join(",")}]`;
      await prisma.$executeRaw`
            UPDATE "Product"
            SET "descriptionEmbedding" = ${vectorString}::vector
            WHERE id = ${record.id}
          `;
    }

    return {
      isNew: record.createdAt.getTime() > Date.now() - 5000,
      status: stock,
    };
  };

  // Batch Processing
  for (let i = 0; i < validProducts.length; i += CONCURRENT_LIMIT) {
    const batch = validProducts.slice(i, i + CONCURRENT_LIMIT);
    console.log(`Processing batch ${i / CONCURRENT_LIMIT + 1}...`);

    const results = await Promise.allSettled(batch.map(productUpdateTask));

    results.forEach((res) => {
      if (res.status === "fulfilled") {
        if (res.value.isNew) createdCount++;
        else updatedCount++;
      } else {
        errorCount++;
        console.error("Error processing item:", res.reason);
      }
    });
  }

  console.log(`\n=== JOB SUMMARY: EUREKA ===`);
  console.log(
    `✅ Created: ${createdCount} | 🔄 Updated: ${updatedCount} | ❌ Errors: ${errorCount}`
  );
}

export default scrapeProducts;
