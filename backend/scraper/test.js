import { PrismaClient } from "@prisma/client";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const prisma = new PrismaClient();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 1. Generate Embedding for the Query
async function getEmbedding(text) {
  try {
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
      encoding_format: "float",
    });
    return response.data[0].embedding;
  } catch (error) {
    console.error("⚠️ OpenAI Error:", error.message);
    return null;
  }
}

// 2. The Search Function
async function testSearch(queryText, limit = 3) {
  console.log(`\n🔎 Testing Query: "${queryText}"...`);

  const vector = await getEmbedding(queryText);
  if (!vector) return;

  // Convert vector to a string format Postgres understands
  const vectorString = `[${vector.join(",")}]`;

  // 3. Execute Hybrid Search (Vector + Similarity Calculation)
  // We use 1 - (A <=> B) because <=> is "distance" (0 is identical)
  // So 1 - distance gives us "similarity" (100% is identical)
  const results = await prisma.$queryRaw`
    SELECT 
      id, 
      title, 
      price, 
      brand,
      "searchKey",
      1 - ("descriptionEmbedding" <=> ${vectorString}::vector) as similarity
    FROM "Product"
    WHERE "descriptionEmbedding" IS NOT NULL
    ORDER BY similarity DESC
    LIMIT ${limit};
  `;

  // 4. Print Results nicely
  if (results.length === 0) {
    console.log("❌ No results found. (Check if your DB has embeddings!)");
  } else {
    results.forEach((p, i) => {
      console.log(
        `\n   ${i + 1}. [${(p.similarity * 100).toFixed(1)}% Match] ${p.title}`
      );
      console.log(`      💰 ${p.price} KWD | 🏷️ ${p.brand}`);
      console.log(`      🧠 Context: ${p.searchKey.substring(0, 100)}...`);
    });
  }
}

// 5. Run Test Cases
async function main() {
  try {
    // TEST CASE 1: Semantic match (concepts, not just keywords)
    await testSearch("Apple iPhone 17 Pro 6.3 512GB - Deep Blue ");
    await testSearch("macbook pro  ");
    await testSearch("ipad 11th gen");
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
