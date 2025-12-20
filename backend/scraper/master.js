// runner.js
import puppeteer from "puppeteer";
import { PrismaClient } from "@prisma/client";
import pLimit from "p-limit";

// Import all store scrapers
import scrapeProductsEureka from "./eureka.js";
import scrapeProductsXcite from "./xcite.js";
import scrapeProductsBest from "./best.js";
// Add more imports as needed
// import scrapeProductsLulu from "./lulu.js";

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  // How many stores to scrape concurrently
  maxConcurrentStores: 3,

  // Delay between starting each store (ms) - helps avoid detection
  storeStartDelay: 3000,

  // Browser settings (shared across all stores)
  browserSettings: {
    headless: true,
    defaultViewport: null,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--start-maximized",
      "--disable-dev-shm-usage", // Prevents memory issues
      "--disable-gpu",
    ],
  },
};

// ============================================================================
// SCRAPING JOBS - Organized by Store
// ============================================================================

const SCRAPING_JOBS = {
  // EUREKA STORE
  eureka: {
    scraper: scrapeProductsEureka, // Import function
    jobs: [
      {
        url: "https://www.eureka.com.kw/products/browse/phones/mobile-phones",
        category: "mobilephones",
      },
      // {
      //   url: "https://www.eureka.com.kw/products/browse/computers-tablets/tablets",
      //   category: "tablets",
      // },
      // {
      //   url: "https://www.eureka.com.kw/products/browse/audio/accessories",
      //   category: "headphones",
      // },
      // {
      //   url: "https://www.eureka.com.kw/products/browse/smart-watches/watches",
      //   category: "smartwatch",
      // },
      // Add more Eureka categories here
    ],
  },

  // XCITE STORE
  xcite: {
    scraper: scrapeProductsXcite,
    jobs: [
      {
        url: "https://www.xcite.com/mobile-phones/c",
        category: "mobilephones",
      },
      // {
      //   url: "https://www.xcite.com/laptops/c",
      //   category: "laptops",
      // },
      // Add more Xcite categories here
    ],
  },

  // BEST STORE
  best: {
    scraper: scrapeProductsBest,
    jobs: [
      {
        url: "https://best.com.kw/en/c/mobiles-nn?query=:relevance:allCategories:mobiles-nn:brand:xiaomi:brand:honor:brand:motorola",
        category: "mobilephones",
      },
      {
        url: "https://best.com.kw/en/c/mobiles-nn?query=:relevance:allCategories:mobiles-nn:brand:samsung:brand:apple",
        category: "mobilephones",
      },
      {
        url: "https://best.com.kw/en/c/mobiles-nn?query=:relevance:allCategories:mobiles-nn:brand:infinix:brand:vivo:brand:oppo:brand:nothing:brand:realme:brand:google:brand:oneplus:brand:huawei:brand:zentality",
        category: "mobilephones",
      },
      // Add more Best categories here
    ],
  },

  // Add more stores as needed
  // lulu: {
  //   scraper: scrapeProductsLulu,
  //   jobs: [...]
  // },
};

// ============================================================================
// STORE SCRAPER CLASS
// ============================================================================

class StoreScraper {
  constructor(storeName, storeConfig, config) {
    this.storeName = storeName;
    this.scraper = storeConfig.scraper; // The imported scrape function
    this.jobs = storeConfig.jobs;
    this.config = config;
    this.browser = null;

    this.stats = {
      total: storeConfig.jobs.length,
      success: 0,
      failed: 0,
      startTime: null,
      endTime: null,
      errors: [],
    };
  }

  async run() {
    console.log(`\n${"=".repeat(70)}`);
    console.log(`🏪 Starting Store: ${this.storeName.toUpperCase()}`);
    console.log(`   Categories to scrape: ${this.stats.total}`);
    console.log(`${"=".repeat(70)}\n`);

    this.stats.startTime = Date.now();

    try {
      // Launch ONE browser for this entire store
      this.browser = await puppeteer.launch(this.config.browserSettings);
      console.log(`✅ [${this.storeName}] Browser launched successfully`);

      // Process all jobs for this store SEQUENTIALLY
      // (Sequential is safer for anti-bot detection)
      for (let i = 0; i < this.jobs.length; i++) {
        const job = this.jobs[i];
        await this.runJob(job, i + 1);
      }

      this.stats.endTime = Date.now();
      this.printStoreReport();

      return {
        storeName: this.storeName,
        stats: this.stats,
        success: true,
      };
    } catch (error) {
      console.error(
        `\n❌ [${this.storeName}] Critical store failure:`,
        error.message
      );
      this.stats.endTime = Date.now();
      this.stats.errors.push({ type: "store_failure", message: error.message });
      this.printStoreReport();

      return {
        storeName: this.storeName,
        stats: this.stats,
        success: false,
        error: error.message,
      };
    } finally {
      if (this.browser) {
        await this.browser.close();
        console.log(`🔒 [${this.storeName}] Browser closed`);
      }
    }
  }

  async runJob(job, jobNumber) {
    console.log(
      `\n--- 🚀 [${this.storeName}] Job ${jobNumber}/${
        this.stats.total
      }: ${job.category.toUpperCase()} ---`
    );
    console.log(`    URL: ${job.url.substring(0, 80)}...`);

    const jobStartTime = Date.now();

    try {
      // Call the store-specific scraper function
      // Each scraper has signature: scrapeProducts(browser, url, category)
      await this.scraper(this.browser, job.url, job.category);

      const duration = Date.now() - jobStartTime;
      this.stats.success++;

      console.log(
        `✅ [${this.storeName}] ${job.category} completed in ${Math.floor(
          duration / 1000
        )}s`
      );
    } catch (error) {
      const duration = Date.now() - jobStartTime;
      this.stats.failed++;

      const errorInfo = {
        category: job.category,
        url: job.url,
        message: error.message,
        duration: Math.floor(duration / 1000),
      };
      this.stats.errors.push(errorInfo);

      console.error(
        `❌ [${this.storeName}] ${job.category} FAILED after ${Math.floor(
          duration / 1000
        )}s`
      );
      console.error(`   Reason: ${error.message}`);

      // Don't throw - continue with next job
    }
  }

  printStoreReport() {
    const duration = this.stats.endTime - this.stats.startTime;
    const minutes = Math.floor(duration / 60000);
    const seconds = Math.floor((duration % 60000) / 1000);

    console.log(`\n${"─".repeat(70)}`);
    console.log(`📊 [${this.storeName.toUpperCase()}] STORE SUMMARY:`);
    console.log(`${"─".repeat(70)}`);
    console.log(`   Total Jobs: ${this.stats.total}`);
    console.log(`   ✅ Success: ${this.stats.success}`);
    console.log(`   ❌ Failed: ${this.stats.failed}`);
    console.log(`   ⏱️  Duration: ${minutes}m ${seconds}s`);

    if (this.stats.errors.length > 0) {
      console.log(`\n   ⚠️  Errors:`);
      this.stats.errors.forEach((err, idx) => {
        if (err.category) {
          console.log(`      ${idx + 1}. ${err.category}: ${err.message}`);
        } else {
          console.log(`      ${idx + 1}. ${err.message}`);
        }
      });
    }

    console.log(`${"─".repeat(70)}`);
  }
}

// ============================================================================
// MAIN ORCHESTRATOR
// ============================================================================

async function runAllScrapers() {
  const prisma = new PrismaClient();
  const startTime = Date.now();

  console.log(`\n${"═".repeat(70)}`);
  console.log(`🤖 MULTI-STORE AUTOMATED SCRAPER SYSTEM`);
  console.log(`${"═".repeat(70)}`);

  const storeNames = Object.keys(SCRAPING_JOBS);
  const totalStores = storeNames.length;
  const totalJobs = Object.values(SCRAPING_JOBS).reduce(
    (sum, store) => sum + store.jobs.length,
    0
  );

  console.log(`\n📋 Configuration:`);
  console.log(`   Total Stores: ${totalStores}`);
  console.log(`   Total Categories: ${totalJobs}`);
  console.log(`   Max Concurrent Stores: ${CONFIG.maxConcurrentStores}`);
  console.log(`   Store Start Delay: ${CONFIG.storeStartDelay}ms`);
  console.log(`\n📦 Stores to process: ${storeNames.join(", ")}\n`);

  try {
    // Create concurrency limiter for stores
    const limit = pLimit(CONFIG.maxConcurrentStores);

    // Create store scrapers
    const storeScrapers = storeNames.map((storeName, index) => {
      return limit(async () => {
        // Add staggered start delay (except first store)
        if (index > 0) {
          console.log(
            `⏳ Waiting ${CONFIG.storeStartDelay}ms before starting ${storeName}...`
          );
          await sleep(CONFIG.storeStartDelay);
        }

        const scraper = new StoreScraper(
          storeName,
          SCRAPING_JOBS[storeName],
          CONFIG
        );
        return await scraper.run();
      });
    });

    // Wait for all stores to complete
    const results = await Promise.allSettled(storeScrapers);

    // Print final report
    printFinalReport(results, startTime);
  } catch (error) {
    console.error(`\n${"═".repeat(70)}`);
    console.error(`❌ MASTER RUNNER CRITICAL FAILURE`);
    console.error(`${"═".repeat(70)}`);
    console.error(error);
  } finally {
    await prisma.$disconnect();
    console.log("\n🔒 Database connection closed.");
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printFinalReport(results, startTime) {
  const endTime = Date.now();
  const totalDuration = endTime - startTime;
  const hours = Math.floor(totalDuration / 3600000);
  const minutes = Math.floor((totalDuration % 3600000) / 60000);
  const seconds = Math.floor((totalDuration % 60000) / 1000);

  console.log(`\n\n${"═".repeat(70)}`);
  console.log(`${"═".repeat(70)}`);
  console.log(`                    FINAL EXECUTION REPORT`);
  console.log(`${"═".repeat(70)}`);
  console.log(`${"═".repeat(70)}\n`);

  let totalJobsSuccess = 0;
  let totalJobsFailed = 0;
  let storesCompleted = 0;
  let storesFailed = 0;
  const failedStores = [];

  console.log(`📊 Store-by-Store Results:\n`);

  results.forEach((result, idx) => {
    if (result.status === "fulfilled" && result.value) {
      const store = result.value;

      if (store.success) {
        storesCompleted++;
        console.log(`${idx + 1}. ✅ ${store.storeName.toUpperCase()}`);
      } else {
        storesFailed++;
        failedStores.push(store.storeName);
        console.log(`${idx + 1}. ❌ ${store.storeName.toUpperCase()} (FAILED)`);
      }

      console.log(`      Categories Success: ${store.stats.success}`);
      console.log(`      Categories Failed: ${store.stats.failed}`);

      const duration = store.stats.endTime - store.stats.startTime;
      const mins = Math.floor(duration / 60000);
      const secs = Math.floor((duration % 60000) / 1000);
      console.log(`      Duration: ${mins}m ${secs}s`);

      totalJobsSuccess += store.stats.success;
      totalJobsFailed += store.stats.failed;

      if (store.error) {
        console.log(`      Error: ${store.error}`);
      }

      if (store.stats.errors && store.stats.errors.length > 0) {
        console.log(`      Failed Categories:`);
        store.stats.errors.forEach((err) => {
          if (err.category) {
            console.log(`         - ${err.category}: ${err.message}`);
          }
        });
      }

      console.log();
    } else {
      storesFailed++;
      console.log(`${idx + 1}. ❌ UNKNOWN STORE (Promise Rejected)`);
      console.log(`      Error: ${result.reason}\n`);
    }
  });

  console.log(`${"─".repeat(70)}\n`);
  console.log(`📈 Overall Statistics:`);
  console.log(`   Stores Completed: ${storesCompleted}/${results.length}`);
  console.log(`   Stores Failed: ${storesFailed}/${results.length}`);
  console.log(`   Total Categories Success: ${totalJobsSuccess}`);
  console.log(`   Total Categories Failed: ${totalJobsFailed}`);

  let durationStr = "";
  if (hours > 0) {
    durationStr = `${hours}h ${minutes}m ${seconds}s`;
  } else {
    durationStr = `${minutes}m ${seconds}s`;
  }
  console.log(`   Total Duration: ${durationStr}`);

  if (totalJobsSuccess + totalJobsFailed > 0) {
    const successRate = (
      (totalJobsSuccess / (totalJobsSuccess + totalJobsFailed)) *
      100
    ).toFixed(1);
    console.log(`   Success Rate: ${successRate}%`);
  }

  if (failedStores.length > 0) {
    console.log(`\n   ⚠️  Failed Stores: ${failedStores.join(", ")}`);
  }

  console.log();
  console.log(`${"═".repeat(70)}`);
  console.log(`🎉 All scraping operations completed!`);
  console.log(`${"═".repeat(70)}\n`);
}

// ============================================================================
// ERROR HANDLERS
// ============================================================================

process.on("unhandledRejection", (error) => {
  console.error("\n💥 Unhandled Promise Rejection:", error);
  process.exit(1);
});

process.on("uncaughtException", (error) => {
  console.error("\n💥 Uncaught Exception:", error);
  process.exit(1);
});

// ============================================================================
// EXECUTION
// ============================================================================

runAllScrapers();
