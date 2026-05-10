import { NextResponse } from "next/server";
import { createActionsJob } from "@/lib/actions";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const userId = typeof body?.userId === "string" ? body.userId.trim() : "";

  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const job = createActionsJob(userId);
  return NextResponse.json({ status: "accepted", jobId: job.id, message: "Action generation started." }, { status: 202 });
}
