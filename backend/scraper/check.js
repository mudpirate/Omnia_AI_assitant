import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function checkIphoneExistence(modelName) {
  console.log(`\n🔍 Searching database for "${modelName}"...`);

  try {
    // Query the database for the model name in the title
    const productCount = await prisma.product.count({
      where: {
        title: {
          contains: modelName,
          mode: "insensitive",
        },
      },
    });

    if (productCount > 0) {
      console.log(
        `\n✅ SUCCESS: Found ${productCount} products matching "${modelName}".`
      );

      // Optionally, show a sample product
      const sample = await prisma.product.findFirst({
        where: {
          title: {
            contains: modelName,
            mode: "insensitive",
          },
        },
        select: { title: true, price: true, storeName: true, productUrl: true },
      });

      console.log("--- Sample Product ---");
      console.log(`Title: ${sample.title}`);
      console.log(`Price: ${sample.price} KWD`);
      console.log(`Store: ${sample.storeName}`);
      console.log(`URL: ${sample.productUrl}`);
      console.log("------------------------\n");

      return true;
    } else {
      console.log(
        `\n❌ NOT FOUND: No products matching "${modelName}" were found.`
      );
      return false;
    }
  } catch (error) {
    console.error("\n🛑 DATABASE ERROR:", error.message);
    console.log(
      "Ensure your database is running and your DATABASE_URL is correctly set in .env."
    );
    return false;
  } finally {
    await prisma.$disconnect();
  }
}

// --- EXECUTE THE CHECK ---
// Note: Searching for 'iPhone 17' is highly specific.
// Use a broader search like 'iPhone 15' if you want to verify existing data.
checkIphoneExistence("iPhone 17");
// To test if it works with existing data, you could also run:
// checkIphoneExistence("iPhone 15");
