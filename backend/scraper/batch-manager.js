import OpenAI from "openai";
import fs from "fs/promises";
import path from "path";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- BATCH MANAGEMENT COMMANDS ---

async function listBatches(limit = 20) {
  console.log(`\n📋 Listing last ${limit} batches...\n`);

  const batches = await openai.batches.list({ limit });

  if (batches.data.length === 0) {
    console.log("No batches found.");
    return;
  }

  for (const batch of batches.data) {
    const createdAt = new Date(batch.created_at * 1000).toLocaleString();
    const completedAt = batch.completed_at
      ? new Date(batch.completed_at * 1000).toLocaleString()
      : "N/A";

    console.log(`─────────────────────────────────────────`);
    console.log(`Batch ID: ${batch.id}`);
    console.log(`Status: ${batch.status}`);
    console.log(`Description: ${batch.metadata?.description || "N/A"}`);
    console.log(`Created: ${createdAt}`);
    console.log(`Completed: ${completedAt}`);

    if (batch.request_counts) {
      const { total, completed, failed } = batch.request_counts;
      const progress = total > 0 ? ((completed / total) * 100).toFixed(1) : 0;
      console.log(
        `Progress: ${completed}/${total} (${progress}%) | Failed: ${failed}`
      );
    }

    if (batch.errors?.data?.length > 0) {
      console.log(`Errors: ${batch.errors.data[0].message}`);
    }
  }

  console.log(`─────────────────────────────────────────\n`);
}

async function getBatchStatus(batchId) {
  console.log(`\n🔍 Checking status for batch: ${batchId}\n`);

  const batch = await openai.batches.retrieve(batchId);

  const createdAt = new Date(batch.created_at * 1000).toLocaleString();
  const completedAt = batch.completed_at
    ? new Date(batch.completed_at * 1000).toLocaleString()
    : "N/A";

  console.log(`Status: ${batch.status}`);
  console.log(`Description: ${batch.metadata?.description || "N/A"}`);
  console.log(`Created: ${createdAt}`);
  console.log(`Completed: ${completedAt}`);

  if (batch.request_counts) {
    const { total, completed, failed } = batch.request_counts;
    const progress = total > 0 ? ((completed / total) * 100).toFixed(1) : 0;
    console.log(`\nProgress:`);
    console.log(`  Total: ${total}`);
    console.log(`  Completed: ${completed} (${progress}%)`);
    console.log(`  Failed: ${failed}`);
  }

  if (batch.errors?.data?.length > 0) {
    console.log(`\nErrors:`);
    batch.errors.data.forEach((error, i) => {
      console.log(`  ${i + 1}. ${error.message}`);
    });
  }

  console.log(`\nInput File: ${batch.input_file_id}`);
  if (batch.output_file_id) {
    console.log(`Output File: ${batch.output_file_id}`);
  }
  if (batch.error_file_id) {
    console.log(`Error File: ${batch.error_file_id}`);
  }

  console.log();
}

async function cancelBatch(batchId) {
  console.log(`\n🛑 Cancelling batch: ${batchId}...\n`);

  const batch = await openai.batches.cancel(batchId);

  console.log(`✓ Batch ${batch.id} cancelled`);
  console.log(`  Status: ${batch.status}\n`);
}

async function downloadBatchOutput(batchId, outputDir = "./batch_files") {
  console.log(`\n📥 Downloading output for batch: ${batchId}...\n`);

  const batch = await openai.batches.retrieve(batchId);

  if (batch.status !== "completed") {
    console.log(`⚠️ Batch is not completed yet. Status: ${batch.status}`);
    return;
  }

  if (!batch.output_file_id) {
    console.log(`⚠️ No output file available for this batch.`);
    return;
  }

  // Create output directory
  await fs.mkdir(outputDir, { recursive: true });

  // Download output file
  const fileResponse = await openai.files.content(batch.output_file_id);
  const fileContents = await fileResponse.text();

  const outputPath = path.join(
    outputDir,
    `output_${batchId}_${Date.now()}.jsonl`
  );
  await fs.writeFile(outputPath, fileContents);

  console.log(`✓ Output saved to: ${outputPath}`);

  // Parse and show summary
  const results = fileContents
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

  console.log(`\nSummary:`);
  console.log(`  Total results: ${results.length}`);

  const successful = results.filter(
    (r) => r.response.status_code === 200
  ).length;
  const failed = results.length - successful;

  console.log(`  Successful: ${successful}`);
  console.log(`  Failed: ${failed}`);

  // Download error file if exists
  if (batch.error_file_id) {
    const errorResponse = await openai.files.content(batch.error_file_id);
    const errorContents = await errorResponse.text();

    const errorPath = path.join(
      outputDir,
      `errors_${batchId}_${Date.now()}.jsonl`
    );
    await fs.writeFile(errorPath, errorContents);

    console.log(`  Error file saved to: ${errorPath}`);
  }

  console.log();
}

async function listFiles(purpose = "batch") {
  console.log(`\n📁 Listing files with purpose: ${purpose}...\n`);

  const files = await openai.files.list({ purpose });

  if (files.data.length === 0) {
    console.log("No files found.");
    return;
  }

  for (const file of files.data) {
    const createdAt = new Date(file.created_at * 1000).toLocaleString();
    const sizeKB = (file.bytes / 1024).toFixed(2);

    console.log(`─────────────────────────────────────────`);
    console.log(`File ID: ${file.id}`);
    console.log(`Filename: ${file.filename}`);
    console.log(`Purpose: ${file.purpose}`);
    console.log(`Size: ${sizeKB} KB`);
    console.log(`Created: ${createdAt}`);
  }

  console.log(`─────────────────────────────────────────\n`);
}

async function deleteFile(fileId) {
  console.log(`\n🗑️  Deleting file: ${fileId}...\n`);

  const result = await openai.files.del(fileId);

  if (result.deleted) {
    console.log(`✓ File ${fileId} deleted successfully\n`);
  } else {
    console.log(`⚠️ Failed to delete file ${fileId}\n`);
  }
}

// --- COST CALCULATOR ---

async function calculateBatchCost(batchId) {
  console.log(`\n💰 Calculating cost for batch: ${batchId}...\n`);

  const batch = await openai.batches.retrieve(batchId);

  if (!batch.output_file_id) {
    console.log(`⚠️ Batch has no output yet. Status: ${batch.status}`);
    return;
  }

  const fileResponse = await openai.files.content(batch.output_file_id);
  const fileContents = await fileResponse.text();
  const results = fileContents
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (const result of results) {
    if (result.response.status_code === 200) {
      const usage = result.response.body.usage;
      totalInputTokens += usage.prompt_tokens || 0;
      totalOutputTokens += usage.completion_tokens || 0;
    }
  }

  // GPT-4o-mini batch pricing (50% discount)
  const inputCostPer1M = 0.075; // $0.075 per 1M tokens (batch)
  const outputCostPer1M = 0.3; // $0.30 per 1M tokens (batch)

  const inputCost = (totalInputTokens / 1_000_000) * inputCostPer1M;
  const outputCost = (totalOutputTokens / 1_000_000) * outputCostPer1M;
  const totalCost = inputCost + outputCost;

  // Real-time API cost comparison
  const realtimeInputCostPer1M = 0.15;
  const realtimeOutputCostPer1M = 0.6;

  const realtimeInputCost =
    (totalInputTokens / 1_000_000) * realtimeInputCostPer1M;
  const realtimeOutputCost =
    (totalOutputTokens / 1_000_000) * realtimeOutputCostPer1M;
  const realtimeTotalCost = realtimeInputCost + realtimeOutputCost;

  const savings = realtimeTotalCost - totalCost;
  const savingsPercent = ((savings / realtimeTotalCost) * 100).toFixed(1);

  console.log(`Token Usage:`);
  console.log(`  Input tokens: ${totalInputTokens.toLocaleString()}`);
  console.log(`  Output tokens: ${totalOutputTokens.toLocaleString()}`);
  console.log(
    `  Total tokens: ${(totalInputTokens + totalOutputTokens).toLocaleString()}`
  );

  console.log(`\nBatch API Cost (50% discount):`);
  console.log(`  Input cost: $${inputCost.toFixed(4)}`);
  console.log(`  Output cost: $${outputCost.toFixed(4)}`);
  console.log(`  Total cost: $${totalCost.toFixed(4)}`);

  console.log(`\nReal-time API Cost (for comparison):`);
  console.log(`  Total cost: $${realtimeTotalCost.toFixed(4)}`);

  console.log(`\n💰 Savings:`);
  console.log(`  Amount saved: $${savings.toFixed(4)}`);
  console.log(`  Percentage: ${savingsPercent}%`);

  console.log();
}

// --- CLI INTERFACE ---

const command = process.argv[2];
const arg = process.argv[3];

async function main() {
  try {
    switch (command) {
      case "list":
        await listBatches(parseInt(arg) || 20);
        break;

      case "status":
        if (!arg) {
          console.log("❌ Please provide a batch ID");
          console.log("Usage: node batch-manager.js status <batch_id>");
          process.exit(1);
        }
        await getBatchStatus(arg);
        break;

      case "cancel":
        if (!arg) {
          console.log("❌ Please provide a batch ID");
          console.log("Usage: node batch-manager.js cancel <batch_id>");
          process.exit(1);
        }
        await cancelBatch(arg);
        break;

      case "download":
        if (!arg) {
          console.log("❌ Please provide a batch ID");
          console.log("Usage: node batch-manager.js download <batch_id>");
          process.exit(1);
        }
        await downloadBatchOutput(arg);
        break;

      case "cost":
        if (!arg) {
          console.log("❌ Please provide a batch ID");
          console.log("Usage: node batch-manager.js cost <batch_id>");
          process.exit(1);
        }
        await calculateBatchCost(arg);
        break;

      case "files":
        await listFiles(arg || "batch");
        break;

      case "delete-file":
        if (!arg) {
          console.log("❌ Please provide a file ID");
          console.log("Usage: node batch-manager.js delete-file <file_id>");
          process.exit(1);
        }
        await deleteFile(arg);
        break;

      default:
        console.log(`
🤖 OpenAI Batch Manager for Omnia AI Scraper

Commands:
  list [limit]           List recent batches (default: 20)
  status <batch_id>      Check status of a specific batch
  cancel <batch_id>      Cancel a running batch
  download <batch_id>    Download batch results
  cost <batch_id>        Calculate actual cost and savings
  files [purpose]        List uploaded files (default: batch)
  delete-file <file_id>  Delete a file

Examples:
  node batch-manager.js list
  node batch-manager.js status batch_abc123
  node batch-manager.js download batch_abc123
  node batch-manager.js cost batch_abc123
  node batch-manager.js files
        `);
    }
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}\n`);
    process.exit(1);
  }
}

main();
