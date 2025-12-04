import "dotenv/config";
import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";
import { v4 as uuidv4 } from "uuid";

const app = express();
const PORT = process.env.PORT || 4000;
const LLM_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const EMBEDDING_MODEL =
  process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const prisma = new PrismaClient();

// Initialize Redis
const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ limit: "20mb", extended: true }));

// -------------------- REDIS MEMORY HELPERS --------------------
async function saveToMemory(sessionId, role, content) {
  const key = `chat:${sessionId}`;
  const message = JSON.stringify({ role, content });
  await redis.rpush(key, message);
  await redis.ltrim(key, -20, -1);
  await redis.expire(key, 86400);
}

async function getMemory(sessionId) {
  const key = `chat:${sessionId}`;
  const rawHistory = await redis.lrange(key, 0, -1);
  return rawHistory.map((item) => JSON.parse(item));
}

// -------------------- CONFIG --------------------
const PRODUCT_CATEGORIES = {
  MOBILE_PHONE: {
    name: "mobile_phone",
    keywords: ["phone", "mobile", "smartphone", "android", "5g"],
    brands: ["samsung", "xiaomi", "huawei", "apple", "iphone", "pixel"],
    specs: ["gb", "ram", "camera", "5g"],
    exclude: ["case", "cover", "charger"],
    required: ["phone", "smartphone", "mobile", "galaxy", "pixel", "iphone"],
  },
  LAPTOP: {
    name: "laptop",
    keywords: ["laptop", "notebook", "macbook", "gaming"],
    brands: ["dell", "hp", "lenovo", "asus", "acer", "msi", "apple"],
    specs: ["intel", "amd", "ssd", "ram", "rtx"],
    exclude: ["bag", "case", "charger", "mouse"],
    required: ["laptop", "notebook", "macbook", "surface"],
  },
  HEADPHONE: {
    name: "headphone",
    keywords: ["headphone", "headphones", "headset"],
    brands: ["sony", "bose", "jbl", "sennheiser", "beats"],
    specs: ["wireless", "bluetooth", "anc"],
    exclude: ["case", "cable", "earbuds"],
    required: ["headphone", "headphones", "headset"],
  },
  // Add other categories as needed...
};

const APPLE_TERMS = [
  "iphone",
  "apple",
  "ios",
  "macbook",
  "ipad",
  "mac",
  "airpods",
];
const ANDROID_TERMS = [
  "samsung",
  "huawei",
  "xiaomi",
  "android",
  "galaxy",
  "pixel",
];

// -------------------- LOGIC HELPERS --------------------

async function generateStandaloneQuery(userMessage, history) {
  if (!history || history.length === 0) return userMessage;
  const recentHistory = history.slice(-1);
  const conversationText = recentHistory
    .map((msg) => `${msg.role === "user" ? "User" : "AI"}: ${msg.content}`)
    .join("\n");

  const systemPrompt = `
    You are a Query Refiner.
    1. If FOLLOW-UP: Merge with history.
    2. If NEW TOPIC: Use user message only.
    3. Output CLEAN text (no markdown, no quotes).
  `;

  try {
    const response = await openai.chat.completions.create({
      model: LLM_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `HISTORY:\n${conversationText}\n\nUSER: "${userMessage}"`,
        },
      ],
      temperature: 0.0,
    });
    return (
      response.choices[0].message.content.replace(/["*]/g, "").trim() ||
      userMessage
    );
  } catch (error) {
    return userMessage;
  }
}

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

// --- IMPROVED WEB SEARCH ---
async function searchWeb(query) {
  console.log(`[Web Search] Processing: "${query}"...`);
  try {
    const { vectorLiteral } = await getQueryEmbedding(query);

    // Check Cache
    const closestMatch = await prisma.$queryRawUnsafe(`
      SELECT response, 1 - (embedding <=> '${vectorLiteral}'::vector) as similarity
      FROM "WebSearchCache"
      ORDER BY similarity DESC
      LIMIT 1;
    `);

    // Threshold logic
    if (closestMatch.length > 0 && closestMatch[0].similarity > 0.73) {
      console.log(`[Web Search] ⚡ CACHE HIT`);
      return closestMatch[0].response;
    }

    console.log(`[Web Search] 🌐 CACHE MISS. Calling API...`);
    const response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": process.env.SERPER_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: query, gl: "kw", hl: "en" }),
    });

    if (!response.ok) return null;
    const data = await response.json();

    // Cache Result
    if (data?.organic?.length > 0) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "WebSearchCache" (id, query, response, "embedding", "createdAt")
         VALUES (gen_random_uuid(), $1, $2::jsonb, '${vectorLiteral}'::vector, NOW())`,
        query,
        JSON.stringify(data)
      );
    }
    return data;
  } catch (error) {
    console.error("[Web Search] Error:", error);
    return null;
  }
}

// --- EXTRACTION HELPERS ---
function extractStoreName(msg) {
  msg = msg.toLowerCase();
  if (msg.includes("noon")) return "noon.kw";
  if (msg.includes("xcite")) return "xcite";
  if (msg.includes("jarir")) return "jarir";
  if (msg.includes("best")) return "best.kw";
  return null;
}

function extractPriceRange(msg) {
  const match = msg.match(/(\d+)/g);
  if (!match) return null;
  // Simple logic: if two numbers, range. If one number + "under", max.
  const nums = match.map(Number);
  if (msg.includes("under") || msg.includes("below") || msg.includes("max"))
    return { min: 0, max: nums[0] };
  if (msg.includes("above") || msg.includes("over") || msg.includes("min"))
    return { min: nums[0], max: 10000 };
  if (nums.length >= 2)
    return { min: Math.min(nums[0], nums[1]), max: Math.max(nums[0], nums[1]) };
  return null;
}

function detectProductCategory(msg) {
  msg = msg.toLowerCase();
  for (const [key, config] of Object.entries(PRODUCT_CATEGORIES)) {
    if (config.required.some((r) => msg.includes(r))) return config.name;
    if (config.keywords.some((k) => msg.includes(k))) return config.name;
  }
  return null;
}

async function classifyIntent(query) {
  // Force Web Search for information queries
  if (/(news|review|release date|leak|rumor|vs|compare|specs of)/i.test(query))
    return "WEB_SEARCH";

  const systemPrompt = `Classify query: LOW (browsing), MEDIUM (category/brand), HIGH (specific model). Output ONLY label.`;
  try {
    const response = await openai.chat.completions.create({
      model: LLM_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: query },
      ],
      temperature: 0,
      max_tokens: 5,
    });
    const intent = response.choices[0].message.content.trim().toUpperCase();
    return ["LOW", "MEDIUM", "HIGH"].includes(intent) ? intent : "LOW";
  } catch (e) {
    return "LOW";
  }
}

// --- DB SEARCH ---
async function executeEmbeddingSearch(vectorLiteral, maxResults) {
  try {
    const query = `
      SELECT "title", "price", "storeName", "productUrl", "category", "imageUrl", "stock", "description"
      FROM "Product"
      WHERE "descriptionEmbedding" IS NOT NULL
      ORDER BY "descriptionEmbedding" <#> '${vectorLiteral}'::vector ASC
      LIMIT ${maxResults};
    `;
    return await prisma.$queryRawUnsafe(query);
  } catch (err) {
    console.error("DB Error:", err);
    return [];
  }
}

// --- FILTER & RANK ---
function filterAndRankProducts(
  products,
  userQuery,
  productCount,
  category,
  priceRange,
  storeName
) {
  // (Simplified for brevity - logic remains similar to previous version)
  let filtered = products.filter((p) => {
    if (priceRange && (p.price < priceRange.min || p.price > priceRange.max))
      return false;
    if (storeName && !p.storeName.toLowerCase().includes(storeName))
      return false;
    return true;
  });

  // Basic Score Sort (Keyword match)
  const terms = userQuery.toLowerCase().split(" ");
  filtered = filtered.map((p) => {
    let score = 0;
    terms.forEach((t) => {
      if (p.title.toLowerCase().includes(t)) score += 10;
    });
    return { ...p, score };
  });

  filtered.sort((a, b) => b.score - a.score);
  return filtered.slice(0, productCount);
}

// --- SSE HELPER ---
const sendEvent = (res, event, data) => {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};

// -------------------- MAIN CHAT ROUTE --------------------
app.post("/chat", async (req, res) => {
  let { query: message, sessionId } = req.body;
  if (!message) return res.status(400).json({ error: "Message required" });

  // SSE Setup
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  if (!sessionId) {
    sessionId = uuidv4();
    sendEvent(res, "session", { sessionId });
  }

  try {
    const history = await getMemory(sessionId);
    const standaloneQuery = await generateStandaloneQuery(message, history);

    // Analyze
    const detectedCategory = detectProductCategory(standaloneQuery);
    let intent = await classifyIntent(standaloneQuery);
    const priceRange = extractPriceRange(standaloneQuery);
    const storeName = extractStoreName(standaloneQuery);

    console.log(
      `[Chat] ${sessionId} | Intent: ${intent} | Query: ${standaloneQuery}`
    );
    sendEvent(res, "status", "Thinking...");

    let textReply = "";

    // ---------------------------------------------
    // BRANCH 1: WEB SEARCH (News, Reviews, General)
    // ---------------------------------------------
    if (intent === "WEB_SEARCH" || (intent === "LOW" && !detectedCategory)) {
      sendEvent(res, "status", "Searching the web...");

      const serperData = await searchWeb(standaloneQuery);

      let context = "";
      if (serperData && serperData.organic) {
        context = serperData.organic
          .slice(0, 4)
          .map((r) => `Title: ${r.title}\nSnippet: ${r.snippet}`)
          .join("\n\n");
      } else {
        context = "No live data found.";
      }

      const prompt = `
          User Query: "${standaloneQuery}"
          Web Search Results:
          ${context}
          
          Task: Write a helpful response answering the user's question based on the search results. 
          If mentioning products, be specific. Output plain text.
        `;

      // STREAM THE WEB RESPONSE
      const stream = await openai.chat.completions.create({
        model: LLM_MODEL,
        messages: [
          { role: "system", content: "You are Omnia AI." },
          { role: "user", content: prompt },
        ],
        stream: true,
      });

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || "";
        if (content) {
          textReply += content;
          res.write(`event: token\ndata: ${JSON.stringify(content)}\n\n`);
        }
      }
    }
    // ---------------------------------------------
    // BRANCH 2: PRODUCT SEARCH (Catalog)
    // ---------------------------------------------
    else {
      sendEvent(res, "status", "Searching catalog...");

      const { vectorLiteral } = await getQueryEmbedding(standaloneQuery);
      const dbProducts = await executeEmbeddingSearch(vectorLiteral, 50);

      let foundProducts = [];
      if (dbProducts.length > 0) {
        foundProducts = filterAndRankProducts(
          dbProducts,
          standaloneQuery,
          10,
          detectedCategory,
          priceRange,
          storeName
        );
      }

      // Send Products to Frontend
      if (foundProducts.length > 0) {
        const frontendProducts = foundProducts.map((p) => ({
          product_name: p.title,
          store_name: p.storeName,
          price_kwd: p.price,
          product_url: p.productUrl,
          image_url: p.imageUrl,
          // FALLBACK if description is missing
          product_description:
            p.description && p.description.length > 10
              ? p.description
              : p.title,
        }));
        sendEvent(res, "products", frontendProducts);
      } else {
        // Fallback to text if no products
        sendEvent(
          res,
          "token",
          "I couldn't find exact matches in our catalog, but here is some general advice. "
        );
      }

      // Stream Summary
      const productsContext = foundProducts
        .slice(0, 3)
        .map((p) => p.title)
        .join(", ");
      const prompt = `
          User Query: "${standaloneQuery}"
          Found ${foundProducts.length} items. Top matches: ${productsContext}.
          Write a short, friendly summary recommending these items.
        `;

      const stream = await openai.chat.completions.create({
        model: LLM_MODEL,
        messages: [
          { role: "system", content: "You are Omnia AI." },
          { role: "user", content: prompt },
        ],
        stream: true,
      });

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || "";
        if (content) {
          textReply += content;
          res.write(`event: token\ndata: ${JSON.stringify(content)}\n\n`);
        }
      }
    }

    // Save & Close
    await saveToMemory(sessionId, "user", message);
    await saveToMemory(sessionId, "assistant", textReply);
    sendEvent(res, "done", {});
    res.end();
  } catch (error) {
    console.error("Route Error:", error);
    sendEvent(res, "error", "Server Error");
    res.end();
  }
});

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.listen(PORT, () => console.log(`Server running on ${PORT}`));
