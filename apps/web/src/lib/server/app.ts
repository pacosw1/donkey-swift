import { env } from "$env/dynamic/private";
import { createApp } from "donkey-swift/app";
import {
  auth,
  engage,
  notify,
  chat,
  sync,
  flags,
  receipt,
  lifecycle,
  account,
  analytics,
  health,
  logBuffer,
} from "./services.js";

export const app = createApp({
  apiVersion: env.API_VERSION ?? "1.0.0",
  minimumVersion: env.MINIMUM_VERSION ?? "1.0.0",
  corsOrigins: env.CORS_ORIGINS ?? "*",
  authConfig: {
    jwtSecret: env.JWT_SECRET ?? "dev-secret",
  },
  adminConfig: {
    adminEmails: (env.ADMIN_EMAILS ?? "").split(",").filter(Boolean),
    jwtSecret: env.JWT_SECRET ?? "dev-secret",
  },
  auth,
  engage,
  notify,
  chat,
  sync,
  flags,
  receipt,
  lifecycle,
  account,
  analytics,
  health,
  logBuffer,
});
