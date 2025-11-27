import puppeteer from "puppeteer";
import { PrismaClient } from "@prisma/client";

// --- GLOBAL CONFIGURATION ---
const prisma = new PrismaClient();
const DOMAIN = "https://www.noon.com/kuwait-en"; // Simplified the domain here
const PRODUCT_SELECTOR = "[data-qa='plp-product-box']";
const STORE_NAME_FIXED = "Noon.kw";
const CURRENCY = "KWD";
const PAGINATION_SELECTOR =
  ".PlpPagination-module-scss-module__wOkiOW__paginationWrapper";
const PAGE_LINK_SELECTOR =
  ".PlpPagination-module-scss-module__wOkiOW__pageLink";

/**
 * Safe goto that retries and creates a fresh page each attempt.
 * Caller is responsible for closing the returned page.
 */
async function safeGoto(browser, url, opts = {}) {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 1280, height: 800 });
      page.setDefaultTimeout(180000);

      // Added flags to prevent HTTP/2 errors and disable compression
      await page.setExtraHTTPHeaders({
        "accept-encoding": "identity",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36",
      });

      await page.goto(url, {
        // Changed to 'domcontentloaded' for potentially faster initial load
        waitUntil: "domcontentloaded",
        timeout: 180000,
        ...opts,
      });
      return page;
    } catch (err) {
      console.warn(
        `safeGoto attempt ${attempt} failed for ${url}: ${err.message}`
      );
      await page.close().catch(() => {});
      if (attempt === maxAttempts) throw err;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

/**
 * Reads the highest page number directly from the pagination bar element.
 * @param {import('puppeteer').Page} page
 * @returns {Promise<number|null>} The total number of pages or null if not found.
 */
async function getTotalPagesFromPagination(page) {
  try {
    // Scroll to the bottom to ensure the pagination is loaded
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    await new Promise((r) => setTimeout(r, 1000)); // Wait for render

    // Wait for the main pagination container to be present
    await page.waitForSelector(PAGINATION_SELECTOR, { timeout: 10000 });

    const totalPages = await page.evaluate((pageLinkSelector) => {
      const pageLinks = document.querySelectorAll(pageLinkSelector);
      let maxPage = 1;

      pageLinks.forEach((link) => {
        const pageText = link.textContent.trim();
        const pageNum = parseInt(pageText, 10);

        // Check if it's a valid number and greater than the current max
        if (!isNaN(pageNum) && pageNum > maxPage) {
          maxPage = pageNum;
        }
      });
      return maxPage;
    }, PAGE_LINK_SELECTOR);

    return totalPages;
  } catch (e) {
    // If the selector times out or an error occurs, return null to use iterative fallback
    return null;
  }
}

/**
 * Main scraper entry
 */
async function scrapeProducts(TARGET_URL, CATEGORY_NAME, opts = {}) {
  const {
    consecutiveEmptyPagesStop = 3,
    maxPagesCap = 50, // Reduced cap for safety if pagination fails
    verbose = true,
  } = opts;

  let browser;
  let allProductsData = [];

  try {
    if (verbose)
      console.log(`🚀 Starting scraper for ${CATEGORY_NAME} at ${TARGET_URL}`);

    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-web-security",
        "--disable-features=NetworkServiceInProcess2",
        "--no-http2",
      ],
    });

    // Normalize TARGET_URL by removing any existing page=N parameter
    const initialURL =
      TARGET_URL.split("?")[0] +
      "?" +
      (TARGET_URL.split("?")[1] || "")
        .replace(/&page=\d+/i, "")
        .replace(/page=\d+/i, "q=");

    if (verbose)
      console.log("Discovering total page count from pagination bar...");

    let initialPage = await safeGoto(browser, initialURL);

    // Try to get total pages directly from the pagination bar
    let totalPages = await getTotalPagesFromPagination(initialPage);

    // close the initial page since we're done with it
    await initialPage.close().catch(() => {});

    if (totalPages) {
      if (verbose)
        console.log(`✅ Found totalPages=${totalPages} from pagination bar.`);
    } else {
      if (verbose)
        console.log(
          `⚠️ Could not detect total pages from pagination bar. Falling back to iterative scrape with cap of ${maxPagesCap}.`
        );
      // Use the safety cap if detection failed
      totalPages = maxPagesCap;
    }

    // iteration variables for fallback logic
    let consecutiveEmpty = 0;

    // Scrape pages
    for (let currentPage = 1; currentPage <= totalPages; currentPage++) {
      // If detection failed, stop after consecutiveEmptyPagesStop
      if (!totalPages && consecutiveEmpty >= consecutiveEmptyPagesStop) {
        if (verbose)
          console.log(
            `🛑 Stopping early after ${consecutiveEmpty} consecutive empty pages.`
          );
        break;
      }

      // Build page URL: ensure it starts with ? and uses &page=N for subsequent pages
      let pageURL = initialURL;
      if (currentPage > 1) {
        pageURL = `${initialURL.split("?")[0]}?${
          initialURL.split("?")[1]
        }&page=${currentPage}`;
        // Clean up any double ampersands that might result
        pageURL = pageURL.replace("?&", "?");
      }

      if (verbose)
        console.log(
          `\n➡️ Navigating to Page ${currentPage}${
            totalPages ? `/${totalPages}` : ""
          }: ${pageURL}`
        );

      let page;
      try {
        page = await safeGoto(browser, pageURL);

        // wait for product tiles (some pages may not have them)
        await page
          .waitForSelector(PRODUCT_SELECTOR, { timeout: 30000 })
          .catch(() => null);

        // scroll to trigger lazy-loading
        await page.evaluate(async () => {
          const step = 500;
          let pos = 0;
          const height = document.body.scrollHeight || 3000;
          while (pos < height) {
            window.scrollBy(0, step);
            pos += step;
            await new Promise((r) => setTimeout(r, 50));
          }
          window.scrollTo(0, 0);
          await new Promise((r) => setTimeout(r, 300));
        });

        // extract products
        const pageProducts = await page.$$eval(
          PRODUCT_SELECTOR,
          (tiles, domain, category, store, currency) => {
            const cleanPrice = (txt) => {
              if (!txt) return 0;
              return (
                parseFloat(
                  txt.replace(currency, "").replace(/,/g, "").trim()
                ) || 0
              );
            };

            const extractProductData = (tile) => {
              try {
                const linkElement = tile.querySelector("a");
                const relativeUrl = linkElement?.getAttribute("href");
                const productUrl = relativeUrl
                  ? relativeUrl.startsWith(domain)
                    ? relativeUrl
                    : `${domain}${relativeUrl}`
                  : "N/A";

                const titleElement = tile.querySelector(
                  "[data-qa='plp-product-box-name']"
                );
                const title =
                  titleElement?.getAttribute("title")?.trim() || "N/A";

                let imageUrl = "https://example.com/placeholder-image.png";
                // Look for the primary image tag
                const imgElement = tile.querySelector("img[src*='.jpg']");
                if (imgElement) {
                  const src =
                    imgElement.getAttribute("src") ||
                    imgElement.getAttribute("data-src");
                  if (src && src.startsWith("http")) imageUrl = src;
                }

                const currentPriceElement = tile.querySelector(
                  "[data-qa='plp-product-box-price'] strong, .price, .price--now"
                );
                const priceText = currentPriceElement?.textContent;
                const price = priceText ? cleanPrice(priceText) : 0;

                if (!title || price <= 0 || productUrl === "N/A") return null;

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
              .filter((d) => d && d.price > 0 && d.title !== "N/A");
          },
          DOMAIN,
          CATEGORY_NAME,
          STORE_NAME_FIXED,
          CURRENCY
        );

        const countThisPage = (pageProducts && pageProducts.length) || 0;
        if (countThisPage === 0) {
          consecutiveEmpty++;
          if (verbose)
            console.warn(`⚠️ Page ${currentPage} returned 0 products.`);
        } else {
          consecutiveEmpty = 0; // reset on success
          allProductsData = allProductsData.concat(pageProducts);
          if (verbose)
            console.log(
              `  ✅ Scraped ${countThisPage} products from page ${currentPage}.`
            );
        }

        await page.close().catch(() => {});
      } catch (pageErr) {
        // ... Error handling remains the same ...
        if (pageErr.name === "TimeoutError") {
          if (verbose)
            console.warn(`⚠️ Timeout on page ${currentPage}. Skipping page.`);
        } else {
          if (verbose)
            console.error(
              `⚠️ Error on page ${currentPage}: ${pageErr.message}`
            );
        }
        try {
          if (page && !page.isClosed()) await page.close();
        } catch (_) {}
        consecutiveEmpty++;
      }

      // be polite to the server
      await new Promise((r) => setTimeout(r, 1200));
    } // end pages loop

    // --- DATABASE AND SUMMARY LOGIC REMAINS THE SAME ---

    if (verbose)
      console.log(
        `\n✅ Extracted a total of ${allProductsData.length} products for ${CATEGORY_NAME}`
      );
    if (verbose) console.log("\n📦 Saving products to database...");

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
      } catch (dbError) {
        console.error(
          `Error saving product "${product.title}": ${dbError.message}`
        );
        errorCount++;
      }
    }

    if (verbose) {
      console.log("\n=== SCRAPING & DATABASE SUMMARY ===");
      console.log(`Store: ${STORE_NAME_FIXED}`);
      console.log(`Category: ${CATEGORY_NAME}`);
      console.log(`Total Products Extracted: ${allProductsData.length}`);
      console.log(`✅ Created: ${createdCount}`);
      console.log(`🔄 Updated: ${updatedCount}`);
      console.log(`⏭️ Skipped: ${skippedCount}`);
      console.log(`❌ Errors: ${errorCount}`);
      console.log("===================================\n");
    }
  } catch (error) {
    console.error(`\n--- CRITICAL ERROR for ${CATEGORY_NAME} ---`);
    console.error("An unhandled error occurred:", error.message);
    console.error(error.stack);
  } finally {
    try {
      if (browser) {
        await browser.close();
        console.log(`\n🔒 Browser closed for ${CATEGORY_NAME}.`);
      }
    } catch (e) {
      console.warn("Error closing browser:", e.message);
    }
    try {
      // Note: Prisma disconnect should ideally only happen once outside the loop
      // await prisma.$disconnect();
      // console.log("🔒 Database connection closed.");
    } catch (e) {
      console.warn("Error disconnecting Prisma:", e.message);
    }
  }
}

export default scrapeProducts;
