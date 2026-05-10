"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useState } from "react";

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
  competitorMatrix: Array<{
    competitor: string;
    positioning: string;
    pricing: string | null;
    easeOfUse: "High" | "Medium" | "Low";
    customization: "High" | "Medium" | "Low";
    reportingDepth: "High" | "Medium" | "Low";
    idealFor: string;
    notableGap: string;
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
  fallbackUsed?: boolean;
  fallbackReason?: string | null;
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

type ActionStatus = "todo" | "inprogress" | "done";
type ProductAction = {
  _id: string;
  userId: string;
  source: "reviews" | "competitor_analysis";
  competitorKey: string;
  competitorName: string;
  title: string;
  insight: string;
  priority: "High" | "Medium" | "Low";
  sentimentLabel: "positive" | "neutral" | "negative";
  status: ActionStatus;
  createdAt: string;
  updatedAt: string;
};

type ActionsListResponse = {
  status: string;
  count: number;
  actions: ProductAction[];
  error?: string;
};

type ActionsJobResponse = {
  id: string;
  userId: string;
  status: "pending" | "processing" | "completed" | "error";
  progressMessage: string;
  reviewsScanned: number;
  analysisSuggestionsScanned: number;
  actionsCreated: number;
  error?: string;
};

const POLL_MS = 2500;
const USER_ID_KEY = "trackleafUserId";
const UI_STATE_KEY = "trackleafUiState";

type Section = "competitor" | "reviews" | "comparison" | "actions";
type VoiceTab = "feedback" | "priorities";
type FeatureSuggestion = AnalysisResult["featureSuggestions"][number];

type PersistedUiState = Partial<{
  urls: string[];
  context: string;
  job: CompetitorJobResponse | null;
  reviewsUrls: string[];
  reviews: StoredReview[];
  reviewsJob: ReviewsJobResponse | null;
  reviewsPage: number;
  reviewsTotalPages: number;
  reviewsCompetitor: string;
  comparison: ComparisonResponse | null;
  actions: ProductAction[];
}>;

function readSavedState(): PersistedUiState {
  if (typeof window === "undefined") return {};
  const raw = localStorage.getItem(UI_STATE_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as PersistedUiState;
  } catch {
    return {};
  }
}

function ReviewsBarChart({ competitors }: { competitors: ComparisonCompetitor[] }) {
  const width = 960;
  const height = 360;
  const left = 56;
  const right = 20;
  const top = 20;
  const bottom = 64;
  const innerWidth = width - left - right;
  const innerHeight = height - top - bottom;
  const maxMentions = Math.max(1, ...competitors.map((c) => c.mentions));

  if (!competitors.length) {
    return <p className="text-sm text-slate-600">No comparison data yet.</p>;
  }

  const slotWidth = innerWidth / competitors.length;
  const barWidth = Math.min(56, slotWidth * 0.6);

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
        <line x1={left} y1={top + innerHeight} x2={width - right} y2={top + innerHeight} stroke="#94a3b8" />
        <line x1={left} y1={top} x2={left} y2={top + innerHeight} stroke="#94a3b8" />

        {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
          const value = Math.round(maxMentions * tick);
          const y = top + innerHeight - tick * innerHeight;
          return (
            <g key={tick}>
              <line x1={left} y1={y} x2={width - right} y2={y} stroke="#e2e8f0" />
              <text x={left - 8} y={y + 4} textAnchor="end" fontSize="11" fill="#64748b">{value}</text>
            </g>
          );
        })}

        {competitors.map((c, index) => {
          const xCenter = left + index * slotWidth + slotWidth / 2;
          const totalBarHeight = (c.mentions / maxMentions) * innerHeight;
          const positiveHeight = c.mentions ? (c.positive / c.mentions) * totalBarHeight : 0;
          const neutralHeight = c.mentions ? (c.neutral / c.mentions) * totalBarHeight : 0;
          const negativeHeight = c.mentions ? (c.negative / c.mentions) * totalBarHeight : 0;
          const y = top + innerHeight - totalBarHeight;
          const label = c.competitorName || c.competitorKey;

          return (
            <g key={c.competitorKey}>
              <rect x={xCenter - barWidth / 2} y={y} width={barWidth} height={positiveHeight} fill="#10b981" />
              <rect x={xCenter - barWidth / 2} y={y + positiveHeight} width={barWidth} height={neutralHeight} fill="#94a3b8" />
              <rect x={xCenter - barWidth / 2} y={y + positiveHeight + neutralHeight} width={barWidth} height={negativeHeight} fill="#ef4444" />
              <text x={xCenter} y={y - 6} textAnchor="middle" fontSize="11" fill="#334155">{c.mentions}</text>
              <text x={xCenter} y={top + innerHeight + 18} textAnchor="middle" fontSize="11" fill="#334155">
                {label.length > 14 ? `${label.slice(0, 14)}...` : label}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />Positive</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-slate-400" />Neutral</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-red-500" />Negative</span>
      </div>
    </div>
  );
}

export default function Home() {
  return <TrackleafDashboard initialSection="competitor" />;
}

export function TrackleafDashboard({ initialSection }: { initialSection: Section }) {
  const router = useRouter();
  const savedState = useMemo(() => readSavedState(), []);
  const activeSection = initialSection;

  const [urls, setUrls] = useState<string[]>(savedState.urls ?? [
    "https://linear.app",
    "https://asana.com",
    "https://www.atlassian.com/software/jira",
  ]);
  const [urlInput, setUrlInput] = useState("");
  const [context, setContext] = useState(savedState.context ?? "We are building Trackleaf. Help us identify customer pain, market gaps, and what to build next.");
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [job, setJob] = useState<CompetitorJobResponse | null>(savedState.job ?? null);

  const [reviewsUrls, setReviewsUrls] = useState<string[]>(savedState.reviewsUrls ?? ["https://www.producthunt.com/products/jira/reviews?filter=all&feed=single&page=1"]);
  const [reviewsUrlInput, setReviewsUrlInput] = useState("");
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reviewsError, setReviewsError] = useState<string | null>(null);
  const [reviewsJob, setReviewsJob] = useState<ReviewsJobResponse | null>(savedState.reviewsJob ?? null);
  const [reviews, setReviews] = useState<StoredReview[]>(savedState.reviews ?? []);
  const [reviewsPage, setReviewsPage] = useState(savedState.reviewsPage ?? 1);
  const [reviewsTotalPages, setReviewsTotalPages] = useState(savedState.reviewsTotalPages ?? 1);
  const [reviewsCompetitor, setReviewsCompetitor] = useState<string>(savedState.reviewsCompetitor ?? "");

  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [comparisonError, setComparisonError] = useState<string | null>(null);
  const [comparison, setComparison] = useState<ComparisonResponse | null>(savedState.comparison ?? null);
  const [actions, setActions] = useState<ProductAction[]>(savedState.actions ?? []);
  const [actionsJob, setActionsJob] = useState<ActionsJobResponse | null>(null);
  const [actionsLoading, setActionsLoading] = useState(false);
  const [actionsError, setActionsError] = useState<string | null>(null);
  const [voiceTab, setVoiceTab] = useState<VoiceTab>(initialSection === "reviews" ? "feedback" : "priorities");
  const [featureModalOpen, setFeatureModalOpen] = useState(false);
  const [featureChoices, setFeatureChoices] = useState<Array<{ selected: boolean; item: FeatureSuggestion }>>([]);
  const [featureActionLoading, setFeatureActionLoading] = useState(false);
  const [featureActionError, setFeatureActionError] = useState<string | null>(null);

  function getOrCreateUserId() {
    const existingUserId = localStorage.getItem(USER_ID_KEY);
    if (existingUserId) return existingUserId;
    const nextUserId = crypto.randomUUID();
    localStorage.setItem(USER_ID_KEY, nextUserId);
    return nextUserId;
  }

  useEffect(() => {
    getOrCreateUserId();
  }, []);

  useEffect(() => {
    localStorage.setItem(
      UI_STATE_KEY,
      JSON.stringify({
        urls,
        context,
        job,
        reviewsUrls,
        reviews,
        reviewsJob,
        reviewsPage,
        reviewsTotalPages,
        reviewsCompetitor,
        comparison,
        actions,
      }),
    );
  }, [urls, context, job, reviewsUrls, reviews, reviewsJob, reviewsPage, reviewsTotalPages, reviewsCompetitor, comparison, actions]);

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
      if (body.status === "completed") {
        done = true;
        const suggestions = body.result?.featureSuggestions ?? [];
        if (suggestions.length > 0) {
          setFeatureChoices(suggestions.map((item) => ({ selected: true, item })));
          setFeatureActionError(null);
          setFeatureModalOpen(true);
        }
      } else if (body.status === "error") {
        done = true;
      }
      else await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  }

  async function onCreateActionsFromSelectedFeatures() {
    const selected = featureChoices.filter((c) => c.selected).map((c) => c.item);
    if (!selected.length) {
      setFeatureActionError("Select at least one feature.");
      return;
    }

    const userId = getOrCreateUserId();
    setFeatureActionLoading(true);
    setFeatureActionError(null);
    try {
      const res = await fetch("/api/actions/from-features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, suggestions: selected }),
      });
      const body = await res.json();
      if (!res.ok) {
        setFeatureActionError(body.error ?? "Failed to create actions.");
        return;
      }

      setFeatureModalOpen(false);
      await loadActions();
      router.push("/actions");
    } catch (error) {
      setFeatureActionError(error instanceof Error ? error.message : "Failed to create actions.");
    } finally {
      setFeatureActionLoading(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setSubmitError(null);
    setJob(null);

    try {
      const userId = getOrCreateUserId();
      const res = await fetch("/api/competitor-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, urls, context: context.trim() || undefined }),
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
    const userId = getOrCreateUserId();
    const qs = new URLSearchParams({ page: String(page), pageSize: "12" });
    qs.set("userId", userId);
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
    const userId = getOrCreateUserId();
    setReviewsLoading(true);
    setReviewsError(null);
    setReviewsJob(null);

    try {
      const res = await fetch("/api/reviews/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, urls: reviewsUrls }),
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

  const loadComparison = useCallback(async () => {
    const userId = getOrCreateUserId();
    setComparisonLoading(true);
    setComparisonError(null);
    try {
      const res = await fetch(`/api/reviews/comparison?userId=${encodeURIComponent(userId)}`, { cache: "no-store" });
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
  }, []);

  const loadActions = useCallback(async () => {
    const userId = getOrCreateUserId();
    const res = await fetch(`/api/actions?userId=${encodeURIComponent(userId)}`, { cache: "no-store" });
    const body = (await res.json()) as ActionsListResponse;
    if (!res.ok) {
      setActionsError(body.error ?? "Failed to load actions");
      return;
    }
    setActions(body.actions ?? []);
  }, []);

  async function startActionsPolling(jobId: string) {
    let done = false;
    while (!done) {
      const res = await fetch(`/api/actions/generate/${jobId}`, { cache: "no-store" });
      const body = (await res.json()) as ActionsJobResponse & { error?: string };
      if (!res.ok) {
        setActionsError(body.error ?? "Polling failed.");
        return;
      }
      setActionsJob(body);
      if (body.status === "completed") {
        done = true;
        await loadActions();
      } else if (body.status === "error") {
        done = true;
        setActionsError(body.error ?? "Action generation failed.");
      } else {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
    }
  }

  async function onGenerateActions() {
    const userId = getOrCreateUserId();
    setActionsLoading(true);
    setActionsError(null);
    setActionsJob(null);
    try {
      const res = await fetch("/api/actions/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const body = await res.json();
      if (!res.ok) {
        setActionsError(body.error ?? "Failed to start action generation.");
        return;
      }
      await startActionsPolling(body.jobId);
    } catch (error) {
      setActionsError(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setActionsLoading(false);
    }
  }

  async function onChangeActionStatus(actionId: string, status: ActionStatus) {
    const userId = getOrCreateUserId();
    const res = await fetch(`/api/actions/${actionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, status }),
    });
    if (!res.ok) return;
    await loadActions();
  }

  useEffect(() => {
    if (activeSection === "comparison" && !comparison && !comparisonLoading) {
      void loadComparison();
    }
  }, [activeSection, comparison, comparisonLoading, loadComparison]);

  const loadLatestCompetitorAnalysis = useCallback(async () => {
    const userId = getOrCreateUserId();
    const res = await fetch(`/api/competitor-analysis/latest?userId=${encodeURIComponent(userId)}`, { cache: "no-store" });
    if (!res.ok) return;
    const body = (await res.json()) as CompetitorJobResponse;
    if (body?.status === "completed") {
      setJob(body);
    }
  }, []);

  useEffect(() => {
    if (activeSection === "competitor" && !job) {
      const timer = setTimeout(() => {
        void loadLatestCompetitorAnalysis();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [activeSection, job, loadLatestCompetitorAnalysis]);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <main className="flex w-full">
        <aside className="fixed left-0 top-0 hidden h-screen w-72 shrink-0 border-r border-slate-200 bg-white p-5 lg:block">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Decision Engine</h2>
          <nav className="mt-4 grid gap-2 text-sm">
            <Link href="/competitor-analysis" className={`rounded-lg px-3 py-2 text-left font-medium ${activeSection === "competitor" ? "bg-slate-100 text-slate-900" : "text-slate-600 hover:bg-slate-50"}`}>
              Market Gap Analysis
            </Link>
            <Link href="/reviews" className={`rounded-lg px-3 py-2 text-left font-medium ${activeSection === "reviews" ? "bg-slate-100 text-slate-900" : "text-slate-600 hover:bg-slate-50"}`}>
              Voice of Customer
            </Link>
            <Link href="/actions" className={`rounded-lg px-3 py-2 text-left font-medium ${activeSection === "actions" ? "bg-slate-100 text-slate-900" : "text-slate-600 hover:bg-slate-50"}`}>
              Actions
            </Link>
          </nav>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col gap-8 p-6 lg:ml-72">
          {activeSection === "competitor" && (
            <>
              <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <h1 className="text-2xl font-semibold">Market Gap Analysis</h1>
                <p className="mt-2 text-sm text-slate-600">Building is easy. Deciding what to build is hard. Analyze market signals and turn them into execution-ready feature priorities.</p>

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
                    {loading ? "Analyzing market signals..." : "Generate Build Priorities"}
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

                  {job.metrics && (
                    <div className="mt-4 grid gap-3 sm:grid-cols-3">
                      <div className="rounded-lg bg-slate-50 p-3 text-sm">Competitors: {job.metrics.competitors_analysed}</div>
                      <div className="rounded-lg bg-slate-50 p-3 text-sm">Features Suggested: {job.metrics.features_suggested}</div>
                      <div className="rounded-lg bg-slate-50 p-3 text-sm">Opportunities: {job.metrics.opportunities_found}</div>
                    </div>
                  )}

                  {job.fallbackUsed && (
                    <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                      LLM call failed, so fallback analysis was used.
                      {job.fallbackReason ? ` Reason: ${job.fallbackReason}` : ""}
                    </div>
                  )}

                  {job.result && (
                    <div className="mt-6 grid gap-6">
                      <div>
                        <h2 className="text-lg font-semibold">What We Should Build Next</h2>
                        <p className="mt-1 text-sm text-slate-600">Recommended actions based on competitor gaps and opportunities.</p>
                        <div className="mt-3 grid gap-3">
                          {job.result.featureSuggestions.map((f, idx) => (
                            <article key={`${f.feature}_${idx}`} className="rounded-lg border border-slate-200 p-4">
                              <h3 className="font-semibold">{f.feature}</h3>
                              <p className="mt-1 text-sm text-slate-700">{f.rationale}</p>
                              <p className="mt-2 text-xs text-slate-500">Priority: {f.priority} | Inspiration: {f.inspiration}</p>
                            </article>
                          ))}
                        </div>
                      </div>

                      <div>
                        <h2 className="text-lg font-semibold">Competitive Decision Matrix</h2>
                        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
                          <table className="min-w-full text-sm">
                            <thead className="bg-slate-50 text-left">
                              <tr>
                                <th className="px-3 py-2 font-semibold">Competitor</th>
                                <th className="px-3 py-2 font-semibold">Ease</th>
                                <th className="px-3 py-2 font-semibold">Custom</th>
                                <th className="px-3 py-2 font-semibold">Reporting</th>
                                <th className="px-3 py-2 font-semibold">Ideal For</th>
                                <th className="px-3 py-2 font-semibold">Notable Gap</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(job.result.competitorMatrix ?? []).map((row, idx) => (
                                <tr key={`${row.competitor}_${idx}`} className="border-t border-slate-200">
                                  <td className="px-3 py-2">{row.competitor}</td>
                                  <td className="px-3 py-2">{row.easeOfUse}</td>
                                  <td className="px-3 py-2">{row.customization}</td>
                                  <td className="px-3 py-2">{row.reportingDepth}</td>
                                  <td className="px-3 py-2">{row.idealFor}</td>
                                  <td className="px-3 py-2">{row.notableGap}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      <div>
                        <h2 className="text-lg font-semibold">Market Narrative</h2>
                        <p className="mt-2 text-sm text-slate-700">{job.result.summary || "No summary returned."}</p>
                      </div>

                      <div>
                        <h2 className="text-lg font-semibold">Competitors (Reference Only)</h2>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {job.result.competitors.map((c, idx) => (
                            <span key={`${c.url}_${idx}`} className="rounded-full border border-slate-300 bg-slate-50 px-3 py-1 text-sm text-slate-800">
                              {c.name || c.url}
                            </span>
                          ))}
                        </div>
                      </div>

                      <details className="rounded-lg border border-slate-200 p-3">
                        <summary className="cursor-pointer text-sm font-medium">Raw JSON</summary>
                        <pre className="mt-3 overflow-auto rounded-md bg-slate-950 p-3 text-xs text-slate-100">
                          {JSON.stringify(job.result, null, 2)}
                        </pre>
                      </details>
                    </div>
                  )}
                </section>
              )}
            </>
          )}

          {activeSection === "reviews" && (
            <>
              <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <h1 className="text-2xl font-semibold">Voice of Customer</h1>
                <p className="mt-2 text-sm text-slate-600">Capture what customers are actually saying across competitor review pages and convert noise into product intelligence.</p>
                <div className="mt-4 inline-flex rounded-lg border border-slate-300 bg-slate-50 p-1 text-sm">
                  <button
                    type="button"
                    onClick={() => setVoiceTab("feedback")}
                    className={`rounded-md px-3 py-1.5 ${voiceTab === "feedback" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}
                  >
                    Feedback
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setVoiceTab("priorities");
                      void loadComparison();
                      void loadActions();
                    }}
                    className={`rounded-md px-3 py-1.5 ${voiceTab === "priorities" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}
                  >
                    Build Priorities
                  </button>
                </div>
              </section>

              {voiceTab === "feedback" && (
                <>
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
                      {reviewsLoading ? "Collecting customer signals..." : "Collect Customer Signals"}
                    </button>
                    <button type="button" onClick={() => void loadStoredReviews(1)} className="rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
                      Refresh Insights
                    </button>
                  </div>
                </div>

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
                  <h2 className="text-lg font-semibold">Captured Customer Feedback ({reviews.length})</h2>
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

              {voiceTab === "priorities" && (
                <>
                  <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h2 className="text-xl font-semibold">Build Priorities Dashboard</h2>
                        <p className="mt-1 text-sm text-slate-600">Use sentiment + market signals to decide what developers should build next.</p>
                      </div>
                      <button type="button" onClick={() => void loadComparison()} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Refresh</button>
                    </div>
                  </section>

                  {comparisonError && <section className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{comparisonError}</section>}
                  {comparisonLoading && <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">Loading comparison...</section>}

                  {comparison && (
                    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                      <h2 className="text-lg font-semibold">Demand by Competitor (Segmented by Sentiment)</h2>
                      <div className="mt-4">
                        <ReviewsBarChart competitors={comparison.competitors} />
                      </div>
                    </section>
                  )}

                  <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                    <h2 className="text-lg font-semibold">Execution Actions</h2>
                    <p className="mt-1 text-sm text-slate-600">Generate actions from both review sentiment and competitor-analysis priorities.</p>
                    <div className="mt-4 flex flex-wrap gap-3">
                      <button type="button" onClick={onGenerateActions} disabled={actionsLoading} className="rounded-lg bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60">
                        {actionsLoading ? "Generating actions..." : "Generate Actions"}
                      </button>
                      <button type="button" onClick={() => void loadActions()} className="rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
                        Refresh Actions
                      </button>
                    </div>
                  </section>

                  {actionsError && (
                    <section className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{actionsError}</section>
                  )}

                  {actionsJob && (
                    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide">
                          {(actionsJob.status === "pending" || actionsJob.status === "processing") && <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />}
                          {actionsJob.status}
                        </span>
                        <span className="text-sm text-slate-600">{actionsJob.progressMessage}</span>
                      </div>
                      <div className="mt-4 grid gap-3 sm:grid-cols-3">
                        <div className="rounded-lg bg-slate-50 p-3 text-sm">Reviews Scanned: {actionsJob.reviewsScanned}</div>
                        <div className="rounded-lg bg-slate-50 p-3 text-sm">Analysis Suggestions Scanned: {actionsJob.analysisSuggestionsScanned}</div>
                        <div className="rounded-lg bg-slate-50 p-3 text-sm">Actions Created: {actionsJob.actionsCreated}</div>
                      </div>
                    </section>
                  )}

                  <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                    <h2 className="text-lg font-semibold">Action List</h2>
                    <div className="mt-4 grid gap-3">
                      {actions.length === 0 && (
                        <p className="text-sm text-slate-600">No actions yet. Generate actions to see prioritized work items.</p>
                      )}
                      {actions.map((action) => (
                        <article key={action._id} className="rounded-lg border border-slate-200 bg-white p-4">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="rounded bg-slate-100 px-2 py-1">{action.source === "reviews" ? "Review Signal" : "Build Priority Signal"}</span>
                            <span className="rounded bg-slate-100 px-2 py-1">{action.competitorName}</span>
                            <span className="rounded bg-slate-100 px-2 py-1">Priority: {action.priority}</span>
                          </div>
                          <p className="mt-2 text-sm font-medium text-slate-900">{action.title}</p>
                          <p className="mt-1 text-sm text-slate-700">{action.insight}</p>
                          <div className="mt-3 flex items-center gap-3">
                            <label className="text-xs text-slate-500">Status</label>
                            <select
                              value={action.status}
                              onChange={(e) => void onChangeActionStatus(action._id, e.target.value as ActionStatus)}
                              className="rounded border border-slate-300 px-2 py-1 text-xs"
                            >
                              <option value="todo">todo</option>
                              <option value="inprogress">inprogress</option>
                              <option value="done">done</option>
                            </select>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                </>
              )}
            </>
          )}

          {activeSection === "actions" && (
            <>
              {actionsError && (
                <section className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{actionsError}</section>
              )}

              {actionsJob && (
                <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide">
                      {(actionsJob.status === "pending" || actionsJob.status === "processing") && <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />}
                      {actionsJob.status}
                    </span>
                    <span className="text-sm text-slate-600">{actionsJob.progressMessage}</span>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-lg bg-slate-50 p-3 text-sm">Reviews Scanned: {actionsJob.reviewsScanned}</div>
                    <div className="rounded-lg bg-slate-50 p-3 text-sm">Analysis Suggestions Scanned: {actionsJob.analysisSuggestionsScanned}</div>
                    <div className="rounded-lg bg-slate-50 p-3 text-sm">Actions Created: {actionsJob.actionsCreated}</div>
                  </div>
                </section>
              )}

              <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-lg font-semibold">Action List</h2>
                <div className="mt-4 grid gap-3">
                  {actions.length === 0 && (
                    <p className="text-sm text-slate-600">No actions yet. Generate actions to see prioritized work items.</p>
                  )}
                  {actions.map((action) => (
                    <article key={action._id} className="rounded-lg border border-slate-200 bg-white p-4">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="rounded bg-slate-100 px-2 py-1">{action.source === "reviews" ? "Review Signal" : "Build Priority Signal"}</span>
                        <span className="rounded bg-slate-100 px-2 py-1">{action.competitorName}</span>
                        <span className="rounded bg-slate-100 px-2 py-1">Priority: {action.priority}</span>
                      </div>
                      <p className="mt-2 text-sm font-medium text-slate-900">{action.title}</p>
                      <p className="mt-1 text-sm text-slate-700">{action.insight}</p>
                      <div className="mt-3 flex items-center gap-3">
                        <label className="text-xs text-slate-500">Status</label>
                        <select
                          value={action.status}
                          onChange={(e) => void onChangeActionStatus(action._id, e.target.value as ActionStatus)}
                          className="rounded border border-slate-300 px-2 py-1 text-xs"
                        >
                          <option value="todo">todo</option>
                          <option value="inprogress">inprogress</option>
                          <option value="done">done</option>
                        </select>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      </main>

      {featureModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
          <div className="max-h-[85vh] w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-xl">
            <div className="border-b border-slate-200 p-5">
              <h2 className="text-xl font-semibold">Build Priorities Ready</h2>
              <p className="mt-1 text-sm text-slate-600">Select the features you want to convert into actions.</p>
            </div>

            <div className="max-h-[55vh] overflow-y-auto p-5">
              <div className="grid gap-3">
                {featureChoices.map((choice, idx) => (
                  <label key={`${choice.item.feature}_${idx}`} className="flex items-start gap-3 rounded-lg border border-slate-200 p-3">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={choice.selected}
                      onChange={(e) => {
                        const next = [...featureChoices];
                        next[idx] = { ...next[idx], selected: e.target.checked };
                        setFeatureChoices(next);
                      }}
                    />
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{choice.item.feature}</p>
                      <p className="mt-1 text-sm text-slate-700">{choice.item.rationale}</p>
                      <p className="mt-1 text-xs text-slate-500">Priority: {choice.item.priority} | Inspiration: {choice.item.inspiration}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 p-5">
              {featureActionError ? <p className="text-sm text-red-600">{featureActionError}</p> : <div />}
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                  onClick={() => setFeatureModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void onCreateActionsFromSelectedFeatures()}
                  disabled={featureActionLoading}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {featureActionLoading ? "Creating..." : "Create Actions"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
