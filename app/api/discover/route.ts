import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const PRIVATE_HOST = /^(localhost|127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?)/i;
const ASSET_PATH = /\.(?:avif|css|gif|ico|jpe?g|js|json|mp3|mp4|pdf|png|svg|webp|woff2?|xml)(?:$|\?)/i;

function publicUrl(input: string) {
  const value = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || PRIVATE_HOST.test(url.hostname) || url.hostname.endsWith(".local")) {
    throw new Error("Enter a public website or sitemap URL.");
  }
  return url;
}

function locs(xml: string) {
  return [...xml.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc>/gi)]
    .map((match) => match[1].replace(/&amp;/g, "&").trim())
    .filter(Boolean);
}

async function read(url: string) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: { "user-agent": "SearchOps-Audit-Brain/1.0" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Could not read ${url}`);
  return (await response.text()).slice(0, 5_000_000);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { site?: string; max?: number };
    const requested = publicUrl(body.site?.trim() ?? "");
    const origin = requested.origin;
    const max = Math.min(Math.max(Number(body.max) || 50, 1), 200);
    const queue: string[] = [];
    const found = new Set<string>();
    const seen = new Set<string>();
    const notes: string[] = [];

    if (/\.xml(?:$|\?)/i.test(requested.pathname)) {
      queue.push(requested.toString());
    } else {
      try {
        const robots = await read(`${origin}/robots.txt`);
        for (const match of robots.matchAll(/^\s*sitemap:\s*(\S+)/gim)) queue.push(match[1]);
      } catch {
        notes.push("robots.txt did not provide a sitemap.");
      }
      queue.push(`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`, `${origin}/sitemap-index.xml`);
    }

    while (queue.length && seen.size < 30 && found.size < max) {
      const sitemap = queue.shift()!;
      if (seen.has(sitemap)) continue;
      seen.add(sitemap);
      try {
        const xml = await read(sitemap);
        const entries = locs(xml);
        if (/<sitemapindex\b/i.test(xml)) {
          for (const entry of entries) if (!seen.has(entry)) queue.push(entry);
        } else {
          for (const entry of entries) {
            try {
              const page = new URL(entry);
              if (page.origin === origin && !ASSET_PATH.test(page.pathname)) found.add(page.toString());
              if (found.size >= max) break;
            } catch {
              // Ignore malformed sitemap entries.
            }
          }
        }
      } catch {
        // Try the next declared/common sitemap.
      }
    }

    let source = "sitemap";
    if (!found.size) {
      source = "homepage";
      const html = await read(origin);
      for (const match of html.matchAll(/<a\b[^>]+href=["']([^"'#]+)["']/gi)) {
        try {
          const page = new URL(match[1], origin);
          if (page.origin === origin && !ASSET_PATH.test(page.pathname)) found.add(page.toString());
          if (found.size >= max) break;
        } catch {
          // Ignore malformed links.
        }
      }
      notes.push("No readable sitemap was found, so links were collected from the homepage.");
    }

    return NextResponse.json({
      urls: [...found].slice(0, max),
      source,
      capped: found.size >= max,
      notes,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Pages could not be discovered." },
      { status: 400 },
    );
  }
}
