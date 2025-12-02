-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "StockStatus" AS ENUM ('IN_STOCK', 'OUT_OF_STOCK');

-- CreateEnum
CREATE TYPE "StoreName" AS ENUM ('XCITE', 'BEST_KW', 'NOON_KW', 'JARIR', 'BLINK');

-- CreateEnum
CREATE TYPE "Category" AS ENUM ('MOBILE_PHONE', 'LAPTOP', 'HEADPHONE', 'EARPHONE', 'TABLET', 'WATCH', 'ACCESSORY');

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "storeName" "StoreName" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "searchKey" TEXT NOT NULL,
    "descriptionEmbedding" vector(1536),
    "specs" JSONB,
    "category" "Category" NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "stock" "StockStatus" NOT NULL DEFAULT 'IN_STOCK',
    "brand" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL DEFAULT 'https://example.com/placeholder.png',
    "productUrl" TEXT NOT NULL DEFAULT 'https://example.com/placeholder-url',
    "scrapedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "couponId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Coupon" (
    "id" TEXT NOT NULL,
    "storeName" "StoreName" NOT NULL,
    "title" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expiryDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_store" ON "Product"("storeName");

-- CreateIndex
CREATE INDEX "idx_category" ON "Product"("category");

-- CreateIndex
CREATE INDEX "idx_price" ON "Product"("price");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_store_producturl" ON "Product"("storeName", "productUrl");

-- CreateIndex
CREATE INDEX "Coupon_expiryDate_idx" ON "Coupon"("expiryDate");

-- CreateIndex
CREATE UNIQUE INDEX "Coupon_storeName_code_key" ON "Coupon"("storeName", "code");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE SET NULL ON UPDATE CASCADE;
