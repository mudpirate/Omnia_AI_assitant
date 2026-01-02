// MINIMAL TEST SCRIPT - Check if listing extraction works
import puppeteer from "puppeteer";

const TEST_URL =
  "https://www.bershka.com/kw/men/sale/trousers-and-jeans-c1010747956.html";

// Helper function to replace deprecated waitForTimeout
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function testListingExtraction() {
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();

  try {
    console.log("\n🔍 Testing listing page image extraction...\n");
    console.log("URL:", TEST_URL);

    await page.goto(TEST_URL, {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });
    await sleep(3000); // ✅ FIXED: Use sleep() instead of page.waitForTimeout()

    // Extract first 5 products
    const products = await page.evaluate(() => {
      const cards = document.querySelectorAll("li.grid-item.normal");
      const results = [];

      for (let i = 0; i < Math.min(5, cards.length); i++) {
        const card = cards[i];

        // Get link
        const link = card.querySelector('a.grid-card-link[href*="-c0p"]');
        const href = link ? link.getAttribute("href") : null;

        // Get title
        const titleEl = card.querySelector(".product-text p");
        const title = titleEl ? titleEl.textContent.trim() : "Unknown";

        // Get image - same logic as scraper
        let imageUrl = null;
        let method = "none";

        const imgEl1 = card.querySelector(
          'img[data-qa-anchor="productGridMainImage"]:not([style*="display: none"])'
        );
        if (imgEl1) {
          imageUrl =
            imgEl1.getAttribute("data-original") || imgEl1.getAttribute("src");
          method = "productGridMainImage";
        }

        if (!imageUrl) {
          const imgEl2 = card.querySelector(
            ".product-media-wrapper img.image-item[data-original]"
          );
          if (imgEl2) {
            imageUrl = imgEl2.getAttribute("data-original");
            method = "image-item";
          }
        }

        // Validate
        const isValid = imageUrl && /\/\d{11,}-/.test(imageUrl);
        const filename = imageUrl
          ? imageUrl.substring(imageUrl.lastIndexOf("/") + 1)
          : "NONE";

        results.push({
          index: i + 1,
          title,
          href,
          imageUrl,
          filename,
          method,
          isValid,
        });
      }

      return results;
    });

    console.log("\n" + "=".repeat(80));
    console.log("📊 EXTRACTION RESULTS:");
    console.log("=".repeat(80));

    products.forEach((p) => {
      console.log(`\n[${p.index}] ${p.title}`);
      console.log(`    Method: ${p.method}`);
      console.log(`    Image: ${p.filename}`);
      console.log(`    Valid: ${p.isValid ? "✅ YES" : "❌ NO (BANNER)"}`);
      console.log(
        `    URL: ${p.href ? p.href.substring(0, 50) + "..." : "NONE"}`
      );
    });

    console.log("\n" + "=".repeat(80));
    const validCount = products.filter((p) => p.isValid).length;
    const bannerCount = products.filter((p) => !p.isValid && p.imageUrl).length;
    const noneCount = products.filter((p) => !p.imageUrl).length;

    console.log(`✅ Valid images: ${validCount}`);
    console.log(`❌ Banners: ${bannerCount}`);
    console.log(`⚠️  No image: ${noneCount}`);

    if (bannerCount > 0) {
      console.log("\n⚠️  BANNERS DETECTED IN LISTING PAGE!");
      products
        .filter((p) => !p.isValid && p.imageUrl)
        .forEach((p) => {
          console.log(`  - [${p.index}] ${p.title}: ${p.filename}`);
        });
    }

    console.log("\n✅ Test complete! Closing in 5 seconds...");
    await sleep(5000); // Give you time to see results
  } catch (error) {
    console.error("❌ Error:", error.message);
  } finally {
    await browser.close();
  }
}

testListingExtraction();
