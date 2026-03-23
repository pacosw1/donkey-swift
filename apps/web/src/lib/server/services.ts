import { env } from "$env/dynamic/private";
import { db } from "./db.js";

import { createAuthService } from "donkey-swift/auth";
import { createEngageService } from "donkey-swift/engage";
import { createNotifyService } from "donkey-swift/notify";
import { createChatService } from "donkey-swift/chat";
import { createSyncService } from "donkey-swift/sync";
import { createFlagsService } from "donkey-swift/flags";
import { createReceiptService } from "donkey-swift/receipt";
import { createLifecycleService } from "donkey-swift/lifecycle";
import { createAccountService } from "donkey-swift/account";
import { createAnalyticsService } from "donkey-swift/analytics";
import { createHealthService } from "donkey-swift/health";
import { createLogBuffer } from "donkey-swift/logbuf";

import { createPostgresStores } from "donkey-swift/postgres";

const stores = createPostgresStores(db);
const logBuffer = createLogBuffer({ maxLines: 5000 });

export const auth = createAuthService({
  db: stores.auth,
  appleTeamId: env.APPLE_TEAM_ID ?? "",
  appleBundleId: env.APPLE_BUNDLE_ID ?? "",
  jwtSecret: env.JWT_SECRET ?? "dev-secret",
});

export const engage = createEngageService({ db: stores.engage });
export const notify = createNotifyService({ db: stores.notify });
export const chat = createChatService({ db: stores.chat });
export const sync = createSyncService({ db: stores.sync });
export const flags = createFlagsService({ db: stores.flags });
export const receipt = createReceiptService({ db: stores.receipt });
export const lifecycle = createLifecycleService({ db: stores.lifecycle });
export const account = createAccountService({ db: stores.account });
export const analytics = createAnalyticsService({ db: stores.analytics });
export const health = createHealthService({ db });

export { logBuffer };
