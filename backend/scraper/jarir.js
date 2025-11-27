import puppeteer from "puppeteer";
import { PrismaClient } from "@prisma/client";

// --- GLOBAL CONFIGURATION ---
const prisma = new PrismaClient();
const DOMAIN = "https://www.jarir.com";
const PRODUCT_SELECTOR = ".product-tile__item--spacer";
const STORE_NAME_FIXED = "Jarir";
const PRODUCT_LOAD_URL_FRAGMENT = "/search/GetProductsList";

/**
 * Main function to launch the browser, navigate, scrape, and save to DB.
 *
 * @param {string} TARGET_URL - The starting URL for the category page.
 * @param {string} CATEGORY_NAME - The category slug for the DB.
 */
async function scrapeProducts(TARGET_URL, CATEGORY_NAME) {
  let browser;
  let allProductsData = [];

  // Counters and configuration for the single run
  const totalSavedCount = 0;

  // --- INFINITE SCROLL CONFIGURATION ---
  let consecutiveFailures = 0;
  let scrollAttempts = 0;
  const MAX_SCROLLS = 200;
  const MAX_FAILURES = 5;
  const NETWORK_TIMEOUT = 15000;

  try {
    console.log(
      `🚀 Starting MASTER scraper for ${CATEGORY_NAME} at ${TARGET_URL}`
    );

    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    page.setDefaultTimeout(120000);
    await page.setViewport({ width: 1280, height: 1080 });

    // --- SINGLE RUN SETUP (Using the base URL only) ---
    const newURL = TARGET_URL.split("?")[0]; // Ensure no existing parameters

    console.log(`\n======================================================`);
    console.log(`♻️  JOB 1/1 - Default Scraping Run (${newURL})`);
    console.log(`======================================================`);

    // Navigate to the base URL
    try {
      await page.goto(newURL, { waitUntil: "networkidle2" });
      await page.waitForSelector(PRODUCT_SELECTOR, { timeout: 30000 });
    } catch (error) {
      console.error(
        `❌ Navigation/Initial Load Failed. Stopping scraper. Error: ${error.message}`
      );
      return; // Exit the function on critical failure
    }

    let initialCount = await page.$$eval(
      PRODUCT_SELECTOR,
      (tiles) => tiles.length
    );
    console.log(`Initial product count: ${initialCount}`);

    // --- INNER INFINITE SCROLL LOOP (Scroll and Collect) ---
    while (scrollAttempts < MAX_SCROLLS) {
      scrollAttempts++;

      let previousProductsCount = await page.$$eval(
        PRODUCT_SELECTOR,
        (tiles) => tiles.length
      );

      // 1. Setup the network promise: wait for the specific AJAX response
      const networkPromise = page.waitForResponse(
        (response) => {
          return (
            response.url().includes(PRODUCT_LOAD_URL_FRAGMENT) &&
            response.status() === 200
          );
        },
        { timeout: NETWORK_TIMEOUT }
      );

      // 2. Perform the targeted scroll
      await page.evaluate((selector) => {
        const tiles = document.querySelectorAll(selector);
        if (tiles.length > 0) {
          tiles[tiles.length - 1].scrollIntoView({
            behavior: "smooth",
            block: "end",
          });
        }
      }, PRODUCT_SELECTOR);

      // 3. Wait for EITHER the network response OR a fallback timer
      try {
        await Promise.race([
          networkPromise,
          new Promise((resolve) => setTimeout(resolve, 5000)),
        ]);
      } catch (e) {
        // Network wait timed out, proceed to DOM check
      }

      // 4. Wait for DOM rendering to settle
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // 5. Check the new product count
      const currentProductsCount = await page.$$eval(
        PRODUCT_SELECTOR,
        (tiles) => tiles.length
      );

      if (currentProductsCount > previousProductsCount) {
        console.log(
          `... Scroll check: Products loaded now: ${currentProductsCount} (Added ${
            currentProductsCount - previousProductsCount
          })`
        );
        consecutiveFailures = 0;
      } else {
        consecutiveFailures++;
        console.log(
          `⚠️ No new products loaded (${currentProductsCount}). Failure ${consecutiveFailures}/${MAX_FAILURES}.`
        );

        if (consecutiveFailures >= MAX_FAILURES) {
          console.log(
            `🛑 Stabilized at ${currentProductsCount} after ${MAX_FAILURES} consecutive checks. Stopping inner loop.`
          );
          break;
        }
      }
    } // END INNER SCROLL LOOP

    // --- EXTRACT DATA FOR THIS RUN ---
    const finalCountForRun = await page.$$eval(
      PRODUCT_SELECTOR,
      (tiles) => tiles.length
    );

    allProductsData = await page.$$eval(
      PRODUCT_SELECTOR,
      (tiles, domain, store, category) => {
        const cleanPrice = (txt) => {
          return parseFloat(txt.replace(/[^0-9.]/g, "").replace(/,/g, "")) || 0;
        };

        const extractProductData = (tile) => {
          try {
            const linkElement = tile.querySelector("a.product-tile__link");
            const relativeUrl = linkElement?.getAttribute("href");
            const productUrl = relativeUrl
              ? relativeUrl.startsWith(domain)
                ? relativeUrl
                : `${domain}${relativeUrl}`
              : "N/A";

            const titleElement = tile.querySelector(".product-title__title");
            const title = titleElement?.textContent.trim() || "N/A";

            let imageUrl = "https://example.com/placeholder-image.png";
            const firstSlideImages = tile.querySelectorAll(
              ".VueCarousel-slide:first-child .lazyload-wrapper img"
            );

            if (firstSlideImages.length >= 2) {
              const imageSrc = firstSlideImages[1].getAttribute("src");
              if (imageSrc && !imageSrc.includes("/assets/placeholder.png")) {
                imageUrl = imageSrc;
              }
            }

            const priceElement = tile.querySelector(
              ".price-box .price span:last-child"
            );
            const priceText = priceElement?.textContent.trim() || "N/A";
            const price = cleanPrice(priceText);

            return {
              storeName: store,
              category: category,
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
      STORE_NAME_FIXED,
      CATEGORY_NAME
    );

    console.log(
      `✅ Extracted ${finalCountForRun} products for this run. Saving incrementally...`
    );

    // --- INCREMENTAL SAVE TO DATABASE ---
    let createdCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const product of allProductsData) {
      try {
        if (!product.title || !product.productUrl || product.price <= 0) {
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
          await prisma.product.update({
            where: { id: existingProduct.id },
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
      } catch (dbError) {
        console.error(
          `Error saving product "${product.title}":`,
          dbError.message
        );
        errorCount++;
      }
    }

    const totalSavedCountFinal = createdCount + updatedCount;

    // --- FINAL SUMMARY ---
    console.log(
      `\n📦 Run Summary: Created: ${createdCount}, Updated: ${updatedCount}, Skipped: ${skippedCount}, Errors: ${errorCount}`
    );
    console.log("\n===================================\n");
    console.log(`✅ MASTER JOB COMPLETE: Processed 1 attempt.`);
    console.log(
      `📊 FINAL UNIQUE PRODUCTS SAVED/UPDATED: ${totalSavedCountFinal}`
    );
    console.log("===================================\n");
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
