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
const RETRY_DELAY = 5000; // 5 seconds

// --- CONCURRENCY SETTING ---
const CONCURRENT_LIMIT = 3; // Reduced from 5 to be safer
const LLM_MODEL = "gpt-4o-mini"; 

// --- SYSTEM PROMPT (Triangle of Truth) ---
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

// -------------------------------------------------------------------
// --- HELPER FUNCTIONS ---
// -------------------------------------------------------------------

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
    console.error(`⚠️ AI Specs Extraction Failed for "${title.substring(0, 20)}...":`, error.message);
    return {};
  }
}

function mapCategory(rawInput) {
  const lower = rawInput.toLowerCase();

  if (lower.includes("headphone") || lower.includes("headset"))
    return "HEADPHONE";
  if (lower.includes("earphone") || lower.includes("buds") || lower.includes("airpods"))
    return "EARPHONE";
  if (lower.includes("laptop") || lower.includes("macbook"))
    return "LAPTOP";
  if (lower.includes("tablet") || lower.includes("ipad") || lower.includes("tab"))
    return "TABLET";
  if (lower.includes("watch")) return "WATCH";
  if (lower.includes("phone") || lower.includes("mobile"))
    return "MOBILE_PHONE";
  if (lower.includes("desktop") || lower.includes("computer") || lower.includes("pc"))
    return "DESKTOP";

  return "ACCESSORY";
}

function extractBrand(title) {
  const knownBrands = ["Apple", "Samsung", "Xiaomi", "Huawei", "Honor", "Lenovo", "HP", "Dell", "Asus", "Sony", "Bose", "JBL", "Microsoft"];
  const titleLower = title.toLowerCase();
  for (const brand of knownBrands) {
    if (titleLower.includes(brand.toLowerCase())) return brand;
  }
  return title.split(" ")[0];
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
        timeout: 60000 
      });
      
      console.log(`  ✓ Page loaded successfully`);
      return true;
      
    } catch (error) {
      console.warn(`  ⚠️ Attempt ${attempt} failed: ${error.message}`);
      
      if (attempt < maxRetries) {
        console.log(`  ⏳ Waiting ${RETRY_DELAY/1000}s before retry...`);
        await sleep(RETRY_DELAY);
      } else {
        throw new Error(`Failed to load page after ${maxRetries} attempts: ${error.message}`);
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
    
    // Set more conservative timeouts and disable images/CSS for faster loading
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if(['image', 'stylesheet', 'font'].includes(req.resourceType())){
        req.abort();
      } else {
        req.continue();
      }
    });
    
    page.setDefaultTimeout(60000);
    
    // Use retry logic for navigation
    await retryPageNavigation(page, url, 2); // Only 2 retries for product pages

    const pageDetails = await page.evaluate(() => {
      let availability = null;
      let rawDescription = null;
      let scrapedSpecs = "";

      const productSchema = document.querySelector('[itemtype="https://schema.org/Product"]');

      const outOfStockElement = document.querySelector(".typography-small.text-functional-red-800");
      if (outOfStockElement && outOfStockElement.textContent.trim().toLowerCase().includes("out of stock online")) {
        availability = "Out of stock online";
      }

      if (!availability && productSchema) {
        const offersSchema = productSchema.querySelector('[itemprop="offers"]');
        availability = offersSchema ? offersSchema.querySelector('[itemprop="availability"]')?.getAttribute("content") : null;
      }

      if (!availability) {
        const inStockElement = document.querySelector(".flex.items-center.gap-x-1 .typography-small");
        if (inStockElement && inStockElement.textContent.trim().toLowerCase().includes("in stock")) {
          availability = "In Stock";
        }
      }

      const specContainer = document.querySelector(".ProductOverview_list__7LEwB ul");
      if (specContainer) {
        scrapedSpecs = Array.from(specContainer.querySelectorAll("li"))
            .map(li => li.innerText.trim())
            .join("\n");
      }

      if (productSchema) {
         rawDescription = productSchema.querySelector('[itemprop="description"]')?.getAttribute("content");
      }
      
      if (!rawDescription && scrapedSpecs) {
          rawDescription = scrapedSpecs.replace(/\n/g, " | ");
      }

      return { availability, rawDescription: rawDescription || "", scrapedSpecs };
    });

    const { availability, rawDescription, scrapedSpecs } = pageDetails;

    if (availability) {
      const lowerCaseStatus = availability.toLowerCase();
      if (lowerCaseStatus.includes("out of stock") || availability === "https://schema.org/OutOfStock") {
        stockStatus = StockStatus.OUT_OF_STOCK;
      }
    }

    description = rawDescription
      .replace(/(\*|\-|\u2022|&quot;)/g, "")
      .replace(/\s+/g, " ")
      .trim();

    rawSpecsText = scrapedSpecs;

  } catch (e) {
    console.warn(`\n⚠️ Failed to check details for ${url}. Error: ${e.message}`);
    stockStatus = StockStatus.OUT_OF_STOCK;
  } finally {
    if (page) await page.close();
  }

  return { stock: stockStatus, description, rawSpecsText };
}

// -------------------------------------------------------------------
// --- MAIN PROCESSOR ---
// -------------------------------------------------------------------

async function scrapeProducts(browser, TARGET_URL, RAW_CATEGORY_NAME) {
  const STRICT_CATEGORY = mapCategory(RAW_CATEGORY_NAME);

  let allProductsData = [];
  let createdCount = 0, updatedCount = 0, skippedCount = 0, errorCount = 0;

  // --- 1. Crawl Category Page (Gather Links) ---
  let categoryPage;
  
  try {
    console.log(`Navigating to ${RAW_CATEGORY_NAME}...`);
    
    categoryPage = await browser.newPage();
    categoryPage.setDefaultTimeout(60000);
    
    // Use retry logic for main navigation
    await retryPageNavigation(categoryPage, TARGET_URL);
    
    // Wait for products to appear
    try {
      await categoryPage.waitForSelector(PRODUCT_SELECTOR, { timeout: 10000 });
      console.log("✓ Product grid loaded");
    } catch (e) {
      console.log("⚠️ Product selector not found initially - page may be empty or layout changed");
    }
    
    // --- PAGINATION LOGIC: Click "Show More" to Load All Products ---
    let clickCount = 0;
    let previousCount = 0;
    
    while (clickCount < MAX_CLICKS) {
      try {
        // Count current products
        const currentCount = await categoryPage.$$eval(
          PRODUCT_SELECTOR, 
          tiles => tiles.length
        ).catch(() => 0);
        
        console.log(`  📦 Products loaded: ${currentCount} (click ${clickCount + 1}/${MAX_CLICKS})`);
        
        // If no new products loaded, we're done
        if (currentCount === previousCount && clickCount > 0) {
          console.log("  ✓ No more products to load.");
          break;
        }
        
        if (currentCount === 0 && clickCount === 0) {
          console.log("  ⚠️ No products found on initial load");
          break;
        }
        
        previousCount = currentCount;
        
        // Try to find and click the "Show More" button
        const showMoreButton = await categoryPage.$(SHOW_MORE_BUTTON_SELECTOR);
        
        if (!showMoreButton) {
          console.log("  ✓ Show More button not found. All products loaded.");
          break;
        }
        
        // Check if button is visible and clickable
        const isVisible = await categoryPage.evaluate(sel => {
          const btn = document.querySelector(sel);
          if (!btn) return false;
          const style = window.getComputedStyle(btn);
          return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
        }, SHOW_MORE_BUTTON_SELECTOR);
        
        if (!isVisible) {
          console.log("  ✓ Show More button no longer visible. All products loaded.");
          break;
        }
        
        // Click the button and wait for new content
        await showMoreButton.click();
        await categoryPage.waitForTimeout(3000); // Increased wait time
        
        clickCount++;
        
      } catch (error) {
        console.log(`  ⚠️ Pagination ended: ${error.message}`);
        break;
      }
    }
    
    if (clickCount >= MAX_CLICKS) {
      console.log(`  ⚠️ Reached maximum click limit (${MAX_CLICKS}). Some products may not be loaded.`);
    }
    
    // --- Extract All Product Tiles ---
    allProductsData = await categoryPage.$$eval(
      PRODUCT_SELECTOR,
      (tiles, category, store, domain) => {
        return tiles.map(tile => {
          try {
             const title = tile.querySelector(".ProductTile_productName__wEJB5")?.textContent.trim() || "N/A";
             const relativeUrl = tile.querySelector("a")?.getAttribute("href");
             const productUrl = relativeUrl ? (relativeUrl.startsWith("http") ? relativeUrl : domain + relativeUrl) : "N/A";
             
             let priceText = tile.querySelector("span.text-2xl.text-functional-red-800.block")?.textContent.trim() || "N/A";
             if(priceText === "N/A") {
                 const h4 = tile.querySelector("h4");
                 if(h4) priceText = h4.textContent.trim();
             }
             const price = parseFloat(priceText.replace(/KD/gi, "").replace(/,/g, "").trim()) || 0;

             // --- FIXED IMAGE EXTRACTION LOGIC ---
             let imageUrl = "https://example.com/placeholder-image.png";
             const imgElement = tile.querySelector("img[data-cs-capture]") || tile.querySelector("img");
             
             if (imgElement) {
               // 1. Try to get high-res from srcset
               const srcset = imgElement.getAttribute("srcset") || "";
               if (srcset) {
                 const srcsetUrls = srcset.split(",").map((s) => s.trim());
                 const highRes = srcsetUrls.find((s) => s.includes("2x"));
                 let urlToUse = highRes
                   ? highRes.split(" ")[0]
                   : srcsetUrls.length > 0
                   ? srcsetUrls[0].split(" ")[0]
                   : null;
                 if (urlToUse && urlToUse.startsWith("http")) {
                   imageUrl = urlToUse;
                 }
               } 
               
               // 2. Fallback to normal src, but explicitly block data:image (binary)
               if (imageUrl === "https://example.com/placeholder-image.png") {
                 const src = imgElement.getAttribute("src") || "";
                 if (
                   src &&
                   src.startsWith("http") &&
                   !src.includes("data:image")
                 ) {
                   imageUrl = src;
                 }
               }
             }
             // ------------------------------------

             return { storeName: store, title, price, imageUrl, productUrl };
          } catch(e) { 
            console.error('Tile extraction error:', e);
            return null; 
          }
        }).filter(p => p !== null);
      },
      STRICT_CATEGORY,
      STORE_NAME_FIXED,
      DOMAIN
    );

  } catch (error) {
    console.error(`❌ Error during category page scraping: ${error.message}`);
    throw error;
  } finally {
    if (categoryPage) await categoryPage.close();
  }

  // --- 2. Filter Valid Products ---
  const validProducts = allProductsData.filter(p => p.title !== "N/A" && p.productUrl !== "N/A" && p.price > 0);
  console.log(`\n✅ Found ${validProducts.length} valid products. Starting detailed processing...\n`);

  if (validProducts.length === 0) {
    console.log("⚠️ No valid products found. Possible reasons:");
    console.log("   1. The URL is correct but category is empty");
    console.log("   2. The product selector '.ProductList_tileWrapper__V1Z9h' may have changed");
    console.log("   3. Network connection issues");
    console.log("   4. Website structure has changed");
    return;
  }

  // --- 3. Process Products (Scrape -> AI -> DB) ---
  const productUpdateTask = async (product) => {
    const { stock, description, rawSpecsText } = await getStockAndDescription(browser, product.productUrl);
    const specs = await generateSpecsWithAI(product.title, rawSpecsText, description);
    
    const brand = extractBrand(product.title);
    const searchKey = generateCascadingContext(product.title, brand, specs, product.price, description);
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

    const record = await prisma.product.upsert({
      where: {
        storeName_productUrl: { storeName: product.storeName, productUrl: product.productUrl },
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

    if (vector) {
      const vectorString = `[${vector.join(",")}]`;
      await prisma.$executeRaw`UPDATE "Product" SET "descriptionEmbedding" = ${vectorString}::vector WHERE id = ${record.id}`;
    }

    return { result: record, status: stock, isNew: record.createdAt.getTime() > Date.now() - 5000 };
  };

  // --- Batch Loop ---
  for (let i = 0; i < validProducts.length; i += CONCURRENT_LIMIT) {
    const batch = validProducts.slice(i, i + CONCURRENT_LIMIT);
    console.log(`➡️ Processing batch ${Math.ceil((i + 1) / CONCURRENT_LIMIT)} of ${Math.ceil(validProducts.length / CONCURRENT_LIMIT)}...`);

    const batchResults = await Promise.allSettled(batch.map(p => productUpdateTask(p)));

    for (const res of batchResults) {
      if (res.status === "fulfilled") {
        if (res.value.isNew) createdCount++; else updatedCount++;
      } else {
        errorCount++;
        console.error(`❌ Error processing item: ${res.reason}`);
      }
    }
  }

  console.log(`\n=== JOB SUMMARY ===`);
  console.log(`✅ Created: ${createdCount} | 🔄 Updated: ${updatedCount} | ❌ Errors: ${errorCount}`);
}

export default scrapeProducts;