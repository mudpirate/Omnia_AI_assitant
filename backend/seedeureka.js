import { PrismaClient, StoreName, StockStatus, Category } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding dummy Eureka product...");

  // Dummy Data
  const dummyProduct = {
    title: "TEST - Nokia 105 (Dummy Data)",
    storeName: StoreName.EUREKA, 
    productUrl: "https://www.eureka.com.kw/products/details/dummy-123",
    price: 7.9,
    description: "This is a test entry to verify the Eureka integration.",
    category: Category.MOBILE_PHONE,
    imageUrl:
      "https://cdnimage.eureka.com.kw/productimages/largeimages/nokia-105ds-4g-charc-ol-qo8zm.jpg",
    stock: StockStatus.IN_STOCK,
    brand: "Nokia",
    specs: { ram: "4MB", color: "Charcoal" }, 
    searchKey: "Nokia 105 Dummy Phone",
    scrapedAt: new Date(),
    lastSeenAt: new Date(),
  };

  try {
    // Using upsert so you can run this script multiple times without errors
    const product = await prisma.product.upsert({
      where: {
        storeName_productUrl: {
          storeName: dummyProduct.storeName,
          productUrl: dummyProduct.productUrl,
        },
      },
      update: dummyProduct,
      create: dummyProduct,
    });

    console.log(`✅ Successfully saved dummy product with ID: ${product.id}`);
  } catch (error) {
    console.error("❌ Error saving dummy data:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
