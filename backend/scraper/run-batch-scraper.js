import puppeteer from "puppeteer";
import scrapeProducts from "./xcite-scraper-batch.js";

/**
 * Example: Running the batch scraper for Xcite
 *
 * This demonstrates how to use the batch API-enabled scraper
 * for cost-effective product data extraction.
 */

async function main() {
  console.log("🚀 Starting Xcite Batch Scraper\n");
  console.log("📊 Configuration:");
  console.log("   - Batch API: ENABLED (50% cost savings)");
  console.log("   - Expected wait time: 0.5-24 hours");
  console.log("   - Processing mode: Asynchronous\n");

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--disable-gpu",
    ],
  });

  try {
    // Example 2: Multiple categories (uncomment to use)

    console.log("\n🔄 Example 2: Scraping multiple categories\n");

    const categories = [
      {
        url: "https://www.xcite.com/mobile-phones/c",
        name: "",
      },
      {
        url: "https://www.xcite.com/laptops.html",
        name: "Laptops",
      },
      {
        url: "https://www.xcite.com/tablets.html",
        name: "Tablets",
      },
    ];

    for (const category of categories) {
      console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`Processing: ${category.name}`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

      await scrapeProducts(browser, category.url, category.name);

      // Small delay between categories to be respectful
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    console.log("\n✅ Scraping phase complete!");
    console.log("\n📋 Next steps:");
    console.log("   1. Monitor batch progress: node batch-manager.js list");
    console.log("   2. Check status: node batch-manager.js status <batch_id>");
    console.log(
      "   3. Download results when ready: node batch-manager.js download <batch_id>"
    );
    console.log(
      "   4. Calculate savings: node batch-manager.js cost <batch_id>\n"
    );
  } catch (error) {
    console.error("\n❌ Error during scraping:", error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await browser.close();
    console.log("🔒 Browser closed\n");
  }
}

// Handle graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n\n⚠️  Received SIGINT, shutting down gracefully...");
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n\n⚠️  Received SIGTERM, shutting down gracefully...");
  process.exit(0);
});

main();
