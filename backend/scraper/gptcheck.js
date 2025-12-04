import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function askLLM(query) {
  try {
    const response = await client.chat.completions.create({
      model: "gpt-4.1-nano",
      messages: [
        {
          role: "system",
          content:
            "You are a Kuwait-focused electronics trends researcher. ONLY provide news, trends, product launches, market insights, and events strictly from the year 2025. Do NOT mention or use info from 2024 or earlier. Use only 2025 context.",
        },
        { role: "user", content: query },
      ],
      max_completion_tokens: 100,
      temperature: 1,
    });

    console.log("📡 Kuwait Electronics Research Report (2025):\n");
    console.log(response.choices[0].message.content);
  } catch (error) {
    console.error("❌ Error:", error);
  }
}

// Run with argument
const userQuery = process.argv.slice(2).join(" ");

if (!userQuery) {
  console.log(
    '❌ Please provide a query.\nExample: node llm.js "What electronics are trending in Kuwait in 2025?"'
  );
  process.exit(1);
}

askLLM(userQuery);
