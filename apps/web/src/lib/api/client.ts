import type {
	Stats,
	UsersResponse,
	UserDetail,
	EventsResponse,
	NotificationsResponse,
	SubBreakdownRow,
	FeedbackResponse,
	CampaignsResponse,
	LogsResponse,
	LLMCostSummary,
	DAUEntry,
	AnalyticsSummary,
	MRRData,
	ChatsResponse,
	ChatMessagesResponse,
	DecisionsResponse
} from './types';

class ApiError extends Error {
	constructor(
		public status: number,
		message: string
	) {
		super(message);
		this.name = 'ApiError';
	}
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(path, {
		credentials: 'include',
		...init
	});

	if (res.status === 401) {
		window.location.href = '/admin/login';
		throw new ApiError(401, 'Unauthorized');
	}

	if (!res.ok) {
		const body = await res.text().catch(() => 'Unknown error');
		throw new ApiError(res.status, body);
	}

	return res.json();
}

function qs(params: Record<string, string | number | undefined>): string {
	const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '');
	if (entries.length === 0) return '';
	return '?' + entries.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
}

// ── Auth ─────────────────────────────────────────────────────────────────────

export async function auth(idToken: string): Promise<{ success: boolean }> {
	return request('/admin/api/auth', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ id_token: idToken })
	});
}

export function logout(): void {
	window.location.href = '/admin/api/logout';
}

// ── Stats ────────────────────────────────────────────────────────────────────

export async function getStats(): Promise<Stats> {
	return request('/admin/api/stats');
}

// ── Analytics ────────────────────────────────────────────────────────────────

export async function getAnalyticsSummary(): Promise<AnalyticsSummary> {
	return request('/admin/api/analytics/summary');
}

export async function getDAU(days = 30): Promise<DAUEntry[]> {
	return request(`/admin/api/analytics/dau${qs({ days })}`);
}

export async function getMRR(): Promise<MRRData> {
	return request('/admin/api/analytics/mrr');
}

// ── Users ────────────────────────────────────────────────────────────────────

export async function getUsers(
	search?: string,
	limit = 50,
	offset = 0
): Promise<UsersResponse> {
	return request(`/admin/api/users${qs({ search, limit, offset })}`);
}

export async function getUserDetail(id: string): Promise<UserDetail> {
	return request(`/admin/api/users/${id}`);
}

export async function getUserDecisions(
	id: string,
	limit = 100
): Promise<DecisionsResponse> {
	return request(`/admin/api/users/${id}/decisions${qs({ limit })}`);
}

// ── Events ───────────────────────────────────────────────────────────────────

export async function getEvents(
	event?: string,
	userId?: string,
	limit = 100,
	since?: string
): Promise<EventsResponse> {
	return request(`/admin/api/events${qs({ event, user_id: userId, limit, since })}`);
}

// ── Notifications ────────────────────────────────────────────────────────────

export async function getNotifications(limit = 100): Promise<NotificationsResponse> {
	return request(`/admin/api/notifications${qs({ limit })}`);
}

// ── Subscriptions ────────────────────────────────────────────────────────────

export async function getSubscriptions(): Promise<SubBreakdownRow[]> {
	return request('/admin/api/subscriptions');
}

// ── Feedback ─────────────────────────────────────────────────────────────────

export async function getFeedback(limit = 100): Promise<FeedbackResponse> {
	return request(`/admin/api/feedback${qs({ limit })}`);
}

// ── Campaigns ────────────────────────────────────────────────────────────────

export async function getCampaigns(): Promise<CampaignsResponse> {
	return request('/admin/api/campaigns');
}

// ── Logs ─────────────────────────────────────────────────────────────────────

export async function getLogs(limit = 500, filter?: string): Promise<LogsResponse> {
	return request(`/admin/api/logs${qs({ limit, filter })}`);
}

// ── LLM Costs ────────────────────────────────────────────────────────────────

export async function getLLMCosts(days = 30): Promise<LLMCostSummary> {
	return request(`/admin/api/llm-costs${qs({ days })}`);
}

// ── Chat ─────────────────────────────────────────────────────────────────────

export async function getChats(): Promise<ChatsResponse> {
	return request('/admin/api/chats');
}

export async function getChatMessages(userId: string): Promise<ChatMessagesResponse> {
	return request(`/admin/api/chats/${userId}`);
}

export async function sendChatReply(
	userId: string,
	message: string
): Promise<void> {
	await request(`/admin/api/chats/${userId}/reply`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ message })
	});
}

export function createChatWebSocket(): WebSocket {
	const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
	return new WebSocket(`${proto}//${window.location.host}/admin/api/chats/ws`);
}
