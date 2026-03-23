/** Format an ISO date string to a human-readable relative time. */
export function timeAgo(dateStr: string): string {
	const date = new Date(dateStr);
	const now = Date.now();
	const diff = now - date.getTime();

	const seconds = Math.floor(diff / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);

	if (seconds < 60) return 'just now';
	if (minutes < 60) return `${minutes}m ago`;
	if (hours < 24) return `${hours}h ago`;
	if (days < 30) return `${days}d ago`;
	return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Format an ISO date string to "Jan 2, 2024 3:04 PM". */
export function fullDate(dateStr: string): string {
	return new Date(dateStr).toLocaleDateString('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		hour: 'numeric',
		minute: '2-digit'
	});
}

/** Format an ISO date string to "Jan 2". */
export function shortDate(dateStr: string): string {
	return new Date(dateStr).toLocaleDateString('en-US', {
		month: 'short',
		day: 'numeric'
	});
}

/** Format a number with commas: 1234567 -> "1,234,567". */
export function formatNumber(n: number): string {
	return n.toLocaleString('en-US');
}

/** Format currency: 12.5 -> "$12.50". */
export function formatCurrency(n: number): string {
	return '$' + n.toFixed(2);
}

/** Format tokens: 1234567 -> "1.2M". */
export function formatTokens(n: number): string {
	if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
	if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
	return String(n);
}

/** Truncate text with ellipsis. */
export function truncate(text: string, max: number): string {
	if (text.length <= max) return text;
	return text.slice(0, max) + '...';
}
