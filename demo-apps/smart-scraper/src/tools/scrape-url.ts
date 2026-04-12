import * as cheerio from "cheerio";
import type { ScrapeResult } from "../types.js";

const MAX_TEXT_LENGTH = 5000;
const MAX_LINKS = 50;

export async function scrapeUrl(url: string): Promise<ScrapeResult> {
  const response = await fetch(url, {
    headers: { "User-Agent": "KronusScraper/0.1" },
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  const headings: string[] = [];
  $("h1, h2, h3").each((_idx, el) => {
    const text = $(el).text().trim();
    if (text.length > 0) {
      headings.push(text);
    }
  });

  const links: Array<{ text: string; href: string }> = [];
  $("a[href]").each((_idx, el) => {
    links.push({
      text: $(el).text().trim(),
      href: $(el).attr("href") ?? "",
    });
  });

  return {
    url,
    title: $("title").text().trim(),
    description: $('meta[name="description"]').attr("content") ?? null,
    headings,
    links: links.slice(0, MAX_LINKS),
    text_content: $("body")
      .text()
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_TEXT_LENGTH),
    meta: {
      content_type: response.headers.get("Content-Type"),
      status: response.status,
    },
  };
}
