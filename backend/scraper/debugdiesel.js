import fetch from "node-fetch";
import { parse } from "csv-parse/sync";

const CSV_URL =
  "http://export.admitad.com/en/webmaster/websites/2896510/products/export_adv_products/?user=mishaal_alotaibi2ae7a&code=mx60od1chh&feed_id=21862&format=csv";

async function getProductURLs() {
  console.log(`\n🔗 Fetching Product URLs from Diesel CSV...\n`);

  try {
    const response = await fetch(CSV_URL, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    const csvText = await response.text();
    const records = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      bom: true,
      delimiter: ";", // Diesel CSV uses semicolon
    });

    console.log(`✅ Found ${records.length} products\n`);
    console.log(`${"=".repeat(80)}`);
    console.log(`📋 FIRST 5 PRODUCT URLs:`);
    console.log(`${"=".repeat(80)}\n`);

    for (let i = 0; i < Math.min(5, records.length); i++) {
      const product = records[i];
      const name = product.name || `Product ${i + 1}`;
      const url = product.url || "";
      const price = product.price || "N/A";

      console.log(`${i + 1}. ${name}`);
      console.log(`   Price: ${price} KWD`);
      console.log(`   Affiliate URL: ${url.substring(0, 100)}...`);

      // Extract clean Diesel URL
      if (url.includes("ulp=")) {
        try {
          const ulpMatch = url.match(/ulp=([^&]+)/);
          if (ulpMatch) {
            let cleanUrl = decodeURIComponent(ulpMatch[1]);
            if (cleanUrl.includes("%")) {
              cleanUrl = decodeURIComponent(cleanUrl);
            }
            const finalUrl = cleanUrl.split("?")[0];
            console.log(`   ✅ Clean Diesel URL: ${finalUrl}`);
          }
        } catch (e) {
          console.log(`   ⚠️ Could not decode URL`);
        }
      } else {
        console.log(`   Direct URL: ${url}`);
      }
      console.log("");
    }

    console.log(`${"=".repeat(80)}`);
    console.log(
      `\n💡 You can copy any of the Clean Diesel URLs above to check the products!\n`
    );
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
  }
}

getProductURLs()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Failed:", error);
    process.exit(1);
  });
