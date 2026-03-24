import { type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";
import type { AuthDB } from "../auth/index.js";
import type { EngageDB } from "../engage/index.js";
import type { NotifyDB } from "../notify/index.js";
import type { ChatDB } from "../chat/index.js";
import type { SyncDB } from "../sync/index.js";
import type { FlagsDB } from "../flags/index.js";
import type { ReceiptDB } from "../receipt/index.js";
import type { AccountDB } from "../account/index.js";
import type { LifecycleDB } from "../lifecycle/index.js";
import type { AnalyticsDB } from "../analytics/index.js";
import type { AttestDB } from "../attest/index.js";
import { withAuthDB } from "./auth.js";
import { withEngageDB } from "./engage.js";
import { withNotifyDB } from "./notify.js";
import { withChatDB } from "./chat.js";
import { withSyncDB } from "./sync.js";
import { withFlagsDB } from "./flags.js";
import { withReceiptDB } from "./receipt.js";
import { withAccountDB } from "./account.js";
import { withLifecycleDB } from "./lifecycle.js";
import { withAnalyticsDB } from "./analytics.js";
import { withAttestDB } from "./attest.js";

export type DrizzleDB = PostgresJsDatabase<typeof schema>;

/**
 * PostgreSQL implementation of all donkeygo DB interfaces.
 *
 * Note: ChatDB and LifecycleDB define `enabledDeviceTokens` returning `string[]`,
 * while NotifyDB returns `DeviceToken[]`. Use `chatDB()` and `lifecycleDB()` accessors
 * for those interfaces, or pass `PostgresDB` directly where only one is needed.
 */
export class PostgresDB implements AuthDB, EngageDB, NotifyDB, SyncDB, FlagsDB, ReceiptDB, AccountDB, AnalyticsDB {
  private _auth: AuthDB;
  private _engage: EngageDB;
  private _notify: NotifyDB;
  private _chat: ChatDB;
  private _sync: SyncDB;
  private _flags: FlagsDB;
  private _receipt: ReceiptDB;
  private _account: AccountDB;
  private _lifecycle: LifecycleDB;
  private _analytics: AnalyticsDB;
  private _attest: AttestDB;

  constructor(public db: DrizzleDB) {
    this._auth = withAuthDB(db);
    this._engage = withEngageDB(db);
    this._notify = withNotifyDB(db);
    this._chat = withChatDB(db);
    this._sync = withSyncDB(db);
    this._flags = withFlagsDB(db);
    this._receipt = withReceiptDB(db);
    this._account = withAccountDB(db);
    this._lifecycle = withLifecycleDB(db);
    this._analytics = withAnalyticsDB(db);
    this._attest = withAttestDB(db);
  }

  // ── AttestDB ─────────────────────────────────────────────────────────────
  /** Returns an AttestDB-compatible object. */
  attestDB(): AttestDB { return this._attest; }

  // ── AuthDB ──────────────────────────────────────────────────────────────
  upsertUserByAppleSub = (...args: Parameters<AuthDB["upsertUserByAppleSub"]>) => this._auth.upsertUserByAppleSub(...args);
  userById = (...args: Parameters<AuthDB["userById"]>) => this._auth.userById(...args);

  // ── EngageDB ────────────────────────────────────────────────────────────
  trackEvents = (...args: Parameters<EngageDB["trackEvents"]>) => this._engage.trackEvents(...args);
  updateSubscription = (...args: Parameters<EngageDB["updateSubscription"]>) => this._engage.updateSubscription(...args);
  updateSubscriptionDetails = (...args: Parameters<EngageDB["updateSubscriptionDetails"]>) => this._engage.updateSubscriptionDetails(...args);
  getSubscription = (...args: Parameters<EngageDB["getSubscription"]>) => this._engage.getSubscription(...args);
  isProUser = (...args: Parameters<EngageDB["isProUser"]>) => this._engage.isProUser(...args);
  getEngagementData = (...args: Parameters<EngageDB["getEngagementData"]>) => this._engage.getEngagementData(...args);
  startSession = (...args: Parameters<EngageDB["startSession"]>) => this._engage.startSession(...args);
  endSession = (...args: Parameters<EngageDB["endSession"]>) => this._engage.endSession(...args);
  saveFeedback = (...args: Parameters<EngageDB["saveFeedback"]>) => this._engage.saveFeedback(...args);

  // ── NotifyDB ────────────────────────────────────────────────────────────
  upsertDeviceToken = (...args: Parameters<NotifyDB["upsertDeviceToken"]>) => this._notify.upsertDeviceToken(...args);
  disableDeviceToken = (...args: Parameters<NotifyDB["disableDeviceToken"]>) => this._notify.disableDeviceToken(...args);
  enabledDeviceTokens = (...args: Parameters<NotifyDB["enabledDeviceTokens"]>) => this._notify.enabledDeviceTokens(...args);
  ensureNotificationPreferences = (...args: Parameters<NotifyDB["ensureNotificationPreferences"]>) => this._notify.ensureNotificationPreferences(...args);
  getNotificationPreferences = (...args: Parameters<NotifyDB["getNotificationPreferences"]>) => this._notify.getNotificationPreferences(...args);
  upsertNotificationPreferences = (...args: Parameters<NotifyDB["upsertNotificationPreferences"]>) => this._notify.upsertNotificationPreferences(...args);
  allUsersWithNotificationsEnabled = (...args: Parameters<NotifyDB["allUsersWithNotificationsEnabled"]>) => this._notify.allUsersWithNotificationsEnabled(...args);
  lastNotificationDelivery = (...args: Parameters<NotifyDB["lastNotificationDelivery"]>) => this._notify.lastNotificationDelivery(...args);
  recordNotificationDelivery = (...args: Parameters<NotifyDB["recordNotificationDelivery"]>) => this._notify.recordNotificationDelivery(...args);
  trackNotificationOpened = (...args: Parameters<NotifyDB["trackNotificationOpened"]>) => this._notify.trackNotificationOpened(...args);

  // ── ChatDB (accessor for full interface — enabledDeviceTokens conflicts with NotifyDB) ──
  /** Returns a ChatDB-compatible object (enabledDeviceTokens returns string[]). */
  chatDB(): ChatDB { return this._chat; }
  getChatMessages = (...args: Parameters<ChatDB["getChatMessages"]>) => this._chat.getChatMessages(...args);
  getChatMessagesSince = (...args: Parameters<ChatDB["getChatMessagesSince"]>) => this._chat.getChatMessagesSince(...args);
  sendChatMessage = (...args: Parameters<ChatDB["sendChatMessage"]>) => this._chat.sendChatMessage(...args);
  markChatRead = (...args: Parameters<ChatDB["markChatRead"]>) => this._chat.markChatRead(...args);
  getUnreadCount = (...args: Parameters<ChatDB["getUnreadCount"]>) => this._chat.getUnreadCount(...args);
  adminListChatThreads = (...args: Parameters<ChatDB["adminListChatThreads"]>) => this._chat.adminListChatThreads(...args);

  // ── SyncDB ──────────────────────────────────────────────────────────────
  serverTime = (...args: Parameters<SyncDB["serverTime"]>) => this._sync.serverTime(...args);
  tombstones = (...args: Parameters<SyncDB["tombstones"]>) => this._sync.tombstones(...args);
  recordTombstone = (...args: Parameters<SyncDB["recordTombstone"]>) => this._sync.recordTombstone(...args);

  // ── FlagsDB ─────────────────────────────────────────────────────────────
  upsertFlag = (...args: Parameters<FlagsDB["upsertFlag"]>) => this._flags.upsertFlag(...args);
  getFlag = (...args: Parameters<FlagsDB["getFlag"]>) => this._flags.getFlag(...args);
  listFlags = (...args: Parameters<FlagsDB["listFlags"]>) => this._flags.listFlags(...args);
  deleteFlag = (...args: Parameters<FlagsDB["deleteFlag"]>) => this._flags.deleteFlag(...args);
  getUserOverride = (...args: Parameters<FlagsDB["getUserOverride"]>) => this._flags.getUserOverride(...args);
  setUserOverride = (...args: Parameters<FlagsDB["setUserOverride"]>) => this._flags.setUserOverride(...args);
  deleteUserOverride = (...args: Parameters<FlagsDB["deleteUserOverride"]>) => this._flags.deleteUserOverride(...args);

  // ── ReceiptDB ───────────────────────────────────────────────────────────
  upsertSubscription = (...args: Parameters<ReceiptDB["upsertSubscription"]>) => this._receipt.upsertSubscription(...args);
  userIdByTransactionId = (...args: Parameters<ReceiptDB["userIdByTransactionId"]>) => this._receipt.userIdByTransactionId(...args);
  storeTransaction = (...args: Parameters<ReceiptDB["storeTransaction"]>) => this._receipt.storeTransaction(...args);

  // ── AccountDB ───────────────────────────────────────────────────────────
  getUserEmail = (...args: Parameters<AccountDB["getUserEmail"]>) => this._account.getUserEmail(...args);
  deleteUserData = (...args: Parameters<AccountDB["deleteUserData"]>) => this._account.deleteUserData(...args);
  deleteUser = (...args: Parameters<AccountDB["deleteUser"]>) => this._account.deleteUser(...args);
  anonymizeUser = (...args: Parameters<AccountDB["anonymizeUser"]>) => this._account.anonymizeUser(...args);
  exportUserData = (...args: Parameters<AccountDB["exportUserData"]>) => this._account.exportUserData(...args);

  // ── LifecycleDB (accessor for full interface — enabledDeviceTokens conflicts with NotifyDB) ──
  /** Returns a LifecycleDB-compatible object (enabledDeviceTokens returns string[]). */
  lifecycleDB(): LifecycleDB { return this._lifecycle; }
  userCreatedAndLastActive = (...args: Parameters<LifecycleDB["userCreatedAndLastActive"]>) => this._lifecycle.userCreatedAndLastActive(...args);
  countSessions = (...args: Parameters<LifecycleDB["countSessions"]>) => this._lifecycle.countSessions(...args);
  countRecentSessions = (...args: Parameters<LifecycleDB["countRecentSessions"]>) => this._lifecycle.countRecentSessions(...args);
  countDistinctEventDays = (...args: Parameters<LifecycleDB["countDistinctEventDays"]>) => this._lifecycle.countDistinctEventDays(...args);
  lastPrompt = (...args: Parameters<LifecycleDB["lastPrompt"]>) => this._lifecycle.lastPrompt(...args);
  countPrompts = (...args: Parameters<LifecycleDB["countPrompts"]>) => this._lifecycle.countPrompts(...args);
  recordPrompt = (...args: Parameters<LifecycleDB["recordPrompt"]>) => this._lifecycle.recordPrompt(...args);
  isProUser = (...args: Parameters<LifecycleDB["isProUser"]>) => this._lifecycle.isProUser(...args);

  // ── AnalyticsDB ─────────────────────────────────────────────────────────
  dauTimeSeries = (...args: Parameters<AnalyticsDB["dauTimeSeries"]>) => this._analytics.dauTimeSeries(...args);
  eventCounts = (...args: Parameters<AnalyticsDB["eventCounts"]>) => this._analytics.eventCounts(...args);
  subscriptionBreakdown = (...args: Parameters<AnalyticsDB["subscriptionBreakdown"]>) => this._analytics.subscriptionBreakdown(...args);
  newSubscriptions30d = (...args: Parameters<AnalyticsDB["newSubscriptions30d"]>) => this._analytics.newSubscriptions30d(...args);
  churnedSubscriptions30d = (...args: Parameters<AnalyticsDB["churnedSubscriptions30d"]>) => this._analytics.churnedSubscriptions30d(...args);
  dauToday = (...args: Parameters<AnalyticsDB["dauToday"]>) => this._analytics.dauToday(...args);
  mau = (...args: Parameters<AnalyticsDB["mau"]>) => this._analytics.mau(...args);
  totalUsers = (...args: Parameters<AnalyticsDB["totalUsers"]>) => this._analytics.totalUsers(...args);
  activeSubscriptions = (...args: Parameters<AnalyticsDB["activeSubscriptions"]>) => this._analytics.activeSubscriptions(...args);
}

export { schema };
