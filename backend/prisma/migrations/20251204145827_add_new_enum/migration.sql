/*
  Warnings:

  - You are about to drop the `SearchCache` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterEnum
ALTER TYPE "StoreName" ADD VALUE 'EUREKA';

-- DropTable
DROP TABLE "SearchCache";

-- CreateTable
CREATE TABLE "WebSearchCache" (
    "id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "embedding" vector(1536) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebSearchCache_pkey" PRIMARY KEY ("id")
);
