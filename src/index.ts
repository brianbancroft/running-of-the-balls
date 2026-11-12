import app from "./app";
import { expireDueHolds } from "./reservations";

export default {
  fetch(request: Request, env: CloudflareBindings, ctx: ExecutionContext) {
    return app.fetch(request, env, ctx);
  },
  scheduled(_controller: ScheduledController, env: CloudflareBindings, ctx: ExecutionContext) {
    ctx.waitUntil(expireDueHolds(env.DB));
  },
} satisfies ExportedHandler<CloudflareBindings>;
