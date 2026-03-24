// ── Service ─────────────────────────────────────────────────────────────────
export class LifecycleService {
    cfg;
    db;
    push;
    constructor(cfg, db, push) {
        this.cfg = cfg;
        this.db = db;
        this.push = push;
    }
    async evaluateUser(userId) {
        const { createdAt, lastActiveAt } = await this.db.userCreatedAndLastActive(userId);
        const now = new Date();
        const daysSinceActive = Math.floor((now.getTime() - lastActiveAt.getTime()) / (24 * 60 * 60 * 1000));
        const createdDaysAgo = Math.floor((now.getTime() - createdAt.getTime()) / (24 * 60 * 60 * 1000));
        const totalSessions = await this.db.countSessions(userId);
        const recentSessions = await this.db.countRecentSessions(userId, new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));
        const ahaReached = await this.checkAhaMoment(userId, now);
        const isPro = await this.db.isProUser(userId);
        const score = calculateScore(recentSessions, ahaReached, isPro, daysSinceActive, totalSessions);
        const stage = this.determineStage(score, daysSinceActive, createdDaysAgo, ahaReached, isPro);
        const es = {
            user_id: userId,
            stage,
            score,
            days_since_active: daysSinceActive,
            total_sessions: totalSessions,
            aha_reached: ahaReached,
            is_pro: isPro,
            created_days_ago: createdDaysAgo,
        };
        es.prompt = await this.determinePrompt(userId, es);
        return es;
    }
    async checkAhaMoment(userId, now) {
        for (const rule of this.cfg.ahaMomentRules ?? []) {
            const since = new Date(now.getTime() - rule.windowDays * 24 * 60 * 60 * 1000);
            const count = await this.db.countDistinctEventDays(userId, rule.eventName, since);
            if (count >= rule.threshold)
                return true;
        }
        return false;
    }
    determineStage(score, daysSinceActive, createdDaysAgo, ahaReached, isPro) {
        for (const rule of this.cfg.customStages ?? []) {
            if (rule.matches(score, daysSinceActive, createdDaysAgo, ahaReached, isPro))
                return rule.stage;
        }
        if (daysSinceActive >= 30)
            return "churned";
        if (daysSinceActive >= 14)
            return "dormant";
        if (daysSinceActive >= 7 || (score < 20 && createdDaysAgo > 7))
            return "at_risk";
        if (isPro && score >= 60)
            return "loyal";
        if (isPro)
            return "monetized";
        if (score >= 40)
            return "engaged";
        if (ahaReached)
            return "activated";
        return "new";
    }
    async determinePrompt(userId, es) {
        const cooldownDays = this.cfg.promptCooldownDays ?? 3;
        const lastPrompt = await this.db.lastPrompt(userId).catch(() => null);
        if (lastPrompt && Date.now() - lastPrompt.promptAt.getTime() < cooldownDays * 24 * 60 * 60 * 1000) {
            return null;
        }
        if (this.cfg.promptBuilder)
            return this.cfg.promptBuilder(userId, es);
        switch (es.stage) {
            case "engaged":
                return es.is_pro
                    ? { type: "review", title: "Enjoying the app?", body: "Your feedback helps us improve. Leave a review?", reason: "engaged_pro_user" }
                    : { type: "paywall", title: "Unlock Premium", body: "You're getting great value — upgrade to unlock everything.", reason: "engaged_free_user" };
            case "loyal":
                return { type: "milestone", title: "You're a power user!", body: "Thanks for being a loyal subscriber.", reason: "loyal_user" };
            case "activated":
                return { type: "paywall", title: "Ready for more?", body: "You've discovered the core experience — unlock premium features.", reason: "aha_moment_reached" };
            case "at_risk":
                return { type: "winback", title: "We miss you!", body: "Come back and check out what's new.", reason: "at_risk" };
            case "dormant":
                return { type: "winback", title: "It's been a while", body: "We've made improvements since your last visit.", reason: "dormant" };
            case "churned":
                return { type: "winback", title: "Welcome back", body: "A lot has changed — give us another try.", reason: "churned" };
            default:
                return null;
        }
    }
    /** GET /api/v1/user/lifecycle */
    handleGetLifecycle = async (c) => {
        const userId = c.get("userId");
        try {
            const es = await this.evaluateUser(userId);
            return c.json(es);
        }
        catch {
            return c.json({ error: "failed to evaluate lifecycle" }, 500);
        }
    };
    /** POST /api/v1/user/lifecycle/ack */
    handleAckPrompt = async (c) => {
        const userId = c.get("userId");
        const body = await c.req.json();
        if (!body.prompt_type || !body.action)
            return c.json({ error: "prompt_type and action are required" }, 400);
        const validActions = new Set(["shown", "accepted", "dismissed"]);
        if (!validActions.has(body.action))
            return c.json({ error: "action must be one of: shown, accepted, dismissed" }, 400);
        const event = `lifecycle_prompt_${body.action}`;
        const metadata = JSON.stringify({ prompt_type: body.prompt_type });
        await this.db.recordPrompt(userId, event, metadata).catch(() => { });
        return c.json({ status: "ok" });
    };
    /** Evaluate users and send winback pushes to at-risk/dormant/churned users. */
    async evaluateNotifications(userIds) {
        for (const userId of userIds) {
            try {
                const es = await this.evaluateUser(userId);
                if (!["at_risk", "dormant", "churned"].includes(es.stage))
                    continue;
                if (!es.prompt || es.prompt.type !== "winback")
                    continue;
                const tokens = await this.db.enabledDeviceTokens(userId).catch(() => []);
                for (const token of tokens) {
                    await this.push.send(token, es.prompt.title, es.prompt.body).catch((err) => {
                        console.log(`[lifecycle] push ${userId}: ${err}`);
                    });
                }
                await this.db.recordPrompt(userId, "lifecycle_prompt_sent", JSON.stringify({ prompt_type: es.prompt.type })).catch(() => { });
            }
            catch (err) {
                console.log(`[lifecycle] evaluate ${userId}: ${err}`);
            }
        }
    }
}
function calculateScore(recentSessions, ahaReached, isPro, daysSinceActive, totalSessions) {
    let score = 0;
    score += recentSessions >= 7 ? 40 : recentSessions * 6;
    if (ahaReached)
        score += 20;
    if (isPro)
        score += 20;
    if (daysSinceActive === 0)
        score += 10;
    else if (daysSinceActive <= 2)
        score += 5;
    score += totalSessions >= 30 ? 10 : Math.floor(totalSessions / 3);
    return Math.min(score, 100);
}
//# sourceMappingURL=index.js.map