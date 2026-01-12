// runner.js - Optimized for Large-Scale Multi-Store Scraping
// Enhanced with URL-based progress tracking (allows same category, different URLs)
import puppeteer from "puppeteer";
import { PrismaClient } from "@prisma/client";
import pLimit from "p-limit";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

// Import all store scrapers
import scrapeProductsEureka from "./eureka.js";
import scrapeProductsXcite from "./xcite.js";
import scrapeProductsBest from "./best.js";
import scrapeBershkaProducts from "./bershka.js";
import scrapePrimarkProducts from "./primark.js";

// Add more imports as needed
// import scrapeProductsLulu from "./lulu.js";

// ============================================================================
// CONFIGURATION - Optimized for 5+ Stores, 10+ Categories Each
// ============================================================================

const CONFIG = {
  // CONCURRENCY SETTINGS
  maxConcurrentStores: 2, // Process 2 stores at a time (prevents resource exhaustion)
  maxConcurrentCategoriesPerStore: 1, // Categories per store run sequentially (safer)
  storeStartDelay: 5000, // 5s delay between starting stores (anti-detection)
  categoryDelay: 3000, // 3s delay between categories within same store

  // RETRY SETTINGS
  maxRetries: 2, // Retry failed categories up to 2 times
  retryDelay: 10000, // 10s delay before retry

  // BROWSER SETTINGS
  browserSettings: {
    headless: true,
    defaultViewport: null,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--start-maximized",
      "--disable-dev-shm-usage", // Prevents memory issues
      "--disable-gpu",
      "--disable-web-security", // Sometimes needed for CDN images
      "--disable-features=IsolateOrigins,site-per-process",
      "--disable-blink-features=AutomationControlled", // Anti-detection
      "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    ],
  },

  // MEMORY MANAGEMENT
  browserPoolSize: 2, // Reuse browsers (don't create new one for each store)
  closeIdleBrowserAfter: 300000, // Close browser after 5min idle (saves memory)

  // PROGRESS TRACKING
  saveProgressInterval: 60000, // Save progress every 1 minute
  progressFile: "./scraper-progress.json",

  // LOGGING
  verboseLogging: false, // Set to true for detailed logs
  logFile: "./scraper-log.txt",
};

// ============================================================================
// SCRAPING JOBS - Organized by Store
// ============================================================================

const SCRAPING_JOBS = {
  bershka: {
    scraper: scrapeBershkaProducts,
    priority: 1, // Lower number = higher priority
    jobs: [
      {
        url: "https://www.bershka.com/kw/men/sale/shirts-c1010747933.html",
        category: "CLOTHING",
      },
      {
        url: "https://www.bershka.com/kw/men/sale/t-shirts-and-polo-shirts-c1010747937.html",
        category: "CLOTHING",
      },
      {
        url: "https://www.bershka.com/kw/men/sale/trousers-and-jeans-c1010747956.html",
        category: "CLOTHING",
      },
      {
        url: "https://www.bershka.com/kw/women/sale/t-shirts-and-tops-c1010850199.html",
        category: "CLOTHING",
      },
    ],
  },

  primark: {
    scraper: scrapePrimarkProducts,
    priority: 2, // Lower number = higher priority
    jobs: [
      {
        url: "https://www.primark.com.kw/en/shop-men/clothing/shirts/--physical_stores_codes-ra1_q737_prm",
        category: "CLOTHING",
      },
      {
        url: "https://www.primark.com.kw/en/shop-men/clothing/trousers/--physical_stores_codes-ra1_q737_prm",
        category: "CLOTHING",
      },
      {
        url: "https://www.primark.com.kw/en/shop-women/clothing/tops-t-shirts/--physical_stores_codes-ra1_q737_prm",
        category: "CLOTHING",
      },
    ],
  },

  // EUREKA STORE
  // eureka: {
  //   scraper: scrapeProductsEureka,
  //   priority: 1, // Lower number = higher priority
  //   jobs: [
  //     {
  //       url: "https://www.eureka.com.kw/products/browse/phones/mobile-phones",
  //       category: "mobilephones",
  //     },
  //     {
  //       url: "https://www.eureka.com.kw/products/browse/computers-tablets/laptops",
  //       category: "laptops",
  //     },
  //   ],
  // },

  // Add more stores...
};

// ============================================================================
// BROWSER POOL - Reuse browsers to save memory
// ============================================================================

class BrowserPool {
  constructor(poolSize, browserSettings) {
    this.poolSize = poolSize;
    this.browserSettings = browserSettings;
    this.browsers = [];
    this.inUse = new Set();
    this.lastUsed = new Map();
  }

  async getBrowser() {
    // Find available browser
    const availableBrowser = this.browsers.find((b) => !this.inUse.has(b));

    if (availableBrowser) {
      this.inUse.add(availableBrowser);
      this.lastUsed.set(availableBrowser, Date.now());
      return availableBrowser;
    }

    // Create new browser if under pool size
    if (this.browsers.length < this.poolSize) {
      const browser = await puppeteer.launch(this.browserSettings);
      this.browsers.push(browser);
      this.inUse.add(browser);
      this.lastUsed.set(browser, Date.now());
      console.log(
        `🌐 [Browser Pool] Created browser ${this.browsers.length}/${this.poolSize}`
      );
      return browser;
    }

    // Wait for available browser
    console.log(`⏳ [Browser Pool] Waiting for available browser...`);
    await sleep(5000);
    return this.getBrowser();
  }

  releaseBrowser(browser) {
    this.inUse.delete(browser);
    this.lastUsed.set(browser, Date.now());
  }

  async closeIdleBrowsers(maxIdleTime) {
    const now = Date.now();
    const browsersToClose = [];

    for (const [browser, lastUsed] of this.lastUsed.entries()) {
      if (!this.inUse.has(browser) && now - lastUsed > maxIdleTime) {
        browsersToClose.push(browser);
      }
    }

    for (const browser of browsersToClose) {
      try {
        await browser.close();
        this.browsers = this.browsers.filter((b) => b !== browser);
        this.lastUsed.delete(browser);
        console.log(`🔒 [Browser Pool] Closed idle browser`);
      } catch (error) {
        console.error(
          `⚠️ [Browser Pool] Error closing browser:`,
          error.message
        );
      }
    }
  }

  async closeAll() {
    for (const browser of this.browsers) {
      try {
        await browser.close();
      } catch (error) {
        console.error(
          `⚠️ [Browser Pool] Error closing browser:`,
          error.message
        );
      }
    }
    this.browsers = [];
    this.inUse.clear();
    this.lastUsed.clear();
  }
}

// ============================================================================
// PROGRESS TRACKER - Enhanced with URL-based tracking
// ============================================================================

class ProgressTracker {
  constructor(progressFile) {
    this.progressFile = progressFile;
    this.progress = {
      stores: {}, // Now stores URL hashes instead of category names
      startTime: null,
      lastSaved: null,
      version: "2.0", // Version to track format changes
    };
  }

  /**
   * Generate unique hash for a job (store + URL)
   * This allows same category name with different URLs
   */
  generateJobHash(storeName, url) {
    const input = `${storeName}:${url}`;
    return crypto
      .createHash("md5")
      .update(input)
      .digest("hex")
      .substring(0, 16);
  }

  async load() {
    try {
      const data = await fs.readFile(this.progressFile, "utf-8");
      this.progress = JSON.parse(data);

      // Check version and migrate if needed
      if (!this.progress.version || this.progress.version === "1.0") {
        console.log(`🔄 [Progress] Detected old format, migrating to v2.0...`);
        this.progress = {
          stores: {},
          startTime: this.progress.startTime,
          lastSaved: this.progress.lastSaved,
          version: "2.0",
        };
      }

      console.log(
        `📂 [Progress] Loaded previous progress from ${this.progressFile}`
      );
      return true;
    } catch (error) {
      console.log(`📝 [Progress] No previous progress found, starting fresh`);
      return false;
    }
  }

  async save() {
    try {
      this.progress.lastSaved = Date.now();
      await fs.writeFile(
        this.progressFile,
        JSON.stringify(this.progress, null, 2)
      );
      if (CONFIG.verboseLogging) {
        console.log(`💾 [Progress] Saved to ${this.progressFile}`);
      }
    } catch (error) {
      console.error(`⚠️ [Progress] Error saving:`, error.message);
    }
  }

  markJobComplete(storeName, url, category, success) {
    if (!this.progress.stores[storeName]) {
      this.progress.stores[storeName] = {
        completed: {},
        failed: {},
        metadata: {}, // Store category names for reporting
      };
    }

    const jobHash = this.generateJobHash(storeName, url);
    const timestamp = Date.now();

    if (success) {
      this.progress.stores[storeName].completed[jobHash] = {
        url: url,
        category: category,
        completedAt: timestamp,
      };
      // Remove from failed if it was there
      delete this.progress.stores[storeName].failed[jobHash];
    } else {
      this.progress.stores[storeName].failed[jobHash] = {
        url: url,
        category: category,
        failedAt: timestamp,
      };
    }
  }

  isJobComplete(storeName, url) {
    const jobHash = this.generateJobHash(storeName, url);
    return this.progress.stores[storeName]?.completed?.[jobHash] !== undefined;
  }

  getCompletedJobsCount(storeName) {
    return Object.keys(this.progress.stores[storeName]?.completed || {}).length;
  }

  getFailedJobsCount(storeName) {
    return Object.keys(this.progress.stores[storeName]?.failed || {}).length;
  }

  getJobInfo(storeName, url) {
    const jobHash = this.generateJobHash(storeName, url);
    const completed = this.progress.stores[storeName]?.completed?.[jobHash];
    const failed = this.progress.stores[storeName]?.failed?.[jobHash];

    if (completed) {
      return { status: "completed", ...completed };
    } else if (failed) {
      return { status: "failed", ...failed };
    } else {
      return { status: "pending" };
    }
  }

  async clear() {
    try {
      await fs.unlink(this.progressFile);
      console.log(`🗑️  [Progress] Cleared progress file`);
    } catch (error) {
      // File doesn't exist, that's fine
    }
  }

  printProgress() {
    console.log(`\n📊 [Progress] Current State:`);
    for (const [storeName, storeData] of Object.entries(this.progress.stores)) {
      const completedCount = Object.keys(storeData.completed || {}).length;
      const failedCount = Object.keys(storeData.failed || {}).length;
      console.log(
        `   ${storeName}: ${completedCount} completed, ${failedCount} failed`
      );
    }
  }
}

// ============================================================================
// STORE SCRAPER CLASS - Enhanced with URL-based tracking
// ============================================================================

class StoreScraper {
  constructor(storeName, storeConfig, config, browserPool, progressTracker) {
    this.storeName = storeName;
    this.scraper = storeConfig.scraper;
    this.jobs = storeConfig.jobs;
    this.priority = storeConfig.priority || 999;
    this.config = config;
    this.browserPool = browserPool;
    this.progressTracker = progressTracker;
    this.browser = null;

    this.stats = {
      total: storeConfig.jobs.length,
      success: 0,
      failed: 0,
      skipped: 0,
      retried: 0,
      startTime: null,
      endTime: null,
      errors: [],
    };
  }

  async run() {
    console.log(`\n${"=".repeat(70)}`);
    console.log(`🏪 Starting Store: ${this.storeName.toUpperCase()}`);
    console.log(`   Categories to scrape: ${this.stats.total}`);
    console.log(`   Priority: ${this.priority}`);
    console.log(`${"=".repeat(70)}\n`);

    this.stats.startTime = Date.now();

    try {
      // Get browser from pool instead of creating new one
      this.browser = await this.browserPool.getBrowser();
      console.log(`✅ [${this.storeName}] Browser acquired from pool`);

      // Process all jobs for this store SEQUENTIALLY
      for (let i = 0; i < this.jobs.length; i++) {
        const job = this.jobs[i];

        // Check if already completed (using URL-based tracking)
        if (this.progressTracker.isJobComplete(this.storeName, job.url)) {
          const jobInfo = this.progressTracker.getJobInfo(
            this.storeName,
            job.url
          );
          console.log(
            `⏭️  [${this.storeName}] Skipping ${
              job.category
            } (URL already completed at ${new Date(
              jobInfo.completedAt
            ).toLocaleString()})`
          );
          console.log(`    URL: ${job.url.substring(0, 80)}...`);
          this.stats.skipped++;
          continue;
        }

        await this.runJobWithRetry(job, i + 1);

        // Delay between categories (anti-detection)
        if (i < this.jobs.length - 1) {
          console.log(
            `⏳ Waiting ${this.config.categoryDelay}ms before next category...`
          );
          await sleep(this.config.categoryDelay);
        }
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
        this.browserPool.releaseBrowser(this.browser);
        console.log(`🔓 [${this.storeName}] Browser released back to pool`);
      }
    }
  }

  async runJobWithRetry(job, jobNumber) {
    let attempt = 0;
    let success = false;

    while (attempt <= this.config.maxRetries && !success) {
      try {
        if (attempt > 0) {
          console.log(
            `🔄 [${this.storeName}] Retry attempt ${attempt}/${this.config.maxRetries} for ${job.category}`
          );
          console.log(`    URL: ${job.url.substring(0, 80)}...`);
          await sleep(this.config.retryDelay);
          this.stats.retried++;
        }

        await this.runJob(job, jobNumber, attempt);
        success = true;

        // Mark as complete (using URL-based tracking)
        this.progressTracker.markJobComplete(
          this.storeName,
          job.url,
          job.category,
          true
        );
        await this.progressTracker.save();
      } catch (error) {
        attempt++;

        if (attempt > this.config.maxRetries) {
          console.error(
            `❌ [${this.storeName}] ${job.category} FAILED after ${this.config.maxRetries} retries`
          );
          console.error(`    URL: ${job.url}`);
          this.stats.failed++;

          const errorInfo = {
            category: job.category,
            url: job.url,
            message: error.message,
            attempts: attempt,
          };
          this.stats.errors.push(errorInfo);

          // Mark as failed (using URL-based tracking)
          this.progressTracker.markJobComplete(
            this.storeName,
            job.url,
            job.category,
            false
          );
          await this.progressTracker.save();
        }
      }
    }
  }

  async runJob(job, jobNumber, attemptNumber) {
    const attemptLabel =
      attemptNumber > 0 ? ` (Attempt ${attemptNumber + 1})` : "";
    console.log(
      `\n--- 🚀 [${this.storeName}] Job ${jobNumber}/${
        this.stats.total
      }: ${job.category.toUpperCase()}${attemptLabel} ---`
    );
    console.log(`    URL: ${job.url.substring(0, 80)}...`);

    const jobStartTime = Date.now();

    try {
      // Call the store-specific scraper function
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
      console.error(
        `⚠️ [${this.storeName}] ${job.category} error after ${Math.floor(
          duration / 1000
        )}s: ${error.message}`
      );
      throw error; // Re-throw for retry logic
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
    console.log(`   ⏭️  Skipped: ${this.stats.skipped}`);
    console.log(`   🔄 Retried: ${this.stats.retried}`);
    console.log(`   ⏱️  Duration: ${minutes}m ${seconds}s`);

    if (this.stats.errors.length > 0) {
      console.log(`\n   ⚠️  Errors:`);
      this.stats.errors.forEach((err, idx) => {
        if (err.category) {
          console.log(
            `      ${idx + 1}. ${err.category}: ${err.message} (${
              err.attempts
            } attempts)`
          );
          console.log(`         URL: ${err.url.substring(0, 60)}...`);
        } else {
          console.log(`      ${idx + 1}. ${err.message}`);
        }
      });
    }

    console.log(`${"─".repeat(70)}`);
  }
}

// ============================================================================
// MAIN ORCHESTRATOR - Optimized for Large-Scale
// ============================================================================

async function runAllScrapers() {
  const prisma = new PrismaClient();
  const startTime = Date.now();

  // Initialize browser pool and progress tracker
  const browserPool = new BrowserPool(
    CONFIG.browserPoolSize,
    CONFIG.browserSettings
  );
  const progressTracker = new ProgressTracker(CONFIG.progressFile);

  // Load previous progress
  await progressTracker.load();
  progressTracker.printProgress();

  console.log(`\n${"═".repeat(70)}`);
  console.log(`🤖 MULTI-STORE AUTOMATED SCRAPER SYSTEM - LARGE-SCALE EDITION`);
  console.log(`${"═".repeat(70)}`);

  const storeNames = Object.keys(SCRAPING_JOBS);

  // Sort stores by priority
  storeNames.sort((a, b) => {
    const priorityA = SCRAPING_JOBS[a].priority || 999;
    const priorityB = SCRAPING_JOBS[b].priority || 999;
    return priorityA - priorityB;
  });

  const totalStores = storeNames.length;
  const totalJobs = Object.values(SCRAPING_JOBS).reduce(
    (sum, store) => sum + store.jobs.length,
    0
  );

  console.log(`\n📋 Configuration:`);
  console.log(`   Total Stores: ${totalStores}`);
  console.log(`   Total Categories: ${totalJobs}`);
  console.log(`   Max Concurrent Stores: ${CONFIG.maxConcurrentStores}`);
  console.log(`   Browser Pool Size: ${CONFIG.browserPoolSize}`);
  console.log(`   Max Retries per Category: ${CONFIG.maxRetries}`);
  console.log(`   Store Start Delay: ${CONFIG.storeStartDelay}ms`);
  console.log(`   Category Delay: ${CONFIG.categoryDelay}ms`);
  console.log(
    `   🔗 Progress Tracking: URL-based (allows duplicate categories)`
  );
  console.log(
    `\n📦 Stores to process (by priority): ${storeNames.join(", ")}\n`
  );

  // Set up auto-save interval
  const saveInterval = setInterval(async () => {
    await progressTracker.save();
  }, CONFIG.saveProgressInterval);

  // Set up idle browser cleanup
  const cleanupInterval = setInterval(async () => {
    await browserPool.closeIdleBrowsers(CONFIG.closeIdleBrowserAfter);
  }, 60000); // Check every minute

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
          CONFIG,
          browserPool,
          progressTracker
        );
        return await scraper.run();
      });
    });

    // Wait for all stores to complete
    const results = await Promise.allSettled(storeScrapers);

    // Clear intervals
    clearInterval(saveInterval);
    clearInterval(cleanupInterval);

    // Final save
    await progressTracker.save();

    // Print final report
    await printFinalReport(results, startTime, progressTracker);

    // Ask if user wants to clear progress
    console.log(
      `\n💡 To clear progress and start fresh next time, delete: ${CONFIG.progressFile}`
    );
  } catch (error) {
    console.error(`\n${"═".repeat(70)}`);
    console.error(`❌ MASTER RUNNER CRITICAL FAILURE`);
    console.error(`${"═".repeat(70)}`);
    console.error(error);
  } finally {
    clearInterval(saveInterval);
    clearInterval(cleanupInterval);

    await browserPool.closeAll();
    await prisma.$disconnect();

    console.log("\n🔒 All browsers closed");
    console.log("🔒 Database connection closed");
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function printFinalReport(results, startTime, progressTracker) {
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
  let totalJobsSkipped = 0;
  let totalRetries = 0;
  let storesCompleted = 0;
  let storesFailed = 0;
  const failedStores = [];
  const failedCategories = [];

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
      console.log(`      Categories Skipped: ${store.stats.skipped}`);
      console.log(`      Total Retries: ${store.stats.retried}`);

      const duration = store.stats.endTime - store.stats.startTime;
      const mins = Math.floor(duration / 60000);
      const secs = Math.floor((duration % 60000) / 1000);
      console.log(`      Duration: ${mins}m ${secs}s`);

      totalJobsSuccess += store.stats.success;
      totalJobsFailed += store.stats.failed;
      totalJobsSkipped += store.stats.skipped;
      totalRetries += store.stats.retried;

      if (store.error) {
        console.log(`      Error: ${store.error}`);
      }

      if (store.stats.errors && store.stats.errors.length > 0) {
        console.log(`      Failed Categories:`);
        store.stats.errors.forEach((err) => {
          if (err.category) {
            console.log(`         - ${err.category}: ${err.message}`);
            console.log(`           URL: ${err.url.substring(0, 60)}...`);
            failedCategories.push(`${store.storeName}/${err.category}`);
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
  console.log(`   Total Categories Skipped: ${totalJobsSkipped}`);
  console.log(`   Total Retries Performed: ${totalRetries}`);

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

  if (failedCategories.length > 0) {
    console.log(`\n   ⚠️  Failed Categories (${failedCategories.length}):`);
    failedCategories.forEach((cat, idx) => {
      console.log(`      ${idx + 1}. ${cat}`);
    });
  }

  console.log();
  console.log(`${"═".repeat(70)}`);
  console.log(`🎉 All scraping operations completed!`);
  console.log(`${"═".repeat(70)}\n`);

  // Save final summary
  const summaryFile = `./scraper-summary-${
    new Date().toISOString().split("T")[0]
  }.json`;
  const summary = {
    completedAt: new Date().toISOString(),
    duration: {
      hours,
      minutes,
      seconds,
      totalMs: totalDuration,
    },
    stats: {
      stores: {
        total: results.length,
        completed: storesCompleted,
        failed: storesFailed,
      },
      categories: {
        success: totalJobsSuccess,
        failed: totalJobsFailed,
        skipped: totalJobsSkipped,
      },
      retries: totalRetries,
      successRate:
        totalJobsSuccess + totalJobsFailed > 0
          ? (
              (totalJobsSuccess / (totalJobsSuccess + totalJobsFailed)) *
              100
            ).toFixed(1) + "%"
          : "N/A",
    },
    failedStores,
    failedCategories,
  };

  await fs.writeFile(summaryFile, JSON.stringify(summary, null, 2));
  console.log(`📄 Summary saved to: ${summaryFile}\n`);
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

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n\n⚠️  Received SIGINT, gracefully shutting down...");
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n\n⚠️  Received SIGTERM, gracefully shutting down...");
  process.exit(0);
});

// ============================================================================
// EXECUTION
// ============================================================================

console.log(`\n🚀 Starting Large-Scale Multi-Store Scraper...`);
console.log(`⏰ Started at: ${new Date().toLocaleString()}\n`);

runAllScrapers();
