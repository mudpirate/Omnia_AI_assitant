import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function restockProducts() {
  console.log("🚀 Starting bulk update...");
  const startTime = Date.now();

  const result = await prisma.product.updateMany({
    where: {
      stock: "OUT_OF_STOCK", // The old value you want to target
      // You can also limit it by store if needed:
      storeName: "HM",
    },
    data: {
      stock: "IN_STOCK", // The new value
    },
  });

  const duration = (Date.now() - startTime) / 1000;
  console.log(`✅ Updated ${result.count} products in ${duration}s`);
}

restockProducts()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
