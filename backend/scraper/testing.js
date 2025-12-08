// scripts/testHybridSearch.mjs
import "dotenv/config";
import OpenAI from "openai";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const EMBEDDING_MODEL =
  process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";

async function getQueryEmbedding(text) {
  const embeddingRes = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  });
  const embedding = embeddingRes.data[0]?.embedding;
  if (!embedding) throw new Error("Failed to generate embedding");

  const vectorLiteral =
    "[" + embedding.map((x) => Number(x).toFixed(6)).join(",") + "]";

  return { embedding, vectorLiteral };
}

async function vectorSearch(vectorLiteral, limit = 10) {
  console.log(`[Vector Search] Using HNSW index...`);
  const query = `
    SELECT
      "title", "price", "storeName", "productUrl", "category",
      "imageUrl", "stock", "description", "brand", "specs",
      1 - ("descriptionEmbedding" <=> '${vectorLiteral}'::vector) as similarity
    FROM "Product"
    WHERE "descriptionEmbedding" IS NOT NULL
      AND "stock" = 'IN_STOCK'
    ORDER BY "descriptionEmbedding" <=> '${vectorLiteral}'::vector ASC
    LIMIT ${limit};
  `;
  return await prisma.$queryRawUnsafe(query);
}

// GIN Full-Text Search (Keyword)
async function fulltextSearch(searchQuery, limit = 50) {
  // 1. Convert user input to lower case ("iPhone 17" -> "iphone 17")
  const searchTerm = searchQuery.toLowerCase().trim();

  if (!searchTerm) return [];

  try {
    // 2. Use 'lower("searchKey")' to match your working SQL query
    return await prisma.$queryRaw`
      SELECT 
        "title", "price", "storeName", "productUrl", "category", 
        "imageUrl", "stock", "description", "brand", "specs",
        similarity(lower("searchKey"), ${searchTerm}) as rank
      FROM "Product"
      WHERE lower("searchKey") % ${searchTerm}
      ORDER BY rank DESC
      LIMIT ${limit};
    `;
  } catch (error) {
    console.error("[Fulltext Search] Error:", error);
    return [];
  }
}

function reciprocalRankFusion(vectorResults, fulltextResults, k = 60) {
  console.log(
    `[RRF] Fusing ${vectorResults.length} vector + ${fulltextResults.length} fulltext results...`
  );

  const scores = new Map();

  vectorResults.forEach((product, index) => {
    const key = product.productUrl || product.title;
    const rrfScore = 1 / (k + index + 1);
    scores.set(key, {
      product,
      score: rrfScore,
      vectorRank: index + 1,
    });
  });

  fulltextResults.forEach((product, index) => {
    const key = product.productUrl || product.title;
    const rrfScore = 1 / (k + index + 1);

    if (scores.has(key)) {
      const existing = scores.get(key);
      existing.score += rrfScore;
      existing.fulltextRank = index + 1;
    } else {
      scores.set(key, {
        product,
        score: rrfScore,
        fulltextRank: index + 1,
      });
    }
  });

  const fused = Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .map((item) => ({
      ...item.product,
      rrfScore: item.score,
      vectorRank: item.vectorRank || null,
      fulltextRank: item.fulltextRank || null,
    }));

  console.log(`[RRF] Fused into ${fused.length} unique results`);
  return fused;
}

async function main() {
  const query = process.argv.slice(2).join(" ") || "iphone 17 512gb";

  console.log("========================================");
  console.log(`Testing hybrid search for query: "${query}"`);
  console.log("========================================\n");

  const { vectorLiteral } = await getQueryEmbedding(query);

  const [vectorResults, fulltextResults] = await Promise.all([
    vectorSearch(vectorLiteral, 10),
    fulltextSearch(query, 10),
  ]);

  // --- Log VECTOR results ---
  console.log("\n===== VECTOR RESULTS =====");
  console.log(`Count: ${vectorResults.length}`);
  vectorResults.forEach((p, idx) => {
    console.log(
      `#${idx + 1} | sim=${Number(p.similarity).toFixed(4)} | ${
        p.storeName
      } | ${p.price} KWD | ${p.title}`
    );
  });

  // --- Log FULLTEXT results ---
  console.log("\n===== FULLTEXT RESULTS =====");
  console.log(`Count: ${fulltextResults.length}`);
  fulltextResults.forEach((p, idx) => {
    console.log(
      `#${idx + 1} | rank=${Number(p.rank).toFixed(4)} | ${p.storeName} | ${
        p.price
      } KWD | ${p.title}`
    );
  });

  // --- Hybrid RRF ---
  const hybridResults = reciprocalRankFusion(vectorResults, fulltextResults);

  console.log("\n===== HYBRID (RRF) RESULTS =====");
  console.log(`Count: ${hybridResults.length}`);
  hybridResults.slice(0, 10).forEach((p, idx) => {
    console.log(
      `#${idx + 1} | RRF=${Number(p.rrfScore).toFixed(4)} | vRank=${
        p.vectorRank
      } | ftRank=${p.fulltextRank} | ${p.storeName} | ${p.price} KWD | ${
        p.title
      }`
    );
  });

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
