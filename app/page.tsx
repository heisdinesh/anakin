"use client";

import { FormEvent, KeyboardEvent, useState } from "react";
import Link from "next/link";

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

type JobResponse = {
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

const POLL_MS = 2500;

export default function Home() {
  const [urls, setUrls] = useState<string[]>([
    "https://linear.app",
    "https://asana.com",
    "https://www.atlassian.com/software/jira",
  ]);
  const [urlInput, setUrlInput] = useState("");
  const [context, setContext] = useState("We are building Trackleaf, a project management tool for small engineering teams.");
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [job, setJob] = useState<JobResponse | null>(null);

  function addUrl(raw: string) {
    const value = raw.trim();
    if (!value) return;
    if (urls.includes(value)) return;
    setUrls((prev) => [...prev, value]);
  }

  function removeUrl(target: string) {
    setUrls((prev) => prev.filter((url) => url !== target));
  }

  function onUrlKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    addUrl(urlInput);
    setUrlInput("");
  }

  async function startPolling(jobId: string) {
    let done = false;
    while (!done) {
      const res = await fetch(`/api/competitor-analysis/${jobId}`, { cache: "no-store" });
      const body = (await res.json()) as JobResponse;

      if (!res.ok) {
        setSubmitError(body.error ?? "Polling failed.");
        return;
      }

      setJob(body);

      if (body.status === "completed" || body.status === "error") {
        done = true;
      } else {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
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
        body: JSON.stringify({
          urls,
          context: context.trim() || undefined,
        }),
      });

      const body = await res.json();

      if (!res.ok) {
        setSubmitError(body.error ?? "Failed to start analysis.");
        return;
      }

      await startPolling(body.jobId);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <main className="flex w-full">
        <aside className="fixed left-0 top-0 hidden h-screen w-72 shrink-0 border-r border-slate-200 bg-white p-5 lg:block">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Workspace</h2>
          <nav className="mt-4 grid gap-2 text-sm">
            <Link className="rounded-lg bg-slate-100 px-3 py-2 font-medium text-slate-900" href="/">
              Competitor Analysis
            </Link>
          </nav>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col gap-8 p-6 lg:ml-72">
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
                      <button
                        type="button"
                        onClick={() => removeUrl(url)}
                        className="rounded-full px-1 text-slate-500 hover:bg-slate-200 hover:text-slate-700"
                        aria-label={`Remove ${url}`}
                      >
                        x
                      </button>
                    </span>
                  ))}
                </div>
                <input
                  className="w-full text-sm outline-none"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={onUrlKeyDown}
                  onBlur={() => {
                    addUrl(urlInput);
                    setUrlInput("");
                  }}
                  placeholder="Type URL and press Enter"
                />
              </div>
            </label>

            <label className="grid gap-1">
              <span className="text-sm font-medium">Your product context (optional)</span>
              <textarea
                className="min-h-24 rounded-lg border border-slate-300 bg-white p-3 text-sm outline-none ring-0 focus:border-slate-500"
                value={context}
                onChange={(e) => setContext(e.target.value)}
              />
            </label>

            <button
              type="submit"
              disabled={loading}
              className="rounded-lg bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Running analysis..." : "Start Analysis"}
            </button>
          </form>
          </section>

          {submitError && (
            <section className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{submitError}</section>
          )}

          {job && (
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide">{job.status}</span>
                <span className="text-sm text-slate-600">{job.progressMessage}</span>
              </div>

              {job.metrics && (
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg bg-slate-50 p-3 text-sm">Competitors: {job.metrics.competitors_analysed}</div>
                  <div className="rounded-lg bg-slate-50 p-3 text-sm">Features Suggested: {job.metrics.features_suggested}</div>
                  <div className="rounded-lg bg-slate-50 p-3 text-sm">Opportunities: {job.metrics.opportunities_found}</div>
                </div>
              )}

              {job.result && (
                <div className="mt-6 grid gap-6">
                  <div>
                    <h2 className="text-lg font-semibold">Summary</h2>
                    <p className="mt-2 text-sm text-slate-700">{job.result.summary || "No summary returned."}</p>
                  </div>

                  <div>
                    <h2 className="text-lg font-semibold">Competitors</h2>
                    <div className="mt-3 grid gap-3">
                      {job.result.competitors.map((c, idx) => (
                        <article key={`${c.url}_${idx}`} className="rounded-lg border border-slate-200 p-4">
                          <h3 className="font-semibold">{c.name || c.url}</h3>
                          <p className="mt-1 text-sm text-slate-700">{c.description}</p>
                          <p className="mt-2 text-xs text-slate-500">{c.category} | {c.targetAudience} | {c.tone}</p>
                        </article>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h2 className="text-lg font-semibold">Feature Suggestions</h2>
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
        </div>
      </main>
    </div>
  );
}
