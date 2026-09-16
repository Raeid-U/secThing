import { NextResponse } from "next/server";

const backendUrl = process.env.BACKEND_API_URL ?? "http://localhost:8080";

export async function GET() {
  try {
    const response = await fetch(`${backendUrl}/ready`, { cache: "no-store" });
    const body: unknown = await response.json();
    return NextResponse.json(body, { status: response.status });
  } catch {
    return NextResponse.json(
      { status: "not_ready", checks: [], detail: "The secThing backend is unavailable." },
      { status: 503 },
    );
  }
}
