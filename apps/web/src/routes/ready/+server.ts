import type { RequestHandler } from "./$types";
import { app } from "$lib/server/app";

export const GET: RequestHandler = async ({ request }) => {
  return app.fetch(request);
};
