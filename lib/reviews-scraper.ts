import { getEnvValue } from "@/lib/env";
import { getMongoDb } from "@/lib/mongo";

type JobStatus = "pending" | "processing" | "completed" | "error";
type SentimentLabel = "positive" | "neutral" | "negative";

export type ReviewRecord = {
  source: "producthunt";
  userId: string;
  competitorKey: string;
  competitorName: string;
  sourceUrl: string;
  pageUrl: string;
  content: string;
  reviewerHandle: string | null;
  sentimentLabel: SentimentLabel;
  sentimentScore: number;
  scrapedAt: string;
  contentHash: string;
};

export type ReviewsScrapeJob = {
  id: string;
  userId: string;
  status: JobStatus;
  progressMessage: string;
  createdAt: string;
  updatedAt: string;
  sourceUrls: string[];
  competitorsScraped: number;
  pagesScraped: number;
  reviewsExtracted: number;
  insertedCount: number;
  updatedCount: number;
  error?: string;
};

const jobs = new Map<string, ReviewsScrapeJob>();

function nowIso() {
  return new Date().toISOString();
}

function toJobId() {
  return `reviews_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizePageUrl(url: string) {
  const u = new URL(url);
  const page = Number(u.searchParams.get("page") ?? "1") || 1;
  u.searchParams.set("filter", "all");
  u.searchParams.set("feed", "single");
  u.searchParams.set("page", String(page));
  return u.toString();
}

function competitorFromUrl(url: string) {
  const match = url.match(/\/products\/([^/]+)\/reviews/i);
  const key = (match?.[1] ?? "unknown").toLowerCase();
  const name = key
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

  return { competitorKey: key, competitorName: name };
}

async function scrapeMarkdownWithAnakin(url: string, apiKey: string): Promise<string> {
  const submit = await fetch("https://api.anakin.io/v1/url-scraper", {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url, useBrowser: true }),
  });

  const submitBody = await submit.json().catch(() => null);
  if (!submit.ok || !submitBody?.jobId) {
    throw new Error(`Submit failed for ${url}: ${JSON.stringify(submitBody)}`);
  }

  const maxPolls = 180;
  for (let i = 0; i < maxPolls; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const statusRes = await fetch(`https://api.anakin.io/v1/url-scraper/${submitBody.jobId}`, {
      headers: { "X-API-Key": apiKey },
    });
    const body = await statusRes.json().catch(() => null);

    if (body?.status === "completed") {
      return String(body?.markdown ?? "");
    }

    if (body?.status && body.status !== "processing" && body.status !== "pending") {
      throw new Error(`Scrape failed for ${url}: ${body.status}`);
    }
  }

  throw new Error(`Scrape timeout for ${url}`);
}

async function scrapeMarkdownWithRetry(url: string, apiKey: string): Promise<string> {
  const attempts = 3;
  let lastError: unknown;

  for (let i = 0; i < attempts; i += 1) {
    try {
      return await scrapeMarkdownWithAnakin(url, apiKey);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1500 * (i + 1)));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function discoverPageUrls(markdown: string, seedUrl: string): string[] {
  const urls = new Set<string>([normalizePageUrl(seedUrl)]);
  const match = seedUrl.match(/\/products\/([^/]+)\/reviews/i);
  const productSlug = match?.[1] ?? "jira";
  const pattern = new RegExp(`https://www\\.producthunt\\.com/products/${productSlug}/reviews\\?[^\\s)]+`, "g");

  for (const m of markdown.matchAll(pattern)) {
    try {
      urls.add(normalizePageUrl(m[0]));
    } catch {
      // ignore invalid url
    }
  }

  return [...urls].sort((a, b) => {
    const pa = Number(new URL(a).searchParams.get("page") ?? "1");
    const pb = Number(new URL(b).searchParams.get("page") ?? "1");
    return pa - pb;
  });
}

function extractReviewBlocks(markdown: string): string[] {
  const sectionStart = markdown.indexOf("\nReviews\n");
  const source = sectionStart >= 0 ? markdown.slice(sectionStart) : markdown;
  const lines = source.split("\n");

  const blocks: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    const isReviewerAvatar = /^!\[[^\]]+\]\(https:\/\/ph-avatars\.imgix\.net\//.test(line.trim());
    if (isReviewerAvatar) {
      if (current.length > 0) {
        const block = current.join("\n").trim();
        if (block) blocks.push(block);
      }
      current = [line];
      continue;
    }

    if (current.length > 0) current.push(line);
  }

  if (current.length > 0) {
    const block = current.join("\n").trim();
    if (block) blocks.push(block);
  }

  return blocks
    .map((block) => block.split("\n[1](https://www.producthunt.com/products/")[0].trim())
    .filter((block) => /\[.*\]\(https:\/\/www\.producthunt\.com\/@/.test(block));
}

function inferReviewerHandle(block: string) {
  const match = block.match(/\(https:\/\/www\.producthunt\.com\/@([^\)]+)\)/);
  return match?.[1] ?? null;
}

function cleanReviewContent(block: string) {
  const lines = block
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const cleanedLines: string[] = [];
  let skipHeader = true;

  for (const line of lines) {
    // Drop avatar/media markdown and Product Hunt profile/product links.
    if (/^!\[[^\]]*\]\([^)]+\)$/.test(line)) continue;
    if (/^\[[^\]]+\]\(https:\/\/www\.producthunt\.com\/@[^)]+\)/i.test(line)) continue;
    if (/^\[[^\]]+\]\(https:\/\/www\.producthunt\.com\/products\/[^)]+\)/i.test(line)) continue;

    // Drop obvious UI/meta noise.
    if (/^Helpful(\s*\(\d+\))?$/i.test(line)) continue;
    if (/^Share$/i.test(line)) continue;
    if (/^Report$/i.test(line)) continue;
    if (/^\d+\s+views/i.test(line)) continue;
    if (/^\d+(mo|yr|d|h)\s+ago$/i.test(line)) continue;
    if (/^Ratings$/i.test(line)) continue;
    if (/^(Ease of use|Reliability|Value for money|Customization)$/i.test(line)) continue;

    // Section headings are useful, keep normalized.
    if (/^###\s*What's great/i.test(line)) {
      cleanedLines.push("What's great:");
      skipHeader = false;
      continue;
    }
    if (/^###\s*What needs improvement/i.test(line)) {
      cleanedLines.push("What needs improvement:");
      skipHeader = false;
      continue;
    }
    if (/^###\s*vs Alternatives/i.test(line)) {
      cleanedLines.push("Vs alternatives:");
      skipHeader = false;
      continue;
    }

    // Skip top profile/header rows before review body starts.
    if (
      skipHeader &&
      (/•\s*\[\d+\s+reviews?\]/i.test(line) ||
        /\[[^\]]+\]\(https:\/\/www\.producthunt\.com\/@[^)]+\)/i.test(line))
    ) {
      continue;
    }

    skipHeader = false;
    cleanedLines.push(line);
  }

  const text = cleanedLines.join("\n")
    // Convert markdown links to text.
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1")
    // Drop any remaining URLs.
    .replace(/https?:\/\/\S+/g, " ")
    // Collapse duplicated spaces.
    .replace(/[ \t]+/g, " ")
    // Remove repeated punctuation artifacts.
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();

  return text;
}

function hashText(text: string) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return `h${Math.abs(hash)}`;
}

function scoreSentiment(text: string) {
  const positiveWords = ["great", "amazing", "love", "excellent", "fast", "useful", "powerful", "good", "helpful", "best"];
  const negativeWords = ["bad", "slow", "bug", "bugs", "issue", "issues", "problem", "hate", "poor", "expensive"];
  const lower = text.toLowerCase();

  let score = 0;
  for (const word of positiveWords) {
    if (lower.includes(word)) score += 1;
  }
  for (const word of negativeWords) {
    if (lower.includes(word)) score -= 1;
  }

  if (score > 0) return { sentimentLabel: "positive" as const, sentimentScore: score };
  if (score < 0) return { sentimentLabel: "negative" as const, sentimentScore: score };
  return { sentimentLabel: "neutral" as const, sentimentScore: 0 };
}

async function saveReviews(records: ReviewRecord[]) {
  const db = await getMongoDb();
  const collection = db.collection<ReviewRecord>("producthunt_reviews");

  if (!records.length) return { insertedCount: 0, updatedCount: 0 };

  let insertedCount = 0;
  let updatedCount = 0;

  for (const record of records) {
    const result = await collection.updateOne(
      { source: record.source, userId: record.userId, competitorKey: record.competitorKey, contentHash: record.contentHash },
      { $set: record },
      { upsert: true },
    );

    if (result.upsertedCount > 0) insertedCount += 1;
    if (result.matchedCount > 0 && result.modifiedCount > 0) updatedCount += 1;
  }

  return { insertedCount, updatedCount };
}

async function scrapeCompetitorReviews(sourceUrl: string, apiKey: string, userId: string) {
  const normalizedUrl = normalizePageUrl(sourceUrl);
  const firstMarkdown = await scrapeMarkdownWithRetry(normalizedUrl, apiKey);
  const pageUrls = discoverPageUrls(firstMarkdown, normalizedUrl);
  const pagesToScrape = [...new Set([normalizedUrl, ...pageUrls])].slice(0, 30);

  const allBlocks = new Set<string>();
  for (let i = 0; i < pagesToScrape.length; i += 1) {
    const markdown = i === 0 ? firstMarkdown : await scrapeMarkdownWithRetry(pagesToScrape[i], apiKey);
    for (const block of extractReviewBlocks(markdown)) {
      allBlocks.add(block);
    }
  }

  const { competitorKey, competitorName } = competitorFromUrl(normalizedUrl);
  const scrapedAt = nowIso();
  const records: ReviewRecord[] = [...allBlocks].map((block) => {
    const content = cleanReviewContent(block);
    const sentiment = scoreSentiment(content);

    return {
      source: "producthunt" as const,
      userId,
      competitorKey,
      competitorName,
      sourceUrl: normalizedUrl,
      pageUrl: normalizedUrl,
      content,
      reviewerHandle: inferReviewerHandle(block),
      sentimentLabel: sentiment.sentimentLabel,
      sentimentScore: sentiment.sentimentScore,
      scrapedAt,
      contentHash: hashText(content),
    };
  }).filter((r) => r.content.length > 40);

  return {
    pagesScraped: pagesToScrape.length,
    reviewsExtracted: records.length,
    records,
  };
}

async function runReviewsJob(jobId: string) {
  const current = jobs.get(jobId);
  if (!current) return;

  const patch = (changes: Partial<ReviewsScrapeJob>) => {
    const j = jobs.get(jobId);
    if (!j) return;
    jobs.set(jobId, { ...j, ...changes, updatedAt: nowIso() });
  };

  try {
    const apiKey = await getEnvValue("ANAKIN_API_KEY");
    if (!apiKey) throw new Error("Missing ANAKIN_API_KEY");

    let totalPages = 0;
    let totalExtracted = 0;
    let insertedCount = 0;
    let updatedCount = 0;

    for (let i = 0; i < current.sourceUrls.length; i += 1) {
      const sourceUrl = current.sourceUrls[i];
      patch({
        status: "processing",
        progressMessage: `Scraping competitor ${i + 1}/${current.sourceUrls.length}...`,
        competitorsScraped: i,
      });

      const output = await scrapeCompetitorReviews(sourceUrl, apiKey, current.userId);
      totalPages += output.pagesScraped;
      totalExtracted += output.reviewsExtracted;

      patch({ progressMessage: `Saving competitor ${i + 1}/${current.sourceUrls.length} reviews to MongoDB...` });
      const save = await saveReviews(output.records);
      insertedCount += save.insertedCount;
      updatedCount += save.updatedCount;

      patch({
        competitorsScraped: i + 1,
        pagesScraped: totalPages,
        reviewsExtracted: totalExtracted,
        insertedCount,
        updatedCount,
      });
    }

    patch({
      status: "completed",
      progressMessage: "Reviews scrape completed.",
    });
  } catch (error) {
    patch({
      status: "error",
      progressMessage: "Reviews scrape failed.",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function createReviewsScrapeJob(sourceUrls: string[], userId: string) {
  const cleanUrls = sourceUrls
    .map((url) => url.trim())
    .filter(Boolean)
    .map((url) => normalizePageUrl(url));

  const job: ReviewsScrapeJob = {
    id: toJobId(),
    userId,
    status: "pending",
    progressMessage: "Queued...",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    sourceUrls: cleanUrls,
    competitorsScraped: 0,
    pagesScraped: 0,
    reviewsExtracted: 0,
    insertedCount: 0,
    updatedCount: 0,
  };

  jobs.set(job.id, job);
  setTimeout(() => {
    void runReviewsJob(job.id);
  }, 0);

  return job;
}

export function getReviewsScrapeJob(jobId: string) {
  return jobs.get(jobId);
}

export async function listStoredProductHuntReviews(userId: string, page = 1, pageSize = 20, competitorKey?: string) {
  const db = await getMongoDb();
  const collection = db.collection<ReviewRecord>("producthunt_reviews");
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.min(Math.floor(pageSize), 100) : 20;
  const skip = (safePage - 1) * safePageSize;
  const filter = {
    source: "producthunt" as const,
    userId,
    ...(competitorKey ? { competitorKey } : {}),
  };

  const total = await collection.countDocuments(filter);
  const docs = await collection
    .find(filter)
    .sort({ scrapedAt: -1 })
    .skip(skip)
    .limit(safePageSize)
    .toArray();

  return {
    reviews: docs,
    total,
    page: safePage,
    pageSize: safePageSize,
    totalPages: Math.max(1, Math.ceil(total / safePageSize)),
  };
}

export async function getComparisonData(userId: string) {
  const db = await getMongoDb();
  const collection = db.collection<ReviewRecord>("producthunt_reviews");
  const docs = await collection.find({ source: "producthunt", userId }).sort({ scrapedAt: 1 }).toArray();

  const map = new Map<string, {
    competitorKey: string;
    competitorName: string;
    mentions: number;
    positive: number;
    neutral: number;
    negative: number;
    trend: Array<{ date: string; mentions: number; positivePct: number }>;
  }>();

  for (const doc of docs) {
    if (!map.has(doc.competitorKey)) {
      map.set(doc.competitorKey, {
        competitorKey: doc.competitorKey,
        competitorName: doc.competitorName,
        mentions: 0,
        positive: 0,
        neutral: 0,
        negative: 0,
        trend: [],
      });
    }

    const row = map.get(doc.competitorKey)!;
    row.mentions += 1;
    if (doc.sentimentLabel === "positive") row.positive += 1;
    else if (doc.sentimentLabel === "negative") row.negative += 1;
    else row.neutral += 1;

    const day = doc.scrapedAt.slice(0, 10);
    let bucket = row.trend.find((item) => item.date === day);
    if (!bucket) {
      bucket = { date: day, mentions: 0, positivePct: 0 };
      row.trend.push(bucket);
    }
    bucket.mentions += 1;
    if (doc.sentimentLabel === "positive") {
      bucket.positivePct += 1;
    }
  }

  const competitors = [...map.values()].map((row) => {
    const trend = row.trend
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((bucket) => ({
        date: bucket.date,
        mentions: bucket.mentions,
        positivePct: bucket.mentions ? Number(((bucket.positivePct / bucket.mentions) * 100).toFixed(2)) : 0,
      }));

    return {
      competitorKey: row.competitorKey,
      competitorName: row.competitorName,
      mentions: row.mentions,
      positive: row.positive,
      neutral: row.neutral,
      negative: row.negative,
      positivePct: row.mentions ? Number(((row.positive / row.mentions) * 100).toFixed(2)) : 0,
      trend,
    };
  });

  return {
    competitors,
    totalMentions: competitors.reduce((sum, c) => sum + c.mentions, 0),
  };
}
