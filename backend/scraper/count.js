import { PrismaClient } from "@prisma/client";

// Initialize Prisma Client
const prisma = new PrismaClient();

/**
 * Counts the total number of records in the 'product' table.
 */
async function countProducts() {
  try {
    // Assuming your model is named 'product' in your schema.
    const productCount = await prisma.product.count();

    console.log("====================================");
    console.log(`📊 Total Products in Database: ${productCount}`);
    console.log("====================================");

    // If you want to see a filtered count (e.g., only from 'Jarir'):
    const jarirCount = await prisma.product.count({
      where: {
        storeName: "Xcite",
      },
    });
    console.log(`   (Products from Jarir only: ${jarirCount})`);
  } catch (error) {
    console.error("❌ Error counting products:", error.message);
  } finally {
    // Always disconnect the client when done
    await prisma.$disconnect();
  }
}

countProducts();
