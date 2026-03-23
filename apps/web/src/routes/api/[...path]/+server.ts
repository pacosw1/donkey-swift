import type { RequestHandler } from "./$types";
import { app } from "$lib/server/app";

const handler: RequestHandler = async ({ request }) => {
  const response = await app.fetch(request);
  return response;
};

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
export const OPTIONS = handler;
