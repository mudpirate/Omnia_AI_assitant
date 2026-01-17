import fetch from "node-fetch";
import dotenv from "dotenv";
import fs from "fs";
dotenv.config();

// Load a test image
const testImage = fs.readFileSync("./test_image.jpg").toString("base64");

console.log("Testing RunPod endpoint...");
console.log("URL:", process.env.RUNPOD_API_URL);

try {
  const response = await fetch(process.env.RUNPOD_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.RUNPOD_API_KEY}`,
    },
    body: JSON.stringify({
      input: {
        images: [
          {
            data: testImage,
            id: "test_1",
          },
        ],
      },
    }),
  });

  console.log("Status:", response.status);
  console.log("Headers:", Object.fromEntries(response.headers.entries()));

  const text = await response.text();
  console.log("Raw Response:", text);

  try {
    const json = JSON.parse(text);
    console.log("Parsed JSON:", JSON.stringify(json, null, 2));
  } catch (e) {
    console.log("Failed to parse JSON:", e.message);
  }
} catch (error) {
  console.error("Request failed:", error.message);
}
