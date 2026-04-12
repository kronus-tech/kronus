import { scrapeUrl } from "./scrape-url.js";

// Selector keys the caller can map to scraped fields
const BUILTIN_SELECTORS: Record<string, (scraped: Awaited<ReturnType<typeof scrapeUrl>>) => unknown> = {
  title: (s) => s.title,
  description: (s) => s.description,
  text: (s) => s.text_content,
  headings: (s) => s.headings,
  links: (s) => s.links,
  url: (s) => s.url,
  status: (s) => s.meta.status,
  content_type: (s) => s.meta.content_type,
};

export async function extractData(
  url: string,
  schema: Record<string, string>
): Promise<Record<string, unknown>> {
  const scraped = await scrapeUrl(url);
  const result: Record<string, unknown> = {};

  for (const [key, selector] of Object.entries(schema)) {
    const extractor = BUILTIN_SELECTORS[selector];
    if (extractor !== undefined) {
      result[key] = extractor(scraped);
    } else {
      // Full CSS selector extraction deferred to a future release
      result[key] = null;
    }
  }

  return result;
}
