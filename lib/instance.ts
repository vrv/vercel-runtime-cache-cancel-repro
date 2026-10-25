import { randomUUID } from "node:crypto";

// One value per process, so responses show which instance served them.
export const INSTANCE_ID = randomUUID().slice(0, 8);

export function instanceInfo() {
  return {
    instance: INSTANCE_ID,
    pid: process.pid,
    uptimeSeconds: Math.round(process.uptime()),
    region: process.env.VERCEL_REGION ?? null,
    node: process.version,
  };
}
