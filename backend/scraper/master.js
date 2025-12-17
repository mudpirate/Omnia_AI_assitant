// runner.js
import puppeteer from "puppeteer";
import { PrismaClient } from "@prisma/client";
import scrapeProducts from "./best.js";

// Define jobs with URLs and simple "hint" category names.
// The scraper's internal logic will map these hints to strict Enums.
const SCRAPING_JOBS = [
  {
    url: "https://best.com.kw/en/c/mobiles-nn",
    category: "mobilephones", // Will map to Category.MOBILE_PHONE
  },

  // {
  //   url: "https://www.eureka.com.kw/products/browse/computers-tablets/laptops",
  //   category: "laptops", // Will map to Category.LAPTOP
  // },
  // {
  //   url: "https://www.eureka.com.kw/products/browse/computers-tablets/tablets",
  //   category: "tablets", // Will map to Category.TABLET
  // },
  // {
  //   url: "https://www.eureka.com.kw/products/browse/audio/accessories",
  //   category: "headphones", // Will map to Category.HEADPHONE
  // },
  // {
  //   url: "https://www.eureka.com.kw/products/browse/smart-watches/watches",
  //   category: "smartwatch", // Will map to Category.HEADPHONE
  // },
  // {
  //   url: "https://www.xcite.com/apple-iphone/c",
  //   category: "mobilephones", // Will map to Category.HEADPHONE
  // },
];

async function runAllScrapers() {
  const prisma = new PrismaClient();
  let browser = null;

  console.log(`\n======================================`);
  console.log(
    `🤖 Starting Master Scraper Runner (${SCRAPING_JOBS.length} jobs)`
  );
  console.log(`======================================`);

  try {
    // ⚡ OPTIMIZATION: Launch the Puppeteer browser ONLY ONCE
    // This saves massive memory/CPU compared to launching it for every category
    browser = await puppeteer.launch({
      headless: true, // Set to false if you want to watch it work
      defaultViewport: null,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--start-maximized"],
    });
    console.log("✅ Puppeteer browser launched successfully.");

    // Sequential Loop (Safer than Promise.all for avoiding anti-bot detection)
    for (const job of SCRAPING_JOBS) {
      console.log(`\n--- 🚀 Executing Job: ${job.category.toUpperCase()} ---`);

      try {
        // Pass the SHARED browser instance to the scraper
        await scrapeProducts(browser, job.url, job.category);
        console.log(`✅ Job [${job.category}] finished successfully.`);
      } catch (jobError) {
        // Critical: Catch errors here so one failed category doesn't crash the whole runner
        console.error(`❌ Job [${job.category}] FAILED to complete.`);
        console.error(`Reason: ${jobError.message}`);
      }
    }

    console.log(`\n======================================`);
    console.log(`🎉 All scraping jobs completed.`);
    console.log(`======================================`);
  } catch (error) {
    console.error(`\n--- MASTER RUNNER CRITICAL FAILURE ---`);
    console.error(error);
  } finally {
    if (browser) {
      await browser.close();
      console.log("🔒 Puppeteer browser closed.");
    }
    await prisma.$disconnect();
    console.log("🔒 Database connection closed.");
  }
}

runAllScrapers();
