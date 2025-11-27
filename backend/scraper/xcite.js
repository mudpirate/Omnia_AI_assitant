import puppeteer from "puppeteer";
import { PrismaClient } from "@prisma/client";

// --- GLOBAL CONFIGURATION ---
const prisma = new PrismaClient();
const PRODUCT_SELECTOR = ".ProductList_tileWrapper__V1Z9h";
const SHOW_MORE_BUTTON_SELECTOR = "button.secondaryOnLight";
const MAX_CLICKS = 50;
const STORE_NAME_FIXED = "Xcite";
const DOMAIN = "https://www.xcite.com";

/**
 * Main function to launch the browser, navigate, scrape, and save to DB.
 *
 * @param {string} TARGET_URL - The starting URL for the category page.
 * @param {string} CATEGORY_NAME - The category slug for the DB.
 */
async function scrapeProducts(TARGET_URL, CATEGORY_NAME) {
  let browser;
  let allProductsData = [];
  let totalSavedCount = 0;

  try {
    console.log(`🚀 Starting scraper for ${CATEGORY_NAME} at ${TARGET_URL}`);

    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();

    page.setDefaultTimeout(90000);
    await page.setViewport({ width: 1280, height: 800 });

    console.log("Navigating to page...");
    await page.goto(TARGET_URL, { waitUntil: "networkidle2", timeout: 60000 });

    // Wait for initial products to load
    await page.waitForSelector(PRODUCT_SELECTOR, { timeout: 30000 });
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Get initial count
    let productsCount = await page.$$eval(
      PRODUCT_SELECTOR,
      (tiles) => tiles.length
    );
    console.log(`Initial products loaded: ${productsCount}`);

    // --- SHOW MORE BUTTON CLICK LOOP ---
    console.log(`Loading all products by clicking "Show More"...`);

    let clickCount = 0;
    let consecutiveFailures = 0;
    const MAX_CONSECUTIVE_FAILURES = 3;

    while (clickCount < MAX_CLICKS) {
      clickCount++;

      // Scroll to bottom
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Get current product count before clicking
      const currentCount = await page.$$eval(
        PRODUCT_SELECTOR,
        (tiles) => tiles.length
      );

      try {
        // Wait for button to be visible
        const buttonExists = await page.$(SHOW_MORE_BUTTON_SELECTOR);

        if (!buttonExists) {
          consecutiveFailures++;
          console.log(
            `⚠️ Click ${clickCount}: Button not found in DOM. Failure ${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}`
          );

          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            console.log(
              `🛑 "Show More" button no longer available. Final count: ${currentCount}`
            );
            productsCount = currentCount;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 2000));
          continue;
        }

        await page.waitForSelector(SHOW_MORE_BUTTON_SELECTOR, {
          visible: true,
          timeout: 8000,
        });

        // Click the button
        await page.click(SHOW_MORE_BUTTON_SELECTOR);
        console.log(
          `Click ${clickCount}: Button clicked, waiting for new products...`
        );

        // Wait for new products to load
        await new Promise((resolve) => setTimeout(resolve, 6000));

        // Check new count
        const newCount = await page.$$eval(
          PRODUCT_SELECTOR,
          (tiles) => tiles.length
        );

        if (newCount > currentCount) {
          productsCount = newCount;
          consecutiveFailures = 0;
          console.log(
            `✅ Click ${clickCount}: Products loaded: ${productsCount} (added ${
              newCount - currentCount
            })`
          );
        } else {
          consecutiveFailures++;
          console.log(
            `⚠️ Click ${clickCount}: No new products. Count still ${newCount}. Failure ${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}`
          );

          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            console.log(
              `🛑 Product count stabilized at ${newCount} after ${MAX_CONSECUTIVE_FAILURES} attempts. All products loaded.`
            );
            productsCount = newCount;
            break;
          }
        }
      } catch (e) {
        consecutiveFailures++;
        console.log(
          `⚠️ Click ${clickCount}: Error - ${e.message}. Failure ${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}`
        );

        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          const finalCount = await page.$$eval(
            PRODUCT_SELECTOR,
            (tiles) => tiles.length
          );
          console.log(
            `🛑 Stopping after ${MAX_CONSECUTIVE_FAILURES} failures. Final count: ${finalCount}`
          );
          productsCount = finalCount;
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    if (clickCount >= MAX_CLICKS) {
      console.log(`⚠️ Reached maximum clicks (${MAX_CLICKS}). Stopping.`);
    }

    console.log(
      `✅ Finished loading phase. Total tiles found: ${productsCount}`
    );

    // --- SCROLL TO TRIGGER IMAGE LOADING (Optimized by moving logic inside page.evaluate) ---
    console.log("Scrolling to trigger image loading...");

    await page.evaluate(async (selector) => {
      const tiles = document.querySelectorAll(selector);
      console.log(`Total tiles to process: ${tiles.length}`);

      for (let i = 0; i < tiles.length; i++) {
        tiles[i].scrollIntoView({ behavior: "auto", block: "center" });
        // Use a short, non-blocking promise delay
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      console.log(`Finished scrolling through all ${tiles.length} tiles`);
      window.scrollTo(0, 0); // Scroll back to top
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }, PRODUCT_SELECTOR);

    // --- WAIT FOR IMAGES TO POPULATE ---
    console.log("Waiting for image attributes to populate...");

    try {
      await page.waitForFunction(
        (selector) => {
          const tiles = document.querySelectorAll(selector);
          let imagesWithSrc = 0;
          const requiredThreshold = 0.98; // 98%

          tiles.forEach((tile) => {
            const img = tile.querySelector("img[srcset], img[src^='http']");
            if (img) {
              const srcset = img.getAttribute("srcset");
              const src = img.getAttribute("src");
              if (
                (srcset && srcset.includes("http")) ||
                (src && src.startsWith("http"))
              ) {
                imagesWithSrc++;
              }
            }
          });

          const percentage = imagesWithSrc / tiles.length;
          return percentage >= requiredThreshold;
        },
        { timeout: 120000 },
        PRODUCT_SELECTOR
      );
      console.log("✅ Images loaded. Ready to extract data.");
    } catch (e) {
      console.warn(
        `⚠️ Warning: Timeout waiting for all images. Proceeding anyway.`
      );
    }

    // --- EXTRACT DATA ---
    console.log("Extracting data from all tiles...");

    allProductsData = await page.$$eval(
      PRODUCT_SELECTOR,
      (tiles, category, store, domain) => {
        // Added domain to args
        const AMPLIENCE_DOMAIN = "https://cdn.media.amplience.net";

        const extractProductData = (tile) => {
          try {
            const storeName = store;
            const title =
              tile
                .querySelector(".ProductTile_productName__wEJB5")
                ?.textContent.trim() || "N/A";

            const relativeUrl = tile.querySelector("a")?.getAttribute("href");
            let productUrl = "N/A";

            if (relativeUrl) {
              if (relativeUrl.startsWith("http")) {
                productUrl = relativeUrl;
              } else {
                productUrl = `${domain}${
                  relativeUrl.startsWith("/") ? relativeUrl : "/" + relativeUrl
                }`;
              }
            }

            // --- Price Extraction ---
            let priceText = "N/A";
            const priceElement = tile.querySelector(
              "span.text-2xl.text-functional-red-800.block"
            );
            if (priceElement) {
              priceText = priceElement.textContent.trim();
            } else {
              const h4 = tile.querySelector("h4");
              if (h4) {
                // Extract text directly from h4 nodes (to avoid sub-span issues)
                priceText = Array.from(h4.childNodes)
                  .filter((node) => node.nodeType === 3)
                  .map((node) => node.textContent.trim())
                  .join(" ")
                  .trim();
              }
            }

            // Clean price: remove "KD", commas, spaces
            const cleanedPrice = priceText
              .replace(/KD/gi, "")
              .replace(/,/g, "")
              .trim();
            const price = parseFloat(cleanedPrice) || 0;

            // --- Image URL Extraction ---
            let imageUrl = "https://example.com/placeholder-image.png";
            const imgElement =
              tile.querySelector("img[data-cs-capture]") ||
              tile.querySelector("img");

            if (imgElement) {
              const srcset = imgElement.getAttribute("srcset") || "";
              if (srcset) {
                const srcsetUrls = srcset.split(",").map((s) => s.trim());
                // Prefer high resolution (2x) or the first URL
                const highRes = srcsetUrls.find((s) => s.includes("2x"));

                if (highRes) {
                  const url = highRes.split(" ")[0];
                  if (url && url.startsWith("http")) {
                    imageUrl = url;
                  }
                } else if (srcsetUrls.length > 0) {
                  const url = srcsetUrls[0].split(" ")[0];
                  if (url && url.startsWith("http")) {
                    imageUrl = url;
                  }
                }
              }

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

            return {
              storeName,
              category,
              title,
              price,
              imageUrl,
              productUrl,
            };
          } catch (e) {
            // console.error("Error extracting data:", e.message); // Cannot log inside page.evaluate
            return null;
          }
        };

        return tiles.map(extractProductData).filter((data) => data !== null);
      },
      CATEGORY_NAME,
      STORE_NAME_FIXED,
      DOMAIN // Passed as argument
    );

    console.log(`\n✅ Extracted ${allProductsData.length} products`);

    // --- SAVE TO DATABASE ---
    console.log("\n📦 Saving products to database...");

    let createdCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const product of allProductsData) {
      try {
        // Skip if essential fields are missing or price is 0
        if (
          !product.title ||
          product.title === "N/A" ||
          !product.productUrl ||
          product.productUrl === "N/A" ||
          product.price <= 0
        ) {
          skippedCount++;
          continue;
        }

        // UPSERT LOGIC (Find unique combination of storeName and productUrl)
        const existingProduct = await prisma.product.findUnique({
          where: {
            storeName_productUrl: {
              storeName: product.storeName,
              productUrl: product.productUrl,
            },
          },
        });

        if (existingProduct) {
          // Update existing product
          await prisma.product.update({
            where: {
              id: existingProduct.id,
            },
            data: {
              title: product.title,
              category: product.category,
              price: product.price,
              imageUrl: product.imageUrl,
              lastSeenAt: new Date(),
            },
          });
          updatedCount++;
        } else {
          // Create new product
          await prisma.product.create({
            data: {
              storeName: product.storeName,
              category: product.category,
              title: product.title,
              price: product.price,
              imageUrl: product.imageUrl,
              productUrl: product.productUrl,
              scrapedAt: new Date(),
              lastSeenAt: new Date(),
            },
          });
          createdCount++;
        }

        // Log progress every 50 products
        if ((createdCount + updatedCount) % 50 === 0) {
          console.log(
            `Progress: ${createdCount + updatedCount}/${
              allProductsData.length
            } processed...`
          );
        }
      } catch (dbError) {
        console.error(
          `Error saving product "${product.title}":`,
          dbError.message
        );
        errorCount++;
      }
    }

    totalSavedCount = createdCount + updatedCount;

    // --- FINAL SUMMARY ---
    console.log("\n=== SCRAPING & DATABASE SUMMARY ===");
    console.log(`Total Products Extracted: ${allProductsData.length}`);
    console.log(`✅ Created: ${createdCount}`);
    console.log(`🔄 Updated: ${updatedCount}`);
    console.log(`⏭️  Skipped: ${skippedCount}`);
    console.log(`❌ Errors: ${errorCount}`);
    console.log(`📊 FINAL UNIQUE PRODUCTS SAVED/UPDATED: ${totalSavedCount}`);
    console.log("===================================\n");

    // Show sample of saved products
    console.log("Sample of saved products:");
    const sampleProducts = await prisma.product.findMany({
      where: {
        storeName: STORE_NAME_FIXED,
        category: CATEGORY_NAME,
      },
      orderBy: {
        lastSeenAt: "desc", // Changed from createdAt to lastSeenAt for recency
      },
      take: 3,
    });

    sampleProducts.forEach((product, index) => {
      console.log(`\n[Sample Product ${index + 1}]`);
      console.log(`  Store: ${product.storeName}`);
      console.log(`  Category: ${product.category}`);
      console.log(`  Title: ${product.title}`);
      console.log(`  Price: ${product.price} KD`);
      console.log(`  Image: ${product.imageUrl.substring(0, 60)}...`);
      console.log(`  URL: ${product.productUrl.substring(0, 60)}...`);
    });
  } catch (error) {
    console.error(`\n--- CRITICAL ERROR for ${CATEGORY_NAME} ---`);
    console.error("An unhandled error occurred:", error.message);
    console.error(error.stack);
  } finally {
    if (browser) {
      await browser.close();
      console.log(`\n🔒 Browser closed for ${CATEGORY_NAME}.`);
    }
  }
}

export default scrapeProducts;
