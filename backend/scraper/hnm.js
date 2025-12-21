import puppeteer from "puppeteer";

const BASE_URL = "https://kw.hm.com";
const TARGET_URL =
  "https://kw.hm.com/en/shop-men/new-arrivals/--clothing_style-baggy";

(async () => {
  console.log("🚀 Starting H&M Kuwait Scraper...");

  const browser = await puppeteer.launch({
    headless: "new",
    defaultViewport: null,
    args: ["--start-maximized"],
  });

  const page = await browser.newPage();

  // Optimize: Block media to speed up loading
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    if (["image", "font", "stylesheet", "media"].includes(req.resourceType())) {
      req.abort();
    } else {
      req.continue();
    }
  });

  try {
    console.log(`📡 Navigating to listing: ${TARGET_URL}`);
    await page.goto(TARGET_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForSelector(".product-item");

    // --- STEP 1: Scrape Listing ---
    const products = await page.evaluate(() => {
      const items = document.querySelectorAll(".product-item");
      const results = [];

      items.forEach((el) => {
        const linkEl = el.querySelector(".product-item-link");
        const titleEl = el.querySelector(".product-item-title h6");
        const priceEl = el.querySelector(".item-price");
        const imgEl = el.querySelector(".item-images img");

        if (linkEl) {
          results.push({
            id: el.getAttribute("data-id"),
            title: titleEl ? titleEl.innerText.trim() : "Unknown",
            price: priceEl ? priceEl.innerText.trim() : null,
            thumbUrl: imgEl ? imgEl.src : null,
            url: linkEl.getAttribute("href"),
          });
        }
      });
      return results;
    });

    console.log(
      `✅ Found ${products.length} products. Starting details scrape...`
    );

    // --- STEP 2: Visit Product Pages ---
    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      const fullUrl = `${BASE_URL}${product.url}`;

      console.log(`\n--------------------------------------------------`);
      console.log(`Processing [${i + 1}/${products.length}]: ${product.title}`);

      try {
        await page.goto(fullUrl, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });

        // CRITICAL FIX: Wait specifically for the content div, not just the container
        // We use .catch() so one failure doesn't stop the whole script
        await page
          .waitForSelector(".pdp-product__description--content", {
            timeout: 5000,
          })
          .catch(() => {});

        const detailedInfo = await page.evaluate(() => {
          const data = {};

          // 1. Description - Use textContent (reads hidden text) instead of innerText
          const descEl = document.querySelector(
            ".pdp-product__description--content"
          );
          data.description = descEl
            ? descEl.textContent.trim()
            : "Description not found";

          // 2. Color - Use textContent
          const colorEl = document.querySelector(".pdp-swatches__title");
          data.color = colorEl
            ? colorEl.textContent.replace(/COLOR:\s*/i, "").trim()
            : null;

          // 3. Attributes - Revised Selector Logic
          data.attributes = {};
          // Find the UL container first
          const attrList = document.querySelector(
            ".pdp-product-description__attributes ul, .pdp-product-description__attribute"
          );

          if (attrList) {
            const listItems = attrList.querySelectorAll("li");
            listItems.forEach((li) => {
              // Based on your HTML: div class="...--label" and a span sibling
              const labelNode = li.querySelector('div[class*="--label"]');
              const valueNode = li.querySelector("span");

              if (labelNode && valueNode) {
                const key = labelNode.textContent.trim();
                const val = valueNode.textContent.trim();
                if (key) data.attributes[key] = val;
              }
            });
          }

          // 4. Gallery Images
          const images = document.querySelectorAll(
            ".pdp-gallery-grid__item img"
          );
          data.gallery = Array.from(images)
            .map((img) => img.src) // Puppeteer resolves absolute URLs automatically
            .filter((src) => src && src.includes("http")); // basic validation

          return data;
        });

        // Merge and Log
        const finalData = {
          ...product,
          url: fullUrl,
          ...detailedInfo,
        };

        console.log(JSON.stringify(finalData, null, 2));
      } catch (err) {
        console.error(`❌ Failed to scrape ${fullUrl}: ${err.message}`);
      }

      // Short random pause to be polite
      await new Promise((r) => setTimeout(r, Math.random() * 1500 + 500));
    }
  } catch (e) {
    console.error("❌ Fatal Error:", e);
  } finally {
    await browser.close();
  }
})();
