import puppeteer from "puppeteer";
import { PrismaClient } from "@prisma/client";

// --- GLOBAL CONFIGURATION (moved out of the function) ---
const prisma = new PrismaClient();
const DOMAIN = "https://best.com.kw";
const PRODUCT_SELECTOR = "best-product-grid-item";
const STORE_NAME_FIXED = "Best.kw";

/**
 * Main function to launch the browser, navigate, scrape, and save to DB.
 *
 * @param {string} TARGET_URL - The starting URL for the category or search page.
 * @param {string} CATEGORY_NAME - The category slug for the DB (e.g., 'desktops').
 */
async function scrapeProducts(TARGET_URL, CATEGORY_NAME) {
  let browser;
  let allProductsData = [];

  try {
    console.log(`🚀 Starting scraper for ${CATEGORY_NAME} at ${TARGET_URL}`);

    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    page.setDefaultTimeout(90000);
    await page.setViewport({ width: 1280, height: 800 });

    // --- DISCOVER TOTAL PAGE COUNT ON FIRST PAGE ---
    console.log("Discovering total page count...");
    await page.goto(TARGET_URL, { waitUntil: "networkidle2" });

    // Wait until at least one product loads on the first page
    await page.waitForSelector(PRODUCT_SELECTOR, { timeout: 30000 });

    const totalPages = await page.evaluate(() => {
      // 1. Try to find the 'end' link (used by both categories and search)
      const lastPageLink = document.querySelector(".cx-pagination a.end");
      if (lastPageLink) {
        const href = lastPageLink.getAttribute("href");
        // Check for 'page=' (search) or 'currentPage=' (category)
        const matchPage = href.match(/page=(\d+)/i);
        const matchCurrentPage = href.match(/currentPage=(\d+)/i);

        if (matchPage && matchPage[1]) {
          // Search results use 1-based page index
          return parseInt(matchPage[1], 10);
        } else if (matchCurrentPage && matchCurrentPage[1]) {
          // Category pages use 0-based index for `currentPage`, so add 1
          return parseInt(matchCurrentPage[1], 10) + 1;
        }
      }

      // 2. Fallback: check numeric buttons
      const pageButtons = Array.from(
        document.querySelectorAll(".cx-pagination a.page")
      );
      const nums = pageButtons
        .map((el) => parseInt(el.textContent.trim(), 10))
        .filter((n) => !Number.isNaN(n));

      // Find the highest number or default to 1
      return nums.length ? Math.max(...nums) : 1;
    });

    console.log(`✅ Detected ${totalPages} page(s) in this category.`);

    // --- SCRAPE EACH PAGE ---
    for (let currentPage = 1; currentPage <= totalPages; currentPage++) {
      // Determine the correct pagination parameter based on the URL type
      let pageURL;
      if (currentPage === 1) {
        pageURL = TARGET_URL;
      } else if (TARGET_URL.includes("/search/")) {
        // Search URLs use `page=N` (1-based index)
        pageURL = `${TARGET_URL}?page=${currentPage}`;
      } else {
        // Category URLs (like /c/mobiles-nn) use `currentPage=N` (0-based index)
        pageURL = `${TARGET_URL}?currentPage=${currentPage - 1}`;
      }

      console.log(
        `\n➡️ Navigating to Page ${currentPage}/${totalPages}: ${pageURL}`
      );

      try {
        await page.goto(pageURL, { waitUntil: "networkidle2" });

        // Wait for products to be present on this page.
        await page.waitForSelector(PRODUCT_SELECTOR, { timeout: 30000 });

        // --- Scroll to trigger lazy-loaded content to appear ---
        await page.evaluate(async () => {
          const scrollStep = 500;
          let totalHeight = 0;
          const bodyHeight = document.body.scrollHeight;

          while (totalHeight < bodyHeight) {
            window.scrollBy(0, scrollStep);
            totalHeight += scrollStep;
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          window.scrollTo(0, 0); // Scroll back up
          await new Promise((resolve) => setTimeout(resolve, 1000));
        });

        // --- EXTRACT DATA FOR CURRENT PAGE ---
        const pageProducts = await page.$$eval(
          PRODUCT_SELECTOR,
          (tiles, domain, category, store) => {
            const extractProductData = (tile) => {
              try {
                const cleanPrice = (txt) =>
                  parseFloat(txt.replace("KD", "").replace(/,/g, "").trim()) ||
                  0;

                // --- URL & TITLE ---
                const linkElement = tile.querySelector(
                  'a.cx-product-name, a[class="cx-product-name"]'
                );
                const relativeUrl = linkElement?.getAttribute("href");
                const productUrl = relativeUrl
                  ? relativeUrl.startsWith(domain)
                    ? relativeUrl
                    : `${domain}${relativeUrl}`
                  : "N/A";
                const title = linkElement?.textContent.trim() || "N/A";

                // --- IMAGE ---
                let imageUrl = "https://example.com/placeholder-image.png";
                const imgElement =
                  tile.querySelector("cx-media img") ||
                  tile.querySelector("img");
                if (imgElement) {
                  const srcSet = imgElement.getAttribute("srcset");
                  const src = imgElement.getAttribute("src");
                  if (srcSet) {
                    const url = srcSet.split(",")[0].trim().split(" ")[0];
                    if (url && url.startsWith("http")) {
                      imageUrl = url;
                    }
                  } else if (src && src.startsWith("http")) {
                    imageUrl = src;
                  }
                }

                // --- PRICE ---
                const currentPriceElement =
                  tile.querySelector(".cx-product-price");
                const price = currentPriceElement
                  ? cleanPrice(currentPriceElement.textContent)
                  : 0;

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
          CATEGORY_NAME,
          STORE_NAME_FIXED
        );

        if (pageProducts.length === 0) {
          console.log(
            `⚠️ Page ${currentPage} loaded, but zero products extracted. Continuing...`
          );
        } else {
          console.log(
            `  ✅ Scraped ${pageProducts.length} products from page ${currentPage}.`
          );
          allProductsData = allProductsData.concat(pageProducts);
        }
      } catch (e) {
        // --- GRACEFUL FAILURE HANDLER ---
        if (e.name === "TimeoutError") {
          console.warn(
            `⚠️ Warning: Page ${currentPage} timed out waiting for selector ${PRODUCT_SELECTOR}. Continuing...`
          );
        } else {
          console.error(
            `⚠️ Warning: An error occurred on page ${currentPage}: ${e.message}. Continuing...`
          );
        }
        // Continue loop to the next page
        continue;
      }
    }

    // --- EXTRACT & SAVE SUMMARY ---
    console.log(
      `\n✅ Extracted a total of ${allProductsData.length} products for ${CATEGORY_NAME}`
    );

    // --- SAVE TO DATABASE ---
    console.log("\n📦 Saving products to database...");

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

    // --- FINAL SUMMARY ---
    console.log("\n=== SCRAPING & DATABASE SUMMARY ===");
    console.log(`Store: ${STORE_NAME_FIXED}`);
    console.log(`Category: ${CATEGORY_NAME}`);
    console.log(`Total Products Extracted: ${allProductsData.length}`);
    console.log(`✅ Created: ${createdCount}`);
    console.log(`🔄 Updated: ${updatedCount}`);
    console.log(`⏭️  Skipped: ${skippedCount}`);
    console.log(`❌ Errors: ${errorCount}`);
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
