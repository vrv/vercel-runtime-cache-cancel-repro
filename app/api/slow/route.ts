import { instanceInfo } from "@/lib/instance";

export const dynamic = "force-dynamic";

// A request to have in flight while /api/crash runs on the same instance.
export async function GET(request: Request) {
  const seconds = Number(new URL(request.url).searchParams.get("s") ?? "15");
  const started = instanceInfo();
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  return Response.json({ started, finished: instanceInfo() });
}
