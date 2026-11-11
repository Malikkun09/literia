import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  let database: "up" | "down" = "up";
  try {
    await db.$queryRaw`SELECT 1`;
  } catch {
    database = "down";
  }
  const status = database === "up" ? 200 : 503;
  return NextResponse.json(
    { status: database === "up" ? "ok" : "degraded", database, service: "literia" },
    { status },
  );
}
