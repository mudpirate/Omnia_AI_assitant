-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "storeName" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "imageUrl" TEXT NOT NULL DEFAULT 'https://example.com/placeholder-image.png',
    "productUrl" TEXT NOT NULL DEFAULT 'https://example.com/placeholder-product-url',
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
    "storeName" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expiryDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_product_store" ON "Product"("storeName");

-- CreateIndex
CREATE INDEX "idx_product_category" ON "Product"("category");

-- CreateIndex
CREATE INDEX "idx_product_price" ON "Product"("price");

-- CreateIndex
CREATE INDEX "idx_product_updated_at" ON "Product"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_store_producturl" ON "Product"("storeName", "productUrl");

-- CreateIndex
CREATE INDEX "idx_coupon_expiry" ON "Coupon"("expiryDate");

-- CreateIndex
CREATE INDEX "idx_coupon_store" ON "Coupon"("storeName");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_store_code" ON "Coupon"("storeName", "code");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE SET NULL ON UPDATE CASCADE;
