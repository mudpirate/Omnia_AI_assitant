-- 1. Enable Required Extensions
-- 'vector' is for AI embeddings, 'pg_trgm' is for fuzzy text search
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- 2. Create Enums (For fixed values)
CREATE TYPE "StockStatus" AS ENUM ('IN_STOCK', 'OUT_OF_STOCK');
CREATE TYPE "StoreName" AS ENUM ('XCITE', 'BEST_KW', 'NOON_KW', 'EUREKA');

-- 3. Create Tables
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "storeName" "StoreName" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    
    -- Text Search Field (Indexed with GIN Trigram below)
    "searchKey" TEXT NOT NULL,
    
    -- Vector Search Field (Indexed with HNSW below)
    "descriptionEmbedding" vector(1536),
    
    -- Scalable Attributes Field (Indexed with GIN JSONB below)
    "specs" JSONB,
    
    "category" TEXT NOT NULL, -- Changed to TEXT for scalability
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

CREATE TABLE "WebSearchCache" (
    "id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "embedding" vector(1536) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebSearchCache_pkey" PRIMARY KEY ("id")
);

-- 4. Create Standard Indexes (B-Tree)
CREATE INDEX "idx_store" ON "Product"("storeName");
CREATE INDEX "idx_price" ON "Product"("price");
CREATE INDEX "idx_category" ON "Product"("category");
CREATE INDEX "Coupon_expiryDate_idx" ON "Coupon"("expiryDate");

-- 5. Create Unique Constraints
CREATE UNIQUE INDEX "uniq_store_producturl" ON "Product"("storeName", "productUrl");
CREATE UNIQUE INDEX "Coupon_storeName_code_key" ON "Coupon"("storeName", "code");

-- 6. Add Foreign Keys
ALTER TABLE "Product" ADD CONSTRAINT "Product_couponId_fkey" 
FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- 7. ADVANCED INDEXES (The "Secret Sauce" for Speed)
-- ============================================================

-- A. JSONB GIN Index (For Filtering Attributes)
-- Makes queries like `WHERE specs->>'color' = 'silver'` instant.
CREATE INDEX "idx_product_specs" ON "Product" USING GIN ("specs");

-- B. Trigram GIN Index (For Fuzzy Text Search)
-- Makes queries like `WHERE searchKey ILIKE '%iphoen%'` fast.
CREATE INDEX IF NOT EXISTS "idx_product_searchKey_trgm"
ON "Product"
USING GIN (lower("searchKey") gin_trgm_ops);

-- C. HNSW Vector Index (For Semantic Search)
-- Without this, vector search scans every row (too slow for 500k items).
-- 'm=16' and 'ef_construction=64' are standard balanced settings.
CREATE INDEX IF NOT EXISTS "idx_product_embedding_hnsw" 
ON "Product" 
USING hnsw ("descriptionEmbedding" vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- D. HNSW Index for Web Cache (Optional but good for cache hits)
CREATE INDEX IF NOT EXISTS "idx_websearch_embedding_hnsw"
ON "WebSearchCache"
USING hnsw ("embedding" vector_cosine_ops)
WITH (m = 16, ef_construction = 64);