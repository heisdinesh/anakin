import { NextResponse } from "next/server";
import { listActions } from "@/lib/actions";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = (searchParams.get("userId") ?? "").trim();
  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const actions = await listActions(userId);
  return NextResponse.json({ status: "success", count: actions.length, actions });
}
