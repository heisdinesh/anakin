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

export type GtmPlan = {
  targetAudience: string[];
  valueProposition: string[];
  positioningAndMessaging: string[];
  pricing: string[];
  distributionChannels: string[];
  customerAcquisition: string[];
  successMetrics: string[];
};

export type CompetitorAnalysisResult = {
  competitors: CompetitorRecord[];
  competitorMatrix: CompetitorMatrixRow[];
  marketInsights: string[];
  featureSuggestions: FeatureSuggestion[];
  opportunities: string[];
  threats: string[];
  summary: string;
  gtmPlan?: GtmPlan;
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
  fallbackUsed?: boolean;
  fallbackReason?: string;
};

type ScrapedSite = {
  url: string;
  text: string;
};

const jobs = new Map<string, AnalysisJob>();

function nowIso() {
  return new Date().toISOString();
}

function logStep(jobId: string, step: string, details?: unknown) {
  const prefix = `[competitor-analysis][${jobId}] ${step}`;
  if (details === undefined) {
    console.info(prefix);
    return;
  }
  console.info(prefix, details);
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
  "summary": "2-3 sentence overall competitive landscape summary",
  "gtmPlan": {
    "targetAudience": ["ideal customers or segments"],
    "valueProposition": ["why the product matters"],
    "positioningAndMessaging": ["positioning and key messaging points"],
    "pricing": ["pricing strategy options"],
    "distributionChannels": ["sales, ads, partners, app stores, etc."],
    "customerAcquisition": ["campaigns, outbound, SEO, referrals"],
    "successMetrics": ["revenue, conversion rate, CAC, retention"]
  }
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
  const gtm = (typeof obj.gtmPlan === "object" && obj.gtmPlan !== null ? obj.gtmPlan : {}) as Record<string, unknown>;

  return {
    competitors: Array.isArray(obj.competitors) ? (obj.competitors as CompetitorRecord[]) : [],
    competitorMatrix: Array.isArray(obj.competitorMatrix) ? (obj.competitorMatrix as CompetitorMatrixRow[]) : [],
    marketInsights: Array.isArray(obj.marketInsights) ? (obj.marketInsights as string[]) : [],
    featureSuggestions: Array.isArray(obj.featureSuggestions) ? (obj.featureSuggestions as FeatureSuggestion[]) : [],
    opportunities: Array.isArray(obj.opportunities) ? (obj.opportunities as string[]) : [],
    threats: Array.isArray(obj.threats) ? (obj.threats as string[]) : [],
    summary: typeof obj.summary === "string" ? obj.summary : "",
    gtmPlan: {
      targetAudience: Array.isArray(gtm.targetAudience) ? (gtm.targetAudience as string[]) : [],
      valueProposition: Array.isArray(gtm.valueProposition) ? (gtm.valueProposition as string[]) : [],
      positioningAndMessaging: Array.isArray(gtm.positioningAndMessaging) ? (gtm.positioningAndMessaging as string[]) : [],
      pricing: Array.isArray(gtm.pricing) ? (gtm.pricing as string[]) : [],
      distributionChannels: Array.isArray(gtm.distributionChannels) ? (gtm.distributionChannels as string[]) : [],
      customerAcquisition: Array.isArray(gtm.customerAcquisition) ? (gtm.customerAcquisition as string[]) : [],
      successMetrics: Array.isArray(gtm.successMetrics) ? (gtm.successMetrics as string[]) : [],
    },
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

function extractJsonObject(input: string) {
  const trimmed = input.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in model response");
  }
  return candidate.slice(start, end + 1);
}

async function analyzeWithGeminiDirect(payload: { model: string; prompt: string; apiKey: string }): Promise<CompetitorAnalysisResult> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(payload.model)}:generateContent?key=${encodeURIComponent(payload.apiKey)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: `${payload.prompt}\n\nIMPORTANT: Return strict JSON only.` }],
        },
      ],
      generationConfig: {
        temperature: 0.3,
      },
    }),
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Gemini direct failed: ${response.status} ${JSON.stringify(body)}`);
  }

  const text =
    body?.candidates?.[0]?.content?.parts
      ?.map((p: { text?: string }) => p?.text ?? "")
      .join("\n")
      ?.trim() ?? "";
  if (!text) {
    throw new Error("Gemini direct returned empty content");
  }

  const jsonText = extractJsonObject(text);
  const parsed = JSON.parse(jsonText);
  return normalizeResult(parsed);
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
    "A strong wedge for Trackleaf GTM Radar is low-friction onboarding and operational clarity for small engineering teams.",
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

  const gtmPlan: GtmPlan = {
    targetAudience: ["Small engineering teams", "Startup product teams", "Cross-functional delivery teams"],
    valueProposition: ["Decide what to build with evidence from competitor and customer signals"],
    positioningAndMessaging: ["From signal to shipped roadmap decisions", "Decision intelligence for faster GTM execution"],
    pricing: ["Freemium for teams getting started", "Per-seat growth plan", "Enterprise plan with governance and integrations"],
    distributionChannels: ["Product-led onboarding", "Founder-led outbound to PM leaders", "Content + community + SEO"],
    customerAcquisition: ["Comparison landing pages", "Use-case based demos", "Referral loop from shared reports"],
    successMetrics: ["Activation rate", "Lead-to-trial conversion", "Trial-to-paid conversion", "Retention and expansion"],
  };

  return { competitors, competitorMatrix, marketInsights, featureSuggestions, opportunities, threats, summary, gtmPlan };
}

async function runJob(jobId: string) {
  const job = jobs.get(jobId);
  if (!job) return;

  const mark = (patch: Partial<AnalysisJob>) => {
    const current = jobs.get(jobId);
    if (!current) return;
    jobs.set(jobId, { ...current, ...patch, updatedAt: nowIso() });
  };

  logStep(jobId, "job_started", {
    urls: job.input.urls.length,
    model: job.input.model ?? "gemini-2.5-flash",
    hasContext: Boolean(job.input.context?.trim()),
  });
  mark({ status: "processing", progressMessage: "Fetching competitor websites..." });

  try {
    const apiKey = await getEnvValue("ANAKIN_API_KEY");
    if (!apiKey) throw new Error("Missing ANAKIN_API_KEY (.env.local, .env, or ../.env)");
    logStep(jobId, "anakin_api_key_loaded");

    const fetched = await Promise.all(
      job.input.urls.map(async (url) => {
        logStep(jobId, "scrape_start", { url });
        const scraped = await scrapeWithAnakin(url, apiKey);
        if (scraped) {
          logStep(jobId, "scrape_done_anakin", { url, chars: scraped.length });
          return { url, text: scraped };
        }
        logStep(jobId, "scrape_fallback_html", { url });
        return fetchWebsiteText(url);
      }),
    );
    logStep(jobId, "fetch_complete", {
      urls: fetched.length,
      chars: fetched.reduce((sum, item) => sum + item.text.length, 0),
    });

    const sitesText = fetched
      .map(({ url, text }) => `\n\n=== WEBSITE: ${url} ===\n${text.slice(0, 6000)}`)
      .join("");

    mark({ progressMessage: "Running competitor analysis with Anakin..." });

    let result: CompetitorAnalysisResult;
    const failures: string[] = [];
    try {
      logStep(jobId, "anakin_llm_start");
      result = await analyzeWithAnakin({
        model: job.input.model ?? "gemini-2.5-flash",
        prompt: buildPrompt(sitesText, job.input.context),
        apiKey,
      });
      logStep(jobId, "anakin_llm_success");
      mark({ fallbackUsed: false, fallbackReason: undefined });
    } catch (error) {
      logStep(jobId, "anakin_llm_failed", error instanceof Error ? error.message : String(error));
      failures.push(`Anakin: ${error instanceof Error ? error.message : String(error)}`);
      const geminiKey = await getEnvValue("GEMINI_API_KEY");
      if (geminiKey) {
        try {
          logStep(jobId, "gemini_direct_start");
          result = await analyzeWithGeminiDirect({
            model: job.input.model ?? "gemini-2.5-flash",
            prompt: buildPrompt(sitesText, job.input.context),
            apiKey: geminiKey,
          });
          logStep(jobId, "gemini_direct_success");
          mark({ fallbackUsed: false, fallbackReason: undefined, progressMessage: "Analysis completed via Gemini direct API." });
        } catch (geminiError) {
          logStep(jobId, "gemini_direct_failed", geminiError instanceof Error ? geminiError.message : String(geminiError));
          failures.push(`GeminiDirect: ${geminiError instanceof Error ? geminiError.message : String(geminiError)}`);
          mark({
            fallbackUsed: true,
            fallbackReason: failures.join(" | "),
            progressMessage: "LLM analysis failed; using fallback analysis.",
          });
          logStep(jobId, "using_static_fallback");
          result = buildFallbackAnalysis(fetched, job.input.context);
        }
      } else {
        logStep(jobId, "gemini_key_missing");
        failures.push("GeminiDirect: Missing GEMINI_API_KEY");
        mark({
          fallbackUsed: true,
          fallbackReason: failures.join(" | "),
          progressMessage: "LLM analysis failed; using fallback analysis.",
        });
        logStep(jobId, "using_static_fallback");
        result = buildFallbackAnalysis(fetched, job.input.context);
      }
    }

    mark({
      status: "completed",
      progressMessage: "Analysis completed.",
      result,
    });

    const completedJob = jobs.get(jobId);
    if (completedJob) {
      await saveCompletedAnalysis(completedJob);
      logStep(jobId, "saved_to_mongodb", {
        competitors: completedJob.result?.competitors?.length ?? 0,
        features: completedJob.result?.featureSuggestions?.length ?? 0,
        fallbackUsed: completedJob.fallbackUsed ?? false,
      });
    }
    logStep(jobId, "job_completed");
  } catch (error) {
    logStep(jobId, "job_failed", error instanceof Error ? error.message : String(error));
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
