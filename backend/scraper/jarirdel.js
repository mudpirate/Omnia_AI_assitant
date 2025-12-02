import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function deleteJarirProducts() {
  try {
    console.log("Deleting all Jarir products...");

    const deleted = await prisma.product.deleteMany({
      where: {
        storeName: {
          contains: "noon.kw",
          mode: "insensitive",
        },
      },
    });

    console.log(`Deleted ${deleted.count} Jarir products.`);
  } catch (err) {
    console.error("Error deleting Jarir products:", err);
  } finally {
    await prisma.$disconnect();
  }
}

deleteJarirProducts();
