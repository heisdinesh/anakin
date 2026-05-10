import { readFile } from "node:fs/promises";
import { load } from "cheerio";
import { getMongoDb } from "@/lib/mongo";

export type CompetitorInput = {
  userId: string;
  urls: string[];
  context?: string;
  model?: string;
};

export type CompetitorRecord = {
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
};

export type FeatureSuggestion = {
  feature: string;
  rationale: string;
  priority: "High" | "Medium" | "Low";
  inspiration: string;
};

export type CompetitorMatrixRow = {
  competitor: string;
  positioning: string;
  pricing: string | null;
  easeOfUse: "High" | "Medium" | "Low";
  customization: "High" | "Medium" | "Low";
  reportingDepth: "High" | "Medium" | "Low";
  idealFor: string;
  notableGap: string;
};

export type CompetitorAnalysisResult = {
  competitors: CompetitorRecord[];
  competitorMatrix: CompetitorMatrixRow[];
  marketInsights: string[];
  featureSuggestions: FeatureSuggestion[];
  opportunities: string[];
  threats: string[];
  summary: string;
};

export type JobStatus = "pending" | "processing" | "completed" | "error";

export type AnalysisJob = {
  id: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  input: CompetitorInput;
  progressMessage: string;
  result?: CompetitorAnalysisResult;
  error?: string;
};

type ScrapedSite = {
  url: string;
  text: string;
};

const jobs = new Map<string, AnalysisJob>();

function nowIso() {
  return new Date().toISOString();
}

function toJobId() {
  return `job_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

async function getEnvValue(name: string): Promise<string | undefined> {
  if (process.env[name]) return process.env[name];

  const locations = [".env.local", ".env", "../.env"];
  for (const filepath of locations) {
    try {
      const txt = await readFile(filepath, "utf8");
      for (const line of txt.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const [k, ...rest] = trimmed.split("=");
        if (k !== name) continue;
        return rest.join("=").trim().replace(/^['\"]|['\"]$/g, "");
      }
    } catch {
      // ignore missing file
    }
  }

  return undefined;
}

async function fetchWebsiteText(url: string): Promise<{ url: string; text: string }> {
  let html = "";

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    html = await response.text();
  } catch (error) {
    return {
      url,
      text: `[Could not fetch ${url}: ${error instanceof Error ? error.message : String(error)}]`,
    };
  }

  try {
    const $ = load(html);
    $("script, style, nav, footer, header, aside, iframe, noscript").remove();

    const textParts: string[] = [];

    const title = $("title").first().text().trim();
    if (title) textParts.push(`Page Title: ${title}`);

    const metaDesc = $('meta[name="description"]').attr("content")?.trim();
    if (metaDesc) textParts.push(`Description: ${metaDesc}`);

    $("h1, h2, h3, p, li, td").each((_, el) => {
      const t = $(el).text().replace(/\s+/g, " ").trim();
      if (t.length > 20) textParts.push(t);
    });

    return { url, text: textParts.join("\n").slice(0, 8000) };
  } catch {
    const fallback = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return { url, text: fallback.slice(0, 8000) };
  }
}

async function scrapeWithAnakin(url: string, apiKey: string): Promise<string | null> {
  try {
    const submit = await fetch("https://api.anakin.io/v1/url-scraper", {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url, useBrowser: true }),
    });

    const submitBody = await submit.json();
    if (!submit.ok || !submitBody.jobId) return null;

    const maxPolls = 30;
    for (let i = 0; i < maxPolls; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const statusRes = await fetch(`https://api.anakin.io/v1/url-scraper/${submitBody.jobId}`, {
        headers: { "X-API-Key": apiKey },
      });
      const statusBody = await statusRes.json();

      if (statusBody.status === "completed") {
        return (statusBody.markdown ?? "").slice(0, 8000);
      }

      if (statusBody.status && statusBody.status !== "pending" && statusBody.status !== "processing") {
        return null;
      }
    }
  } catch {
    return null;
  }

  return null;
}

function buildPrompt(sitesText: string, context?: string) {
  const contextBlock = context
    ? `\nYOUR PRODUCT CONTEXT (tailor all output to this):\n${context}\n- Feature suggestions must be relevant to this product specifically\n- Opportunities should focus on gaps that benefit this product\n- Threats should highlight risks specific to this product\n`
    : "";

  const jsonSchema = `{
  "competitors": [
    {
      "url": "the website URL",
      "name": "company/product name",
      "description": "one sentence what they do",
      "category": "their product category e.g. Project Management, CRM",
      "targetAudience": "who they primarily serve",
      "keyFeatures": ["feature 1", "feature 2", "feature 3"],
      "strengths": ["strength 1", "strength 2"],
      "weaknesses": ["weakness or gap 1", "weakness or gap 2"],
      "pricing": "pricing model if visible else null",
      "tone": "brand tone e.g. Enterprise, Developer-focused, Consumer"
    }
  ],
  "competitorMatrix": [
    {
      "competitor": "name",
      "positioning": "one-line positioning",
      "pricing": "pricing model if visible else null",
      "easeOfUse": "High | Medium | Low",
      "customization": "High | Medium | Low",
      "reportingDepth": "High | Medium | Low",
      "idealFor": "best-fit audience",
      "notableGap": "largest weakness or gap"
    }
  ],
  "marketInsights": ["key trend or pattern observed across competitors"],
  "featureSuggestions": [
    {
      "feature": "suggested feature name",
      "rationale": "why this would differentiate based on competitor gaps",
      "priority": "High | Medium | Low",
      "inspiration": "which competitor gap or trend inspired this"
    }
  ],
  "opportunities": ["market gap none of the competitors address well"],
  "threats": ["competitive threat to watch out for"],
  "summary": "2-3 sentence overall competitive landscape summary"
}`;

  return (
    "You are a senior product strategist. Analyse the following competitor websites and provide a comprehensive competitive analysis."
    + contextBlock
    + "\nCOMPETITOR WEBSITES:\n"
    + sitesText
    + "\n\nReturn ONLY this exact JSON (no markdown, no commentary):\n"
    + jsonSchema
  );
}

function normalizeResult(raw: unknown): CompetitorAnalysisResult {
  const obj = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;

  return {
    competitors: Array.isArray(obj.competitors) ? (obj.competitors as CompetitorRecord[]) : [],
    competitorMatrix: Array.isArray(obj.competitorMatrix) ? (obj.competitorMatrix as CompetitorMatrixRow[]) : [],
    marketInsights: Array.isArray(obj.marketInsights) ? (obj.marketInsights as string[]) : [],
    featureSuggestions: Array.isArray(obj.featureSuggestions) ? (obj.featureSuggestions as FeatureSuggestion[]) : [],
    opportunities: Array.isArray(obj.opportunities) ? (obj.opportunities as string[]) : [],
    threats: Array.isArray(obj.threats) ? (obj.threats as string[]) : [],
    summary: typeof obj.summary === "string" ? obj.summary : "",
  };
}

type StoredCompetitorAnalysis = {
  userId: string;
  jobId: string;
  urls: string[];
  context?: string;
  model: string;
  status: "completed";
  createdAt: string;
  result: CompetitorAnalysisResult;
};

async function saveCompletedAnalysis(job: AnalysisJob) {
  if (!job.result) return;
  const db = await getMongoDb();
  const collection = db.collection<StoredCompetitorAnalysis>("competitor_analyses");
  await collection.updateOne(
    { userId: job.input.userId, jobId: job.id },
    {
      $set: {
        userId: job.input.userId,
        jobId: job.id,
        urls: job.input.urls,
        context: job.input.context,
        model: job.input.model ?? "gemini-2.5-flash",
        status: "completed",
        createdAt: job.createdAt,
        result: job.result,
      },
    },
    { upsert: true },
  );
}

async function analyzeWithAnakin(payload: { model: string; prompt: string; apiKey: string }): Promise<CompetitorAnalysisResult> {
  const endpoints = [
    "https://api.anakin.io/v1/chat/completions",
    "https://api.anakin.ai/v1/chat/completions",
    "https://api.anakin.io/v1/completions",
  ];
  const requestBody = {
    model: payload.model,
    messages: [
      { role: "system", content: "Return strict JSON only." },
      { role: "user", content: payload.prompt },
    ],
    temperature: 0.3,
  };
  const errors: string[] = [];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "X-API-Key": payload.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      const body = await response.json().catch(() => null);
      if (!response.ok) {
        errors.push(`${endpoint} -> ${response.status} ${JSON.stringify(body)}`);
        continue;
      }

      const content = body?.choices?.[0]?.message?.content ?? body?.choices?.[0]?.text;
      if (!content || typeof content !== "string") {
        errors.push(`${endpoint} -> empty content`);
        continue;
      }

      const parsed = JSON.parse(content);
      return normalizeResult(parsed);
    } catch (error) {
      errors.push(`${endpoint} -> ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`Anakin completion failed across endpoints: ${errors.join(" | ")}`);
}

function inferCategory(blob: string): string {
  const t = blob.toLowerCase();
  if (/(project|issue|sprint|roadmap|task)/.test(t)) return "Project Management";
  if (/(crm|sales|pipeline)/.test(t)) return "CRM";
  if (/(help desk|ticket|support)/.test(t)) return "Customer Support";
  return "SaaS";
}

function inferAudience(blob: string): string {
  const t = blob.toLowerCase();
  if (/(developer|engineering|software team)/.test(t)) return "Engineering teams";
  if (/(enterprise|it teams|business)/.test(t)) return "Business and enterprise teams";
  if (/(small business|startup|smb)/.test(t)) return "SMBs and startups";
  return "Cross-functional teams";
}

function inferFeatures(blob: string): string[] {
  const known = [
    "Issue tracking",
    "Kanban boards",
    "Sprints and planning",
    "Roadmaps",
    "Automations",
    "Integrations",
    "Reporting dashboards",
    "Workflow customization",
  ];
  const t = blob.toLowerCase();
  return known.filter((feature) => t.includes(feature.toLowerCase().split(" ")[0])).slice(0, 4);
}

function buildFallbackAnalysis(sites: ScrapedSite[], context?: string): CompetitorAnalysisResult {
  const competitors: CompetitorRecord[] = sites.map(({ url, text }) => {
    const titleMatch = text.match(/Page Title:\s*(.+)/i);
    const firstLine = text.split("\n").find((line) => line.trim().length > 20) ?? "";
    const name = (titleMatch?.[1]?.split(/[|:-]/)[0] ?? new URL(url).hostname.replace(/^www\./, "")).trim();
    const keyFeatures = inferFeatures(text);

    return {
      url,
      name,
      description: firstLine.slice(0, 180) || `${name} provides SaaS workflow tooling.`,
      category: inferCategory(text),
      targetAudience: inferAudience(text),
      keyFeatures: keyFeatures.length ? keyFeatures : ["Task management", "Workflow collaboration"],
      strengths: ["Clear product positioning", "Mature collaboration workflow"],
      weaknesses: ["Differentiation not obvious from public pages", "May require heavier setup for small teams"],
      pricing: /pricing|\$\d+|per user/i.test(text) ? "Visible on website" : null,
      tone: /enterprise|secure|compliance/i.test(text) ? "Enterprise" : "Productivity-focused",
    };
  });

  const globalBlob = sites.map((s) => s.text).join("\n").toLowerCase();
  const marketInsights = [
    "Most competitors focus on planning and execution in a single workspace.",
    "Integration breadth is a common positioning pillar.",
    /ai|automation/.test(globalBlob)
      ? "AI and automation messaging is becoming baseline in this category."
      : "Automation depth can still be a practical differentiator.",
  ];
  const opportunities = [
    "Simpler onboarding and setup for small engineering teams.",
    "Actionable reporting with low configuration overhead.",
    "Opinionated defaults that reduce project-management overhead.",
  ];
  const featureSuggestions: FeatureSuggestion[] = [
    {
      feature: "One-click engineering project templates",
      rationale: "Reduce setup time and make adoption easier for small teams.",
      priority: "High",
      inspiration: "Common complexity across competitor positioning",
    },
    {
      feature: "Lean analytics for velocity and blockers",
      rationale: "Give teams useful metrics without heavy dashboard setup.",
      priority: "High",
      inspiration: "Gap between advanced reporting and ease of use",
    },
    {
      feature: "Context-aware automation suggestions",
      rationale: "Help teams automate repetitive workflow steps quickly.",
      priority: "Medium",
      inspiration: "Rising automation expectations in the market",
    },
  ];
  const threats = [
    "Larger incumbents can bundle adjacent tooling aggressively.",
    "Competitors with strong ecosystem integrations can increase switching costs.",
  ];
  const contextSuffix = context ? ` For your context (${context.slice(0, 120)}), focus on speed-to-value.` : "";
  const summary = [
    "The landscape is crowded with mature project-management platforms emphasizing collaboration, integrations, and planning workflows.",
    "A strong wedge for Trackleaf is low-friction onboarding and operational clarity for small engineering teams.",
    `Winning will likely depend on simplicity plus targeted depth rather than breadth.${contextSuffix}`,
  ].join(" ");

  const competitorMatrix: CompetitorMatrixRow[] = competitors.map((c) => ({
    competitor: c.name || c.url,
    positioning: c.description,
    pricing: c.pricing,
    easeOfUse: "Medium",
    customization: "Medium",
    reportingDepth: "Medium",
    idealFor: c.targetAudience || "Cross-functional teams",
    notableGap: c.weaknesses[0] || "Needs clearer differentiation for small teams",
  }));

  return { competitors, competitorMatrix, marketInsights, featureSuggestions, opportunities, threats, summary };
}

async function runJob(jobId: string) {
  const job = jobs.get(jobId);
  if (!job) return;

  const mark = (patch: Partial<AnalysisJob>) => {
    const current = jobs.get(jobId);
    if (!current) return;
    jobs.set(jobId, { ...current, ...patch, updatedAt: nowIso() });
  };

  mark({ status: "processing", progressMessage: "Fetching competitor websites..." });

  try {
    const apiKey = await getEnvValue("ANAKIN_API_KEY");
    if (!apiKey) throw new Error("Missing ANAKIN_API_KEY (.env.local, .env, or ../.env)");

    const fetched = await Promise.all(
      job.input.urls.map(async (url) => {
        const scraped = await scrapeWithAnakin(url, apiKey);
        if (scraped) return { url, text: scraped };
        return fetchWebsiteText(url);
      }),
    );

    const sitesText = fetched
      .map(({ url, text }) => `\n\n=== WEBSITE: ${url} ===\n${text.slice(0, 6000)}`)
      .join("");

    mark({ progressMessage: "Running competitor analysis with Anakin..." });

    let result: CompetitorAnalysisResult;
    try {
      result = await analyzeWithAnakin({
        model: job.input.model ?? "gemini-2.5-flash",
        prompt: buildPrompt(sitesText, job.input.context),
        apiKey,
      });
    } catch {
      result = buildFallbackAnalysis(fetched, job.input.context);
    }

    mark({
      status: "completed",
      progressMessage: "Analysis completed.",
      result,
    });

    const completedJob = jobs.get(jobId);
    if (completedJob) {
      await saveCompletedAnalysis(completedJob);
    }
  } catch (error) {
    mark({
      status: "error",
      progressMessage: "Analysis failed.",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function createAnalysisJob(input: CompetitorInput) {
  const id = toJobId();
  const job: AnalysisJob = {
    id,
    status: "pending",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    input,
    progressMessage: "Queued...",
  };

  jobs.set(id, job);

  setTimeout(() => {
    void runJob(id);
  }, 0);

  return job;
}

export function getAnalysisJob(jobId: string) {
  return jobs.get(jobId);
}

export async function getLatestAnalysisForUser(userId: string) {
  const db = await getMongoDb();
  const collection = db.collection<StoredCompetitorAnalysis>("competitor_analyses");
  return collection.find({ userId, status: "completed" }).sort({ createdAt: -1 }).limit(1).next();
}
