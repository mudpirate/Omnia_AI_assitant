#!/usr/bin/env node

/**
 * Admitad CSV Analyzer
 * Downloads and analyzes product CSV from Admitad export
 */

import https from "https";
import http from "http";
import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";

// Admitad export URL - Feed ID: 25779
const URL =
  "http://export.admitad.com/en/webmaster/websites/2896510/products/export_adv_products/?user=mishaal_alotaibi2ae7a&code=mx60od1chh&feed_id=25779&format=csv";

/**
 * Download CSV file from URL
 */
function downloadCSV(url) {
  return new Promise((resolve, reject) => {
    console.log("📥 Downloading CSV file...");

    const client = url.startsWith("https") ? https : http;
    const filepath = path.join(process.cwd(), "admitad_products_25779.csv");
    const file = fs.createWriteStream(filepath);

    client
      .get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download: ${response.statusCode}`));
          return;
        }

        response.pipe(file);

        file.on("finish", () => {
          file.close();
          console.log("✅ CSV downloaded successfully\n");
          resolve(filepath);
        });
      })
      .on("error", (err) => {
        fs.unlink(filepath, () => {}); // Delete incomplete file
        reject(err);
      });
  });
}

/**
 * Detect CSV delimiter
 */
function detectDelimiter(csvContent) {
  const delimiters = [",", ";", "\t", "|"];
  const sample = csvContent.split("\n")[0];

  let bestDelimiter = ",";
  let maxFields = 0;

  for (const delimiter of delimiters) {
    const fields = sample.split(delimiter).length;
    if (fields > maxFields) {
      maxFields = fields;
      bestDelimiter = delimiter;
    }
  }

  return bestDelimiter;
}

/**
 * Analyze CSV file and print summary
 */
async function analyzeCSV(filepath) {
  console.log("=".repeat(80));
  console.log("ADMITAD CSV ANALYSIS - FEED ID: 25779");
  console.log("=".repeat(80));

  try {
    // Read file
    const csvContent = fs.readFileSync(filepath, "utf-8");

    // Detect delimiter
    const delimiter = detectDelimiter(csvContent);
    console.log(
      `\n🔍 Detected delimiter: "${delimiter === "\t" ? "\\t" : delimiter}"\n`
    );

    // Parse CSV
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      delimiter: delimiter,
      trim: true,
      relax_quotes: true,
      relax_column_count: true,
    });

    // Get field names
    const fieldNames = Object.keys(records[0] || {});

    console.log(`📊 TOTAL FIELDS: ${fieldNames.length}`);
    console.log("\n📋 FIELD NAMES:");
    console.log("-".repeat(80));
    fieldNames.forEach((field, index) => {
      console.log(`${String(index + 1).padStart(3)}. ${field}`);
    });

    console.log(`\n📦 TOTAL PRODUCTS: ${records.length.toLocaleString()}`);

    // Show sample products
    console.log("\n" + "=".repeat(80));
    console.log("SAMPLE PRODUCTS");
    console.log("=".repeat(80));

    const samplesToShow = Math.min(2, records.length);

    for (let i = 0; i < samplesToShow; i++) {
      console.log(`\n🔸 PRODUCT ${i + 1}:`);
      console.log("-".repeat(80));

      const product = records[i];

      // Print each field
      fieldNames.forEach((field) => {
        const value = product[field] || "";
        const displayValue =
          value.length > 100 ? value.substring(0, 100) + "..." : value;
        console.log(`${field.padEnd(30)}: ${displayValue}`);
      });
    }

    // Additional statistics
    console.log("\n" + "=".repeat(80));
    console.log("STATISTICS");
    console.log("=".repeat(80));

    // Count non-empty fields per product
    const fieldCounts = {};
    fieldNames.forEach((field) => {
      const nonEmpty = records.filter(
        (r) => r[field] && r[field].trim() !== ""
      ).length;
      fieldCounts[field] = nonEmpty;
    });

    console.log("\n📈 Field Population (fields with most data):");
    console.log("-".repeat(80));

    const sortedFields = Object.entries(fieldCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    sortedFields.forEach(([field, count]) => {
      const percentage = ((count / records.length) * 100).toFixed(1);
      console.log(
        `${field.padEnd(30)}: ${count
          .toLocaleString()
          .padStart(8)} (${percentage}%)`
      );
    });

    console.log("\n" + "=".repeat(80));
    console.log(`✅ Analysis complete! CSV saved at: ${filepath}`);
    console.log("=".repeat(80));
  } catch (error) {
    console.error("❌ Error analyzing CSV:", error.message);
    process.exit(1);
  }
}

/**
 * Main function
 */
async function main() {
  try {
    const filepath = await downloadCSV(URL);
    await analyzeCSV(filepath);
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

// Run the script
main();
