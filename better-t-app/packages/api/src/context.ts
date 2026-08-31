import { auth } from "@better-t-app/auth";
import type { Context as HonoContext } from "hono";

export type CreateContextOptions = {
  context: HonoContext;
  clientIp?: string;
};

export async function createContext({ context, clientIp = "unknown" }: CreateContextOptions) {
  const session = await auth.api.getSession({
    headers: context.req.raw.headers,
  });
  return {
    auth: null,
    clientIp,
    session,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
