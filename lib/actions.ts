import { ObjectId } from "mongodb";
import { getMongoDb } from "@/lib/mongo";
import type { ReviewRecord } from "@/lib/reviews-scraper";
import type { CompetitorAnalysisResult } from "@/lib/competitor-analysis";

type JobStatus = "pending" | "processing" | "completed" | "error";
export type ActionStatus = "todo" | "inprogress" | "done";

export type ProductAction = {
  _id?: ObjectId;
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

export type ActionsJob = {
  id: string;
  userId: string;
  status: JobStatus;
  progressMessage: string;
  createdAt: string;
  updatedAt: string;
  reviewsScanned: number;
  analysisSuggestionsScanned: number;
  actionsCreated: number;
  error?: string;
};

const jobs = new Map<string, ActionsJob>();

function nowIso() {
  return new Date().toISOString();
}

function toJobId() {
  return `actions_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function toPriority(sentiment: ReviewRecord["sentimentLabel"], text: string): "High" | "Medium" | "Low" {
  if (sentiment === "negative") return "High";
  if (sentiment === "positive" && /love|best|excellent|amazing/.test(text.toLowerCase())) return "Medium";
  return "Low";
}

function cleanReviewText(text: string) {
  return text
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isActionableReview(review: ReviewRecord, cleaned: string) {
  const lower = cleaned.toLowerCase();
  const issueKeywords = /(bug|issue|problem|slow|confusing|broken|crash|doesn'?t work|missing)/;
  const requestKeywords = /(need|wish|should have|please add|would love|feature request|improve)/;

  // Strong negative signals should become actions.
  if (review.sentimentLabel === "negative" && issueKeywords.test(lower)) return true;
  // Positive/neutral only if they express explicit request/improvement cue.
  if ((review.sentimentLabel === "positive" || review.sentimentLabel === "neutral") && requestKeywords.test(lower)) return true;

  return false;
}

function inferTheme(text: string) {
  const t = text.toLowerCase();
  if (/(bug|broken|crash|error|doesn'?t work)/.test(t)) return "stability";
  if (/(slow|performance|lag|speed)/.test(t)) return "performance";
  if (/(ux|ui|confusing|hard|difficult|onboarding|setup)/.test(t)) return "usability";
  if (/(integration|api|sync|import|export)/.test(t)) return "integrations";
  if (/(report|analytics|dashboard|metrics)/.test(t)) return "reporting";
  if (/(automation|workflow|rule|template)/.test(t)) return "automation";
  return "general";
}

type ClusteredReviewSignal = {
  userId: string;
  competitorKey: string;
  competitorName: string;
  sentimentLabel: "positive" | "neutral" | "negative";
  theme: string;
  priority: "High" | "Medium" | "Low";
  count: number;
  sample: string;
};

function buildActionFromCluster(cluster: ClusteredReviewSignal): ProductAction {
  const isNegative = cluster.sentimentLabel === "negative";
  const isPositive = cluster.sentimentLabel === "positive";
  const title = isNegative
    ? `Fix ${cluster.theme} issue seen in ${cluster.competitorName} feedback`
    : isPositive
      ? `Evaluate ${cluster.theme} strength from ${cluster.competitorName}`
      : `Validate ${cluster.theme} opportunity from ${cluster.competitorName}`;

  const insight = isNegative
    ? `${cluster.count} users reported related pain points. Sample: "${cluster.sample}". Add fix scope and owner.`
    : isPositive
      ? `${cluster.count} users praised this area. Sample: "${cluster.sample}". Decide parity vs differentiation.`
      : `${cluster.count} mixed/neutral signals found. Sample: "${cluster.sample}". Validate via interviews before building.`;

  const now = nowIso();
  return {
    userId: cluster.userId,
    source: "reviews",
    competitorKey: cluster.competitorKey,
    competitorName: cluster.competitorName,
    title,
    insight,
    priority: cluster.priority,
    sentimentLabel: cluster.sentimentLabel,
    status: "todo",
    createdAt: now,
    updatedAt: now,
  };
}

function clusterReviewSignals(reviews: ReviewRecord[]) {
  const grouped = new Map<string, ClusteredReviewSignal>();

  for (const review of reviews) {
    const cleaned = cleanReviewText(review.content);
    if (cleaned.length < 40 || !isActionableReview(review, cleaned)) continue;

    const theme = inferTheme(cleaned);
    const key = `${review.competitorKey}|${review.sentimentLabel}|${theme}`;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        userId: review.userId,
        competitorKey: review.competitorKey,
        competitorName: review.competitorName,
        sentimentLabel: review.sentimentLabel,
        theme,
        priority: toPriority(review.sentimentLabel, cleaned),
        count: 1,
        sample: cleaned.slice(0, 160),
      });
      continue;
    }

    existing.count += 1;
    if (cleaned.length > existing.sample.length) {
      existing.sample = cleaned.slice(0, 160);
    }
    if (existing.priority !== "High" && review.sentimentLabel === "negative") {
      existing.priority = "High";
    }
  }

  return [...grouped.values()]
    .filter((s) => s.count >= 2 || s.sentimentLabel === "negative")
    .sort((a, b) => {
      if (a.priority !== b.priority) {
        const rank = (p: ProductAction["priority"]) => (p === "High" ? 3 : p === "Medium" ? 2 : 1);
        return rank(b.priority) - rank(a.priority);
      }
      return b.count - a.count;
    });
}

type StoredCompetitorAnalysis = {
  userId: string;
  jobId: string;
  createdAt: string;
  result: CompetitorAnalysisResult;
};

function buildActionFromFeatureSuggestion(userId: string, suggestion: CompetitorAnalysisResult["featureSuggestions"][number]): ProductAction {
  const now = nowIso();
  return {
    userId,
    source: "competitor_analysis",
    competitorKey: "market",
    competitorName: "Market Opportunity",
    title: `Build: ${suggestion.feature}`,
    insight: `${suggestion.rationale} (Inspired by: ${suggestion.inspiration})`,
    priority: suggestion.priority,
    sentimentLabel: "neutral",
    status: "todo",
    createdAt: now,
    updatedAt: now,
  };
}

export async function createActionsFromFeatureSuggestions(
  userId: string,
  suggestions: CompetitorAnalysisResult["featureSuggestions"],
) {
  const selected = suggestions
    .filter((s) => s?.feature && (s.priority === "High" || s.priority === "Medium" || s.priority === "Low"))
    .map((s) => buildActionFromFeatureSuggestion(userId, s));

  if (!selected.length) return { created: 0 };
  const actions = dedupeAndCapActions(selected, 30);
  const created = await saveActions(actions);
  return { created };
}

async function saveActions(actions: ProductAction[]) {
  const db = await getMongoDb();
  const col = db.collection<ProductAction>("product_actions");
  let created = 0;

  for (const action of actions) {
    const existing = await col.findOne({
      userId: action.userId,
      competitorKey: action.competitorKey,
      title: action.title,
      insight: action.insight,
    });

    if (!existing) {
      await col.insertOne(action);
      created += 1;
    }
  }

  return created;
}

async function cleanupPendingGeneratedActions(userId: string) {
  const db = await getMongoDb();
  const col = db.collection<ProductAction>("product_actions");
  await col.deleteMany({
    userId,
    source: { $in: ["reviews", "competitor_analysis"] },
    status: "todo",
  });
}

function dedupeAndCapActions(actions: ProductAction[], maxItems = 15) {
  const unique = new Map<string, ProductAction>();
  for (const action of actions) {
    const key = `${action.source}|${action.competitorKey}|${action.title.toLowerCase()}`;
    if (!unique.has(key)) {
      unique.set(key, action);
    }
  }

  return [...unique.values()]
    .sort((a, b) => {
      const rank = (p: ProductAction["priority"]) => (p === "High" ? 3 : p === "Medium" ? 2 : 1);
      return rank(b.priority) - rank(a.priority);
    })
    .slice(0, maxItems);
}

async function runJob(jobId: string) {
  const job = jobs.get(jobId);
  if (!job) return;

  const patch = (p: Partial<ActionsJob>) => {
    const current = jobs.get(jobId);
    if (!current) return;
    jobs.set(jobId, { ...current, ...p, updatedAt: nowIso() });
  };

  try {
    patch({ status: "processing", progressMessage: "Loading reviews..." });

    const db = await getMongoDb();
    const reviewsCol = db.collection<ReviewRecord>("producthunt_reviews");
    const analysesCol = db.collection<StoredCompetitorAnalysis>("competitor_analyses");
    const reviews = await reviewsCol
      .find({ userId: job.userId })
      .sort({ scrapedAt: -1 })
      .limit(300)
      .toArray();
    const latestAnalysis = await analysesCol.find({ userId: job.userId }).sort({ createdAt: -1 }).limit(1).next();
    const featureSuggestions = latestAnalysis?.result?.featureSuggestions ?? [];

    patch({
      reviewsScanned: reviews.length,
      analysisSuggestionsScanned: featureSuggestions.length,
      progressMessage: "Analyzing reviews + market priorities and creating actions...",
    });

    const selected = reviews
      .sort((a, b) => Math.abs(b.sentimentScore) - Math.abs(a.sentimentScore))
      .slice(0, 200);
    const reviewSignals = clusterReviewSignals(selected);
    const reviewActions = reviewSignals.slice(0, 8).map((signal) => buildActionFromCluster(signal));

    const analysisActions = featureSuggestions
      .filter((s) => s.priority === "High" || s.priority === "Medium")
      .slice(0, 8)
      .map((s) => buildActionFromFeatureSuggestion(job.userId, s));

    const actions = dedupeAndCapActions([...analysisActions, ...reviewActions], 12);
    await cleanupPendingGeneratedActions(job.userId);
    const actionsCreated = await saveActions(actions);

    patch({
      status: "completed",
      progressMessage: "Actions created successfully.",
      actionsCreated,
    });
  } catch (error) {
    patch({
      status: "error",
      progressMessage: "Action generation failed.",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function createActionsJob(userId: string) {
  const job: ActionsJob = {
    id: toJobId(),
    userId,
    status: "pending",
    progressMessage: "Queued...",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    reviewsScanned: 0,
    analysisSuggestionsScanned: 0,
    actionsCreated: 0,
  };

  jobs.set(job.id, job);
  setTimeout(() => {
    void runJob(job.id);
  }, 0);
  return job;
}

export function getActionsJob(jobId: string) {
  return jobs.get(jobId);
}

export async function listActions(userId: string) {
  const db = await getMongoDb();
  const col = db.collection<ProductAction>("product_actions");
  const actions = await col.find({ userId }).sort({ createdAt: -1 }).toArray();
  return actions.map((a) => ({ ...a, _id: a._id?.toString() }));
}

export async function updateActionStatus(userId: string, actionId: string, status: ActionStatus) {
  const db = await getMongoDb();
  const col = db.collection<ProductAction>("product_actions");

  const result = await col.findOneAndUpdate(
    { _id: new ObjectId(actionId), userId },
    { $set: { status, updatedAt: nowIso() } },
    { returnDocument: "after" },
  );

  if (!result) return null;
  return { ...result, _id: result._id?.toString() };
}
