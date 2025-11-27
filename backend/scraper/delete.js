import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function deleteAllTables() {
  try {
    console.log("🗑️  Starting to delete all data from tables...\n");

    // Delete all records from Product table
    console.log("Deleting all products...");
    const deletedProducts = await prisma.product.deleteMany({});
    console.log(`✅ Deleted ${deletedProducts.count} products`);

    // Delete all records from Coupon table (if it exists)
    console.log("\nDeleting all coupons...");
    const deletedCoupons = await prisma.coupon.deleteMany({});
    console.log(`✅ Deleted ${deletedCoupons.count} coupons`);

    // Add more tables here if you have them
    // Example:
    // console.log("\nDeleting all users...");
    // const deletedUsers = await prisma.user.deleteMany({});
    // console.log(`✅ Deleted ${deletedUsers.count} users`);

    console.log("\n=== DELETION SUMMARY ===");
    console.log(`Products deleted: ${deletedProducts.count}`);
    console.log(`Coupons deleted: ${deletedCoupons.count}`);
    console.log("========================\n");

    console.log("✅ All tables cleared successfully!");
  } catch (error) {
    console.error("\n❌ Error deleting data:", error.message);
    console.error(error.stack);
  } finally {
    await prisma.$disconnect();
    console.log("🔒 Database connection closed.");
  }
}

// Run the deletion
deleteAllTables();
