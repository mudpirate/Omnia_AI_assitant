// scripts/generate-clip-embeddings.js
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const MODAL_CLIP_BATCH_URL = process.env.MODAL_CLIP_BATCH_URL;

// ═══════════════════════════════════════════════════════════════════════
// CONFIGURATION - Change these to target different products
// ═══════════════════════════════════════════════════════════════════════
const CONFIG = {
  storeName: "DIESEL", // Target store (null for all stores)
  category: "CLOTHING", // Target category (null for all categories)
  limit: 500, // Max products to process (null for no limit)
  batchSize: 16, // Products per Modal API call
  delayMs: 2000, // Delay between batches (ms)
};

async function fetchImageAsBase64(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const buffer = await response.arrayBuffer();
    return Buffer.from(buffer).toString("base64");
  } catch (error) {
    return null;
  }
}

async function generateEmbeddings() {
  console.log("\n" + "=".repeat(60));
  console.log("🚀 CLIP IMAGE EMBEDDING GENERATOR");
  console.log("=".repeat(60));
  console.log("\n📋 Configuration:");
  console.log(`   Store: ${CONFIG.storeName || "ALL"}`);
  console.log(`   Category: ${CONFIG.category || "ALL"}`);
  console.log(`   Max products: ${CONFIG.limit || "UNLIMITED"}`);
  console.log(`   Batch size: ${CONFIG.batchSize}`);
  console.log(`\n📡 Modal endpoint: ${MODAL_CLIP_BATCH_URL}`);

  if (!MODAL_CLIP_BATCH_URL) {
    console.error("\n❌ MODAL_CLIP_BATCH_URL not set in .env");
    process.exit(1);
  }

  // Build WHERE clause based on config
  let whereConditions = [`"imageUrl" IS NOT NULL`, `"imageEmbedding" IS NULL`];

  if (CONFIG.storeName) {
    whereConditions.push(`"storeName" = '${CONFIG.storeName}'`);
  }
  if (CONFIG.category) {
    whereConditions.push(`"category" = '${CONFIG.category}'`);
  }

  const whereClause = whereConditions.join(" AND ");
  const limitClause = CONFIG.limit ? `LIMIT ${CONFIG.limit}` : "";

  const query = `
    SELECT id, title, "imageUrl", "storeName", category
    FROM "Product" 
    WHERE ${whereClause}
    ${limitClause}
  `;

  console.log("\n🔍 Query:", query.replace(/\s+/g, " ").trim());

  // Get products
  const products = await prisma.$queryRawUnsafe(query);

  console.log(`\n📦 Found ${products.length} products to process`);

  if (products.length === 0) {
    console.log("\n✅ No products need embeddings!");
    console.log("   Either all products already have embeddings,");
    console.log("   or no products match your filter criteria.");
    return;
  }

  // Show sample of what we're processing
  console.log("\n📝 Sample products:");
  products.slice(0, 3).forEach((p, i) => {
    console.log(`   ${i + 1}. ${p.title.substring(0, 50)}...`);
    console.log(`      Store: ${p.storeName} | Category: ${p.category}`);
  });

  const batchSize = CONFIG.batchSize;
  let processed = 0;
  let failed = 0;
  const startTime = Date.now();

  for (let i = 0; i < products.length; i += batchSize) {
    const batch = products.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(products.length / batchSize);

    console.log(`\n${"─".repeat(60)}`);
    console.log(
      `📊 Batch ${batchNum}/${totalBatches} (${batch.length} products)`
    );

    // Fetch images
    console.log("   📥 Fetching images...");
    const imagesData = await Promise.all(
      batch.map(async (p) => {
        const base64 = await fetchImageAsBase64(p.imageUrl);
        return { id: p.id, base64, title: p.title };
      })
    );

    const validImages = imagesData.filter((img) => img.base64 !== null);
    const failedFetches = batch.length - validImages.length;

    console.log(`   ✅ Images fetched: ${validImages.length}/${batch.length}`);
    if (failedFetches > 0) {
      console.log(`   ⚠️  Failed to fetch: ${failedFetches} images`);
    }

    if (validImages.length === 0) {
      failed += batch.length;
      continue;
    }

    try {
      // Call Modal
      console.log("   🤖 Calling Modal CLIP service...");
      const response = await fetch(MODAL_CLIP_BATCH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          images: validImages.map((img) => img.base64),
        }),
      });

      if (!response.ok) {
        throw new Error(`Modal API error: ${response.status}`);
      }

      const data = await response.json();

      if (!data.success || !data.embeddings) {
        throw new Error("Modal returned invalid response");
      }

      console.log(`   ✅ Got ${data.embeddings.length} embeddings`);

      // Save to database
      console.log("   💾 Saving to database...");
      for (let j = 0; j < validImages.length; j++) {
        const embedding = data.embeddings[j];
        const vectorLiteral =
          "[" + embedding.map((x) => x.toFixed(6)).join(",") + "]";

        await prisma.$executeRawUnsafe(`
          UPDATE "Product" 
          SET "imageEmbedding" = '${vectorLiteral}'::vector 
          WHERE id = '${validImages[j].id}'
        `);

        processed++;
      }

      failed += failedFetches;

      // Progress update
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const rate = (processed / elapsed).toFixed(1);
      console.log(
        `   ✅ Done! Total: ${processed}/${products.length} (${rate}/sec)`
      );
    } catch (error) {
      console.error(`   ❌ Error: ${error.message}`);
      failed += batch.length;
    }

    // Rate limiting
    if (i + batchSize < products.length) {
      console.log(`   ⏳ Waiting ${CONFIG.delayMs}ms...`);
      await new Promise((resolve) => setTimeout(resolve, CONFIG.delayMs));
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log("\n" + "=".repeat(60));
  console.log("📊 EMBEDDING GENERATION COMPLETE");
  console.log("=".repeat(60));
  console.log(`   🎯 Target: ${CONFIG.storeName} / ${CONFIG.category}`);
  console.log(`   ✅ Processed: ${processed} products`);
  console.log(`   ❌ Failed: ${failed} products`);
  console.log(`   ⏱️  Time: ${totalTime} seconds`);
  console.log(`   📈 Rate: ${(processed / totalTime).toFixed(1)} products/sec`);
  console.log("=".repeat(60) + "\n");
}

generateEmbeddings()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
