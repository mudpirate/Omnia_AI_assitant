// runner.js
import scrapeProducts from "./noon.js"; // Adjust path as necessary

const SCRAPING_JOBS = [
  {
    url: "https://www.noon.com/kuwait-en/acer/apple/asus/dell/hp/lenovo/msi/?q=laptops",
    category: "laptops",
  },
  {
    url: "https://www.noon.com/kuwait-en/apple/huawei/samsung/xiaomi/?q=tablets",
    category: "tablets",
  },
  {
    url: "https://www.noon.com/kuwait-en/dell/hp/?q=desktops",
    category: "desktops",
  },
  {
    url: "https://www.noon.com/kuwait-en/anker/bose/huawei/jbl/lenovo/microsoft/oneplus/philips/samsung/sony/?q=headphones",
    category: "headphones",
  },
  {
    url: "https://www.noon.com/kuwait-en/apple/bose/huawei/jbl/lenovo/philips/samsung/sony/?q=earphones",
    category: "earphones",
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
