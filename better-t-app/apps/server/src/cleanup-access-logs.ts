import { initializeDatabase } from "@better-t-app/db";
import { env } from "@better-t-app/env/server";

import { cleanupAccessLogs } from "./file-service";

await initializeDatabase();
const result = await cleanupAccessLogs(env.ACCESS_LOG_RETENTION_DAYS);
console.log(JSON.stringify(result));
