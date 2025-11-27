// runner.js
import scrapeProducts from "./xcite.js"; // Adjust path as necessary

const SCRAPING_JOBS = [
  {
    url: "https://www.xcite.com/televisions/c",
    category: "televisions",
  },
];

async function runAllScrapers() {
  console.log(`\n======================================`);
  console.log(
    `🤖 Starting Master Scraper Runner (${SCRAPING_JOBS.length} jobs)`
  );
  console.log(`======================================`);

  for (const job of SCRAPING_JOBS) {
    console.log(`\n--- Executing Job: ${job.category.toUpperCase()} ---`);
    await scrapeProducts(job.url, job.category);
    console.log(`✅ Job ${job.category} finished its execution block.`);
  }

  console.log(`\n======================================`);
  console.log(`🎉 All scraping jobs completed.`);
  console.log(`======================================`);

  // Only close the database connection once, at the very end of the master script
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  await prisma.$disconnect();
  console.log("🔒 Database connection closed.");
}

runAllScrapers();
