import axios from "axios";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// 1. SETTINGS
// We use the ID found in your JSON snippet: 2546081 ("THE NEW")
const CATEGORY_ID = 1881757; // Example: Jeans Category ID
const BASE_URL = `https://www.zara.com/kw/en/categories?categoryId=${CATEGORY_ID}&ajax=true`;

async function scrapeZaraApi() {
  console.log(`🚀 Fetching API for Category ID: ${CATEGORY_ID}...`);

  try {
    const response = await axios.get(BASE_URL, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    // 2. NAVIGATE THE JSON
    // The products are usually nested deep inside 'productGroups'
    const groups = response.data.productGroups;

    if (!groups || groups.length === 0) {
      console.log("❌ No product groups found. Check Category ID.");
      return;
    }

    // Usually the first group contains the main products
    // 'elements' is the array of actual products
    const products = groups[0].elements;

    console.log(`✅ Found ${products.length} products. Processing...`);

    for (const item of products) {
      // FILTER: Only process items that are actually products (sometimes they include ads)
      if (!item.commercialComponents) continue;

      const detail = item.commercialComponents[0]; // Main product details

      // 3. EXTRACT DATA
      const title = detail.name;
      const price = detail.price / 100; // Zara prices are in cents (e.g. 17900 = 179.00)
      const currency = detail.currency;
      const sku = detail.reference;
      const color = detail.colorName || "Unknown";

      // 4. IMAGE BUILDER
      // Zara splits image URLs into parts. We must assemble them.
      let imageUrl = "";
      if (detail.xmedia && detail.xmedia.length > 0) {
        const media = detail.xmedia[0];
        const path = media.path;
        const name = media.name;
        const timestamp = media.timestamp;
        // Standard Zara Image URL format
        imageUrl = `https://static.zara.net/assets/public/${path}/${name}/w/1024/${name}.jpg?ts=${timestamp}`;
      }

      console.log(`💰 ${title} | ${price} ${currency} | ${color}`);

      // 5. SAVE TO PRISMA (Simplified)
      /*
        await prisma.product.upsert({
            where: { productUrl: `zara-${sku}` }, // Use SKU as unique key if URL missing
            update: { price, title, imageUrl },
            create: {
                title,
                price,
                imageUrl,
                storeName: "ZARA",
                sku,
                specs: { color }
            }
        });
        */
    }
  } catch (error) {
    console.error("❌ Error:", error.message);
  }
}

scrapeZaraApi();
