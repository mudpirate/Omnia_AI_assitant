// usage_throttled.mjs (ESM)
// npm i axios dotenv
import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

const START_DATE = "2025-12-01";
const END_DATE = "2025-12-04";

// Rate limit settings (default 5 requests per minute like your error)
const RATE_LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN) || 5;
const MIN_INTERVAL_MS = Math.ceil(60000 / RATE_LIMIT_PER_MIN); // ms between requests

// Retry/backoff settings
const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 1000; // 1s -> will be multiplied by 2^attempt
const JITTER_MS = 300; // random jitter

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function getDates(start, end) {
  const out = [];
  let cur = new Date(start + "T00:00:00Z");
  const last = new Date(end + "T00:00:00Z");
  while (cur <= last) {
    out.push(cur.toISOString().split("T")[0]);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

async function fetchUsageForDate(date) {
  const url = `https://api.openai.com/v1/usage?date=${date}`;
  let attempt = 0;
  while (attempt <= MAX_RETRIES) {
    try {
      const res = await axios.get(url, {
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        timeout: 30_000,
      });
      return { ok: true, data: res.data };
    } catch (err) {
      const status = err.response?.status;
      const body = err.response?.data ?? err.message;

      // If rate limited (429) or OpenAI rate-limit style error, do backoff+retry
      const is429 =
        status === 429 || err.response?.data?.code === "rate_limit_exceeded";
      if (is429 && attempt < MAX_RETRIES) {
        attempt++;
        const backoff = BASE_BACKOFF_MS * 2 ** (attempt - 1);
        const jitter = Math.floor(Math.random() * JITTER_MS);
        const wait = backoff + jitter;
        console.warn(
          `429 / rate limit for ${date}. retry ${attempt}/${MAX_RETRIES} after ${wait}ms`
        );
        await sleep(wait);
        continue;
      }

      // For other errors or exhausted retries
      return { ok: false, error: body };
    }
  }
  return { ok: false, error: "exhausted retries" };
}

async function main() {
  const dates = getDates(START_DATE, END_DATE);
  console.log(
    `Querying ${dates.length} days between ${START_DATE} and ${END_DATE}`
  );
  console.log(
    `Rate limit: ${RATE_LIMIT_PER_MIN} req/min -> waiting ${MIN_INTERVAL_MS}ms between requests`
  );

  let totalInput = 0;
  let totalOutput = 0;
  let totalTokens = 0;
  const failed = [];

  for (const [i, date] of dates.entries()) {
    const startTime = Date.now();
    const res = await fetchUsageForDate(date);

    if (!res.ok) {
      console.error(`Error for ${date}:`, res.error);
      failed.push({ date, error: res.error });
    } else {
      // response shape: { data: [...] } where each element may have n_input_tokens / n_output_tokens / n_tokens
      const dayData = res.data.data ?? [];
      if (dayData.length === 0) {
        // no usage that day
      } else {
        dayData.forEach((entry) => {
          totalInput += entry.n_input_tokens ?? 0;
          totalOutput += entry.n_output_tokens ?? 0;
          totalTokens += entry.n_tokens ?? 0;
        });
      }
    }

    // Enforce inter-request delay so we don't exceed RATE_LIMIT_PER_MIN
    const elapsed = Date.now() - startTime;
    const waitFor = MIN_INTERVAL_MS - elapsed;
    if (waitFor > 0) {
      await sleep(waitFor);
    } // otherwise we proceed immediately (we might still be ok)
  }

  console.log("------ USAGE SUMMARY ------");
  console.log("From:", START_DATE);
  console.log("To:  ", END_DATE);
  console.log("Total Input Tokens: ", totalInput);
  console.log("Total Output Tokens:", totalOutput);
  console.log("Total Tokens:       ", totalTokens);
  if (failed.length) {
    console.warn("Failed days:", failed);
  } else {
    console.log("All days fetched successfully.");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
});
