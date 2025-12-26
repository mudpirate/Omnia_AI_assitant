import { PrismaClient } from "@prisma/client";
import "dotenv/config";

const prisma = new PrismaClient();

async function deleteHMProducts() {
  console.log("🗑️  Starting deletion of H&M products...");

  try {
    // ⚠️ This deletes ALL products with storeName "HM"
    const result = await prisma.product.deleteMany({
      where: {
        storeName: "HM", // This must match exactly how it's saved in your DB
      },
    });

    console.log(`✅ Successfully deleted ${result.count} products from H&M.`);
  } catch (error) {
    console.error("❌ Error deleting products:", error);
  } finally {
    await prisma.$disconnect();
  }
}

deleteHMProducts();
