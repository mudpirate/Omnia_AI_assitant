import "dotenv/config";
import OpenAI from "openai";

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ---------------------------------------------------------
// STEP 1: The "Searcher" (Serper.dev)
// ---------------------------------------------------------
async function searchWeb(query) {
  console.log(`🔍 Searching the web for: "${query}"...`);

  const myHeaders = new Headers();
  myHeaders.append("X-API-KEY", process.env.SERPER_API_KEY);
  myHeaders.append("Content-Type", "application/json");

  const raw = JSON.stringify({
    q: query,
    gl: "kw", // 'gl' = Kuwait (Change to 'us' or 'in' if needed)
    hl: "en", // Language English
  });

  const requestOptions = {
    method: "POST",
    headers: myHeaders,
    body: raw,
    redirect: "follow",
  };

  try {
    const response = await fetch(
      "https://google.serper.dev/search",
      requestOptions
    );
    if (!response.ok)
      throw new Error(`Serper API Error: ${response.statusText}`);

    const json = await response.json();
    return json;
  } catch (error) {
    console.error("❌ Search Failed:", error);
    return null;
  }
}

// ---------------------------------------------------------
// STEP 2: The "Synthesizer" (OpenAI)
// ---------------------------------------------------------
async function synthesizeTrendReport(serperResponse) {
  console.log("🧠 Synthesizing answer with GPT-5-nano...");

  // 1. Extract the "Ingredients" (Top 5 Snippets)
  if (!serperResponse.organic || serperResponse.organic.length === 0) {
    return "No search results found to summarize.";
  }

  const topResults = serperResponse.organic.slice(0, 5);

  const context = topResults
    .map((item) => `SOURCE: ${item.title}\nSNIPPET: ${item.snippet}`)
    .join("\n\n");

  // 2. The Chef (GPT-4o-mini)
  const completion = await openai.chat.completions.create({
    model: "gpt-5-nano",
    messages: [
      {
        role: "system",
        content:
          "You are a tech reporter. I will give you raw search snippets. Summarize them into a short, exciting paragraph about what phone is trending right now. Mention specific model names and why they are popular. Do not use bullet points.",
      },
      {
        role: "user",
        content: `SEARCH DATA:\n${context}`,
      },
    ],
    temperature: 1,
  });

  return completion.choices[0].message.content;
}

// ---------------------------------------------------------
// MAIN EXECUTION
// ---------------------------------------------------------
async function runTest() {
  // Test Query
  const query = "best laptop for gaming";

  // 1. Get Raw Data
  const rawData = await searchWeb(query);

  if (rawData) {
    console.log(
      "✅ Raw Data Received. (Showing top result title):",
      rawData.organic[0].title
    );

    // 2. Cook the Paragraph
    const finalParagraph = await synthesizeTrendReport(rawData);

    console.log("\n================ FINAL OUTPUT ================");
    console.log(finalParagraph);
    console.log("==============================================");
  }
}

runTest();
