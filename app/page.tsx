"use client";

import Link from "next/link";
import { FormEvent, KeyboardEvent, useMemo, useState } from "react";

type AnalysisResult = {
  competitors: Array<{
    url: string;
    name: string;
    description: string;
    category: string;
    targetAudience: string;
    keyFeatures: string[];
    strengths: string[];
    weaknesses: string[];
    pricing: string | null;
    tone: string;
  }>;
  marketInsights: string[];
  featureSuggestions: Array<{
    feature: string;
    rationale: string;
    priority: "High" | "Medium" | "Low";
    inspiration: string;
  }>;
  opportunities: string[];
  threats: string[];
  summary: string;
};

type CompetitorJobResponse = {
  jobId: string;
  status: "pending" | "processing" | "completed" | "error";
  progressMessage: string;
  result: AnalysisResult | null;
  error: string | null;
  metrics: {
    competitors_analysed: number;
    features_suggested: number;
    opportunities_found: number;
  } | null;
};

type ReviewsJobResponse = {
  id: string;
  status: "pending" | "processing" | "completed" | "error";
  progressMessage: string;
  sourceUrls: string[];
  competitorsScraped: number;
  pagesScraped: number;
  reviewsExtracted: number;
  insertedCount: number;
  updatedCount: number;
  error?: string;
};

type StoredReview = {
  contentHash: string;
  content: string;
  reviewerHandle: string | null;
  scrapedAt: string;
  sourceUrl: string;
  competitorKey: string;
  competitorName: string;
  sentimentLabel: "positive" | "neutral" | "negative";
  sentimentScore: number;
};

type ReviewsListResponse = {
  status: string;
  reviews: StoredReview[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  error?: string;
};

type ComparisonCompetitor = {
  competitorKey: string;
  competitorName: string;
  mentions: number;
  positive: number;
  neutral: number;
  negative: number;
  positivePct: number;
  trend: Array<{ date: string; mentions: number; positivePct: number }>;
};

type ComparisonResponse = {
  status: string;
  totalMentions: number;
  competitors: ComparisonCompetitor[];
  error?: string;
};

const POLL_MS = 2500;
const COLORS = ["#2563eb", "#16a34a", "#f59e0b", "#7c3aed", "#ef4444", "#0891b2"];

type Section = "competitor" | "reviews" | "comparison";

function TrendChart({ competitors, metric }: { competitors: ComparisonCompetitor[]; metric: "mentions" | "positivePct" }) {
  const width = 900;
  const height = 260;
  const padding = 24;

  const allDates = [...new Set(competitors.flatMap((c) => c.trend.map((t) => t.date)))].sort();
  if (!allDates.length) {
    return <p className="text-sm text-slate-600">No trend data available yet.</p>;
  }

  const maxY = Math.max(
    1,
    ...competitors.flatMap((c) => c.trend.map((t) => (metric === "mentions" ? t.mentions : t.positivePct))),
  );

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-64 w-full rounded-xl bg-slate-50">
      <rect x="0" y="0" width={width} height={height} fill="#f8fafc" rx="12" />

      {competitors.map((competitor, idx) => {
        const color = COLORS[idx % COLORS.length];
        const coords = allDates.map((date, dateIndex) => {
          const point = competitor.trend.find((t) => t.date === date);
          const value = point ? (metric === "mentions" ? point.mentions : point.positivePct) : 0;
          const x = padding + (dateIndex / Math.max(1, allDates.length - 1)) * (width - padding * 2);
          const y = height - padding - (value / maxY) * (height - padding * 2);
          return { x, y };
        });

        if (!coords.length) return null;

        // For a single time bucket, draw a short horizontal segment + dot so line is visible.
        const linePoints = coords.length === 1
          ? `${Math.max(padding, coords[0].x - 14)},${coords[0].y} ${Math.min(width - padding, coords[0].x + 14)},${coords[0].y}`
          : coords.map((c) => `${c.x},${c.y}`).join(" ");

        return (
          <g key={competitor.competitorKey}>
            <polyline fill="none" stroke={color} strokeWidth="3" points={linePoints} strokeLinecap="round" />
            {coords.map((c, i) => (
              <circle key={`${competitor.competitorKey}_${i}`} cx={c.x} cy={c.y} r="3.5" fill={color} />
            ))}
          </g>
        );
      })}
    </svg>
  );
}

export default function Home() {
  const [activeSection, setActiveSection] = useState<Section>("competitor");

  const [urls, setUrls] = useState<string[]>([
    "https://linear.app",
    "https://asana.com",
    "https://www.atlassian.com/software/jira",
  ]);
  const [urlInput, setUrlInput] = useState("");
  const [context, setContext] = useState("We are building Trackleaf, a project management tool for small engineering teams.");
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [job, setJob] = useState<CompetitorJobResponse | null>(null);

  const [reviewsUrls, setReviewsUrls] = useState<string[]>(["https://www.producthunt.com/products/jira/reviews?filter=all&feed=single&page=1"]);
  const [reviewsUrlInput, setReviewsUrlInput] = useState("");
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reviewsError, setReviewsError] = useState<string | null>(null);
  const [reviewsJob, setReviewsJob] = useState<ReviewsJobResponse | null>(null);
  const [reviews, setReviews] = useState<StoredReview[]>([]);
  const [reviewsPage, setReviewsPage] = useState(1);
  const [reviewsTotalPages, setReviewsTotalPages] = useState(1);
  const [reviewsCompetitor, setReviewsCompetitor] = useState<string>("");

  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [comparisonError, setComparisonError] = useState<string | null>(null);
  const [comparison, setComparison] = useState<ComparisonResponse | null>(null);

  const competitorOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const review of reviews) {
      map.set(review.competitorKey, review.competitorName);
    }
    return [...map.entries()].map(([key, name]) => ({ key, name }));
  }, [reviews]);

  function addChip(raw: string, list: string[], setter: (value: string[]) => void) {
    const value = raw.trim();
    if (!value || list.includes(value)) return;
    setter([...list, value]);
  }

  function removeChip(target: string, list: string[], setter: (value: string[]) => void) {
    setter(list.filter((value) => value !== target));
  }

  async function startCompetitorPolling(jobId: string) {
    let done = false;
    while (!done) {
      const res = await fetch(`/api/competitor-analysis/${jobId}`, { cache: "no-store" });
      const body = (await res.json()) as CompetitorJobResponse;

      if (!res.ok) {
        setSubmitError(body.error ?? "Polling failed.");
        return;
      }

      setJob(body);
      if (body.status === "completed" || body.status === "error") done = true;
      else await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setSubmitError(null);
    setJob(null);

    try {
      const res = await fetch("/api/competitor-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls, context: context.trim() || undefined }),
      });
      const body = await res.json();
      if (!res.ok) {
        setSubmitError(body.error ?? "Failed to start analysis.");
        return;
      }
      await startCompetitorPolling(body.jobId);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  async function loadStoredReviews(page = 1, competitor = reviewsCompetitor) {
    const qs = new URLSearchParams({ page: String(page), pageSize: "12" });
    if (competitor) qs.set("competitor", competitor);

    const res = await fetch(`/api/reviews?${qs.toString()}`, { cache: "no-store" });
    const body = (await res.json()) as ReviewsListResponse;
    if (!res.ok) throw new Error(body?.error ?? "Failed to load reviews");

    setReviews(body.reviews ?? []);
    setReviewsPage(body.page ?? 1);
    setReviewsTotalPages(body.totalPages ?? 1);
  }

  async function startReviewsPolling(jobId: string) {
    let done = false;
    while (!done) {
      const res = await fetch(`/api/reviews/scrape/${jobId}`, { cache: "no-store" });
      const body = (await res.json()) as ReviewsJobResponse & { error?: string };

      if (!res.ok) {
        setReviewsError(body.error ?? "Polling failed.");
        return;
      }

      setReviewsJob(body);
      if (body.status === "completed") {
        done = true;
        await loadStoredReviews(1, reviewsCompetitor);
        await loadComparison();
      } else if (body.status === "error") {
        done = true;
        setReviewsError(body.error ?? "Reviews scrape failed.");
      } else {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
    }
  }

  async function onStartReviewsScrape() {
    setReviewsLoading(true);
    setReviewsError(null);
    setReviewsJob(null);

    try {
      const res = await fetch("/api/reviews/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: reviewsUrls }),
      });
      const body = await res.json();
      if (!res.ok) {
        setReviewsError(body.error ?? "Failed to start reviews scraping.");
        return;
      }
      await startReviewsPolling(body.jobId);
    } catch (error) {
      setReviewsError(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setReviewsLoading(false);
    }
  }

  async function loadComparison() {
    setComparisonLoading(true);
    setComparisonError(null);
    try {
      const res = await fetch("/api/reviews/comparison", { cache: "no-store" });
      const body = (await res.json()) as ComparisonResponse;
      if (!res.ok) {
        setComparisonError(body.error ?? "Failed to load comparison");
        return;
      }
      setComparison(body);
    } catch (error) {
      setComparisonError(error instanceof Error ? error.message : "Failed to load comparison");
    } finally {
      setComparisonLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <main className="flex w-full">
        <aside className="fixed left-0 top-0 hidden h-screen w-72 shrink-0 border-r border-slate-200 bg-white p-5 lg:block">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Workspace</h2>
          <nav className="mt-4 grid gap-2 text-sm">
            <button
              type="button"
              onClick={() => setActiveSection("competitor")}
              className={`rounded-lg px-3 py-2 text-left font-medium ${activeSection === "competitor" ? "bg-slate-100 text-slate-900" : "text-slate-600 hover:bg-slate-50"}`}
            >
              Competitor Analysis
            </button>
            <button
              type="button"
              onClick={() => setActiveSection("reviews")}
              className={`rounded-lg px-3 py-2 text-left font-medium ${activeSection === "reviews" ? "bg-slate-100 text-slate-900" : "text-slate-600 hover:bg-slate-50"}`}
            >
              Reviews
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveSection("comparison");
                void loadComparison();
              }}
              className={`rounded-lg px-3 py-2 text-left font-medium ${activeSection === "comparison" ? "bg-slate-100 text-slate-900" : "text-slate-600 hover:bg-slate-50"}`}
            >
              Comparison
            </button>
          </nav>
          <div className="mt-6 text-xs text-slate-500">
            <Link href="/">Trackleaf Pulse</Link>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col gap-8 p-6 lg:ml-72">
          {activeSection === "competitor" && (
            <>
              <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <h1 className="text-2xl font-semibold">Async Trackleaf Pulse (Anakin)</h1>
                <p className="mt-2 text-sm text-slate-600">Add competitor URLs, start analysis, and view results live via polling.</p>

                <form className="mt-6 grid gap-4" onSubmit={onSubmit}>
                  <label className="grid gap-1">
                    <span className="text-sm font-medium">Competitor URLs</span>
                    <div className="rounded-lg border border-slate-300 bg-white p-3">
                      <div className="mb-2 flex flex-wrap gap-2">
                        {urls.map((url) => (
                          <span key={url} className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-800">
                            {url}
                            <button type="button" onClick={() => removeChip(url, urls, setUrls)} className="rounded-full px-1 text-slate-500 hover:bg-slate-200 hover:text-slate-700">x</button>
                          </span>
                        ))}
                      </div>
                      <input
                        className="w-full text-sm outline-none"
                        value={urlInput}
                        onChange={(e) => setUrlInput(e.target.value)}
                        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            addChip(urlInput, urls, setUrls);
                            setUrlInput("");
                          }
                        }}
                        onBlur={() => {
                          addChip(urlInput, urls, setUrls);
                          setUrlInput("");
                        }}
                        placeholder="Type URL and press Enter"
                      />
                    </div>
                  </label>

                  <label className="grid gap-1">
                    <span className="text-sm font-medium">Your product context (optional)</span>
                    <textarea className="min-h-24 rounded-lg border border-slate-300 bg-white p-3 text-sm outline-none ring-0 focus:border-slate-500" value={context} onChange={(e) => setContext(e.target.value)} />
                  </label>

                  <button type="submit" disabled={loading} className="rounded-lg bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60">
                    {loading ? "Running analysis..." : "Start Analysis"}
                  </button>
                </form>
              </section>

              {submitError && <section className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{submitError}</section>}
              {job && (
                <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide">
                      {(job.status === "pending" || job.status === "processing") && <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />}
                      {job.status}
                    </span>
                    <span className="text-sm text-slate-600">{job.progressMessage}</span>
                  </div>
                </section>
              )}
            </>
          )}

          {activeSection === "reviews" && (
            <>
              <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <h1 className="text-2xl font-semibold">Product Hunt Reviews</h1>
                <p className="mt-2 text-sm text-slate-600">Enter multiple competitor Product Hunt review URLs, scrape asynchronously, run sentiment analysis, and store results in MongoDB.</p>

                <div className="mt-6 grid gap-4">
                  <div className="rounded-lg border border-slate-300 bg-white p-3">
                    <div className="mb-2 flex flex-wrap gap-2">
                      {reviewsUrls.map((url) => (
                        <span key={url} className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-800">
                          {url}
                          <button type="button" onClick={() => removeChip(url, reviewsUrls, setReviewsUrls)} className="rounded-full px-1 text-slate-500 hover:bg-slate-200 hover:text-slate-700">x</button>
                        </span>
                      ))}
                    </div>
                    <input
                      className="w-full text-sm outline-none"
                      value={reviewsUrlInput}
                      onChange={(e) => setReviewsUrlInput(e.target.value)}
                      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          addChip(reviewsUrlInput, reviewsUrls, setReviewsUrls);
                          setReviewsUrlInput("");
                        }
                      }}
                      onBlur={() => {
                        addChip(reviewsUrlInput, reviewsUrls, setReviewsUrls);
                        setReviewsUrlInput("");
                      }}
                      placeholder="Paste Product Hunt review URL and press Enter"
                    />
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <button type="button" onClick={onStartReviewsScrape} disabled={reviewsLoading || reviewsUrls.length === 0} className="rounded-lg bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60">
                      {reviewsLoading ? "Scraping..." : "Start Reviews Scrape"}
                    </button>
                    <button type="button" onClick={() => void loadStoredReviews(1)} className="rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
                      Refresh Stored Reviews
                    </button>
                  </div>
                </div>
              </section>

              {reviewsError && <section className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{reviewsError}</section>}

              {reviewsJob && (
                <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide">
                      {(reviewsJob.status === "pending" || reviewsJob.status === "processing") && <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />}
                      {reviewsJob.status}
                    </span>
                    <span className="text-sm text-slate-600">{reviewsJob.progressMessage}</span>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-5">
                    <div className="rounded-lg bg-slate-50 p-3 text-sm">Competitors: {reviewsJob.competitorsScraped}</div>
                    <div className="rounded-lg bg-slate-50 p-3 text-sm">Pages: {reviewsJob.pagesScraped}</div>
                    <div className="rounded-lg bg-slate-50 p-3 text-sm">Extracted: {reviewsJob.reviewsExtracted}</div>
                    <div className="rounded-lg bg-slate-50 p-3 text-sm">Inserted: {reviewsJob.insertedCount}</div>
                    <div className="rounded-lg bg-slate-50 p-3 text-sm">Updated: {reviewsJob.updatedCount}</div>
                  </div>
                </section>
              )}

              <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold">Stored Reviews ({reviews.length})</h2>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={reviewsCompetitor}
                      onChange={(e) => {
                        const value = e.target.value;
                        setReviewsCompetitor(value);
                        void loadStoredReviews(1, value);
                      }}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-sm"
                    >
                      <option value="">All competitors</option>
                      {competitorOptions.map((option) => (
                        <option key={option.key} value={option.key}>{option.name}</option>
                      ))}
                    </select>
                    <button type="button" onClick={() => void loadStoredReviews(Math.max(1, reviewsPage - 1), reviewsCompetitor)} disabled={reviewsPage <= 1} className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700 disabled:opacity-50">Prev</button>
                    <span className="text-sm text-slate-600">Page {reviewsPage} / {reviewsTotalPages}</span>
                    <button type="button" onClick={() => void loadStoredReviews(Math.min(reviewsTotalPages, reviewsPage + 1), reviewsCompetitor)} disabled={reviewsPage >= reviewsTotalPages} className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700 disabled:opacity-50">Next</button>
                  </div>
                </div>

                <div className="mt-4 grid gap-3">
                  {reviews.length === 0 && <p className="text-sm text-slate-600">No reviews loaded yet. Run scrape or click refresh.</p>}
                  {reviews.map((review) => (
                    <article key={`${review.competitorKey}_${review.contentHash}`} className="rounded-lg border border-slate-200 p-4">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="rounded bg-slate-100 px-2 py-1">{review.competitorName}</span>
                        <span className={`rounded px-2 py-1 ${review.sentimentLabel === "positive" ? "bg-emerald-100 text-emerald-700" : review.sentimentLabel === "negative" ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-700"}`}>
                          {review.sentimentLabel}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-slate-800">{review.content}</p>
                      <p className="mt-2 text-xs text-slate-500">{review.reviewerHandle ? `@${review.reviewerHandle}` : "Unknown reviewer"} | {new Date(review.scrapedAt).toLocaleString()}</p>
                    </article>
                  ))}
                </div>
              </section>
            </>
          )}

          {activeSection === "comparison" && (
            <>
              <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h1 className="text-2xl font-semibold">Comparison Dashboard</h1>
                    <p className="mt-2 text-sm text-slate-600">Mentions and sentiment trends across Product Hunt competitors.</p>
                  </div>
                  <button type="button" onClick={() => void loadComparison()} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Refresh</button>
                </div>
              </section>

              {comparisonError && <section className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{comparisonError}</section>}
              {comparisonLoading && <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">Loading comparison...</section>}

              {comparison && (
                <>
                  <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                    <div className="grid gap-3 sm:grid-cols-4">
                      <div className="rounded-lg bg-slate-50 p-4 text-sm">Total Mentions: {comparison.totalMentions}</div>
                      <div className="rounded-lg bg-slate-50 p-4 text-sm">Competitors: {comparison.competitors.length}</div>
                      <div className="rounded-lg bg-slate-50 p-4 text-sm">Top by Mentions: {comparison.competitors.sort((a, b) => b.mentions - a.mentions)[0]?.competitorName || comparison.competitors.sort((a, b) => b.mentions - a.mentions)[0]?.competitorKey || "-"}</div>
                      <div className="rounded-lg bg-slate-50 p-4 text-sm">Best Positive %: {comparison.competitors.sort((a, b) => b.positivePct - a.positivePct)[0]?.competitorName || comparison.competitors.sort((a, b) => b.positivePct - a.positivePct)[0]?.competitorKey || "-"}</div>
                    </div>
                  </section>

                  <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                    <h2 className="text-lg font-semibold">Mentions Trend</h2>
                    <div className="mt-4">
                      <TrendChart competitors={comparison.competitors} metric="mentions" />
                    </div>
                  </section>

                  <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                    <h2 className="text-lg font-semibold">Positive Sentiment % Trend</h2>
                    <div className="mt-4">
                      <TrendChart competitors={comparison.competitors} metric="positivePct" />
                    </div>
                  </section>

                  <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                    <h2 className="text-lg font-semibold">Competitor Breakdown</h2>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      {comparison.competitors.map((competitor, idx) => (
                        <article key={competitor.competitorKey} className="rounded-lg border border-slate-200 p-4">
                          <div className="flex items-center gap-2">
                            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLORS[idx % COLORS.length] }} />
                            <h3 className="font-semibold">{competitor.competitorName || competitor.competitorKey}</h3>
                          </div>
                          <p className="mt-2 text-sm text-slate-700">Mentions: {competitor.mentions}</p>
                          <p className="mt-1 text-sm text-slate-700">Positive: {competitor.positive} | Neutral: {competitor.neutral} | Negative: {competitor.negative}</p>
                          <p className="mt-1 text-sm text-slate-700">Positive %: {competitor.positivePct}%</p>
                        </article>
                      ))}
                    </div>
                  </section>
                </>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
