import puppeteer from "puppeteer";

// --- CONFIGURATION ---
const BASE_URL = "https://gccoupons.com/categories/electronics-coupons/";
// Selector for a single coupon box
const COUPON_SELECTOR = ".white-block.coupon-box.coupon-list";
// Selector for the pagination links to determine the last page
const PAGINATION_SELECTOR = ".pagination.header-alike a.page-numbers";

/**
 * Determines the last page number by checking pagination links.
 */
async function getLastPageNumber(page) {
  // Find the max page number text from the pagination links
  const maxPage = await page.$$eval(PAGINATION_SELECTOR, (links) => {
    let max = 1;
    links.forEach((link) => {
      const num = parseInt(link.textContent.trim());
      if (!isNaN(num)) {
        max = Math.max(max, num);
      }
    });
    return max;
  });

  return maxPage;
}

/**
 * Main function to run the scraper.
 */
async function scrapeCoupons() {
  let browser;
  let allCoupons = [];

  try {
    console.log(`🚀 Starting coupon scraper for ${BASE_URL}`);

    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();

    page.setDefaultTimeout(60000); // 60s timeout for safety
    await page.setViewport({ width: 1280, height: 800 });

    // 1. Navigate to the first page
    console.log("Navigating to the initial page to find the total count...");
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(COUPON_SELECTOR, { timeout: 15000 });

    // 2. Determine the total number of pages
    const lastPage = await getLastPageNumber(page);
    console.log(`Total pages found: ${lastPage}`);

    // 3. Loop through all pages
    for (let currentPage = 1; currentPage <= lastPage; currentPage++) {
      const pageUrl =
        currentPage === 1 ? BASE_URL : `${BASE_URL}?pages=${currentPage}`;

      console.log(
        `\n-- Scrapping Page ${currentPage}/${lastPage} (${pageUrl}) --`
      );

      // Navigate to the correct page unless we are on the first page already
      if (currentPage > 1) {
        await page.goto(pageUrl, { waitUntil: "domcontentloaded" });
        await page.waitForSelector(COUPON_SELECTOR, { timeout: 15000 });
      }

      // 4. Extract data from all coupons on the current page
      const pageCoupons = await page.$$eval(COUPON_SELECTOR, (tiles) => {
        const results = [];

        tiles.forEach((tile) => {
          // 1. Title
          const titleElement = tile.querySelector("h4 a.coupon-action-button");
          const title = titleElement?.getAttribute("title")?.trim() || "N/A";

          // 2. Store Name (FIXED: Extracted from the image alt attribute)
          let storeName = "N/A";
          const imgElement = tile.querySelector(".coupon-image img");

          if (imgElement) {
            const altText = imgElement.getAttribute("alt") || "";
            // Clean up the alt text by removing common suffixes like "Coupons" or "Deals"
            storeName = altText
              .replace(/coupons|deals|promo code/gi, "")
              .trim();
          }

          // 3. Coupon Code
          const codeElement = tile.querySelector("a.coupon-code");
          const couponCode =
            codeElement?.getAttribute("data-coupon")?.trim() || "N/A";

          // 4. Usage Count
          const usageText =
            tile
              .querySelector(".used")
              ?.textContent.trim()
              .replace(/\s+/, " ") || "N/A";
          const timesUsed = usageText.split(" ")[1] || "N/A";

          // 5. Expiry Date
          const expiryElement = tile.querySelector(".expire");
          const expiryDate =
            expiryElement?.textContent
              .replace(/\s+/g, " ")
              .trim()
              .replace("January 14, 2026", "January 14, 2026") || "N/A";

          results.push({ title, couponCode, storeName, timesUsed, expiryDate });
        });
        return results;
      });

      console.log(`... Scraped ${pageCoupons.length} coupons.`);
      allCoupons.push(...pageCoupons);
    }

    // --- FINAL OUTPUT ---
    console.log("\n==================================");
    console.log(
      `✅ SCRAPING COMPLETE. Total coupons found: ${allCoupons.length}`
    );
    console.log("==================================");
    allCoupons.slice(0, 5).forEach((c, i) => {
      console.log(`[#${i + 1}] Store: ${c.storeName}`);
      console.log(`    Title: ${c.title.substring(0, 50)}...`);
      console.log(
        `    Code: ${c.couponCode} | Used: ${c.timesUsed} | Expires: ${c.expiryDate}`
      );
    });
    console.log(JSON.stringify(allCoupons, null, 2));
  } catch (error) {
    console.error("\n--- CRITICAL ERROR ---");
    console.error("An unhandled error occurred:", error.message);
  } finally {
    if (browser) {
      await browser.close();
      console.log("\nBrowser closed. Script finished.");
    }
  }
}

scrapeCoupons();
