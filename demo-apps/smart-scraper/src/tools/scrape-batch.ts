import { scrapeUrl } from "./scrape-url.js";
import type { BatchResult } from "../types.js";

const MAX_BATCH_SIZE = 10;

export async function scrapeBatch(urls: string[]): Promise<BatchResult> {
  if (urls.length > MAX_BATCH_SIZE) {
    throw new Error(`Batch size exceeds maximum of ${MAX_BATCH_SIZE} URLs`);
  }

  const results = await Promise.allSettled(urls.map((url) => scrapeUrl(url)));

  return {
    total: urls.length,
    successful: results.filter((r) => r.status === "fulfilled").length,
    failed: results.filter((r) => r.status === "rejected").length,
    results: results.map((r, i) => ({
      url: urls[i] ?? "",
      status: r.status,
      data: r.status === "fulfilled" ? r.value : null,
      error: r.status === "rejected" ? String(r.reason) : null,
    })),
  };
}
