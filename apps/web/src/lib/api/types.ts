// ── Stats ────────────────────────────────────────────────────────────────────

export interface Stats {
	total_users: number;
	active_today: number;
	pro_users: number;
	total_logs: number;
	total_events: number;
	total_notifications: number;
}

// ── Users ────────────────────────────────────────────────────────────────────

export interface User {
	id: string;
	email: string;
	name: string;
	created_at: string;
	last_login_at: string;
	status: string;
}

export interface SubInfo {
	product_id: string;
	status: string;
	expires_at?: string;
}

export interface UserDetail extends User {
	subscription?: SubInfo;
	event_count: number;
	session_count: number;
	device_count: number;
}

export interface UsersResponse {
	users: User[];
	total: number;
	limit: number;
	offset: number;
}

// ── Events ───────────────────────────────────────────────────────────────────

export interface AdminEvent {
	user_id: string;
	user_email: string;
	event: string;
	metadata: string;
	created_at: string;
}

export interface EventsResponse {
	events: AdminEvent[];
	count: number;
}

// ── Notifications ────────────────────────────────────────────────────────────

export interface Notification {
	user_id: string;
	user_email?: string;
	kind: string;
	title: string;
	body: string;
	status: string;
	sent_at: string;
}

export interface NotificationsResponse {
	notifications: Notification[];
	count: number;
}

// ── Subscriptions ────────────────────────────────────────────────────────────

export interface SubBreakdownRow {
	status: string;
	count: number;
}

// ── Feedback ─────────────────────────────────────────────────────────────────

export interface Feedback {
	user_id: string;
	user_email: string;
	type: string;
	message: string;
	app_version: string;
	created_at: string;
}

export interface FeedbackResponse {
	feedback: Feedback[];
	count: number;
}

// ── Campaigns ────────────────────────────────────────────────────────────────

export interface Campaign {
	name: string;
	sent: number;
	opened: number;
	clicked: number;
	ctr: number;
}

export interface CampaignsResponse {
	campaigns: Campaign[];
}

// ── Logs ─────────────────────────────────────────────────────────────────────

export interface LogsResponse {
	lines: string[];
	count: number;
}

// ── LLM Costs ────────────────────────────────────────────────────────────────

export interface LLMCostSummary {
	total_cost: number;
	total_tokens: number;
	total_requests: number;
	by_feature: LLMFeatureCost[];
	by_model: LLMModelCost[];
}

export interface LLMFeatureCost {
	feature: string;
	model: string;
	requests: number;
	input_tokens: number;
	output_tokens: number;
	cost: number;
}

export interface LLMModelCost {
	model: string;
	requests: number;
	input_tokens: number;
	output_tokens: number;
	cost: number;
}

// ── Analytics ────────────────────────────────────────────────────────────────

export interface DAUEntry {
	date: string;
	dau: number;
}

export interface AnalyticsSummary {
	dau: number;
	mau: number;
	total_users: number;
	active_subscriptions: number;
	mrr?: number;
}

export interface MRRData {
	mrr: number;
	currency: string;
	subscriptions: number;
}

// ── Chat ─────────────────────────────────────────────────────────────────────

export interface ChatThread {
	user_id: string;
	user_email: string;
	user_name: string;
	last_message: string;
	last_message_at: string;
	unread_count: number;
}

export interface ChatMessage {
	id: string;
	user_id: string;
	role: string; // "user" | "admin" | "assistant"
	content: string;
	content_type?: string;
	created_at: string;
	image_url?: string;
}

export interface ChatsResponse {
	threads: ChatThread[];
	count: number;
}

export interface ChatMessagesResponse {
	messages: ChatMessage[];
}

// ── User Detail Sub-endpoints ────────────────────────────────────────────────

export interface NotificationDecision {
	id: string;
	stage: string;
	outcome: string;
	kind: string;
	reason_code: string;
	reason: string;
	title: string;
	body: string;
	created_at: string;
	context?: Record<string, unknown>;
}

export interface DecisionsResponse {
	decisions: NotificationDecision[];
	count: number;
}
