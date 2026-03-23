<script lang="ts">
	import { onDestroy } from 'svelte';
	import { getChats, getChatMessages, sendChatReply, createChatWebSocket } from '$lib/api';
	import type { ChatThread, ChatMessage } from '$lib/api';
	import { Badge, Spinner } from '$lib/components/ui';
	import { timeAgo } from '$lib/utils';

	let threads = $state<ChatThread[]>([]);
	let messages = $state<ChatMessage[]>([]);
	let selectedUserId = $state<string | null>(null);
	let replyText = $state('');
	let loadingThreads = $state(true);
	let loadingMessages = $state(false);
	let sending = $state(false);
	let error = $state('');
	let ws: WebSocket | null = null;
	let refreshTimer: ReturnType<typeof setInterval> | undefined;
	let messagesContainer = $state<HTMLElement | undefined>(undefined);

	async function loadThreads() {
		try {
			const res = await getChats();
			threads = res.threads ?? [];
			error = '';
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load chats';
		} finally {
			loadingThreads = false;
		}
	}

	async function selectThread(userId: string) {
		selectedUserId = userId;
		loadingMessages = true;
		try {
			const res = await getChatMessages(userId);
			messages = res.messages ?? [];
			scrollToBottom();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load messages';
		} finally {
			loadingMessages = false;
		}
	}

	async function handleSend() {
		if (!replyText.trim() || !selectedUserId || sending) return;
		sending = true;
		try {
			await sendChatReply(selectedUserId, replyText.trim());
			replyText = '';
			const res = await getChatMessages(selectedUserId);
			messages = res.messages ?? [];
			scrollToBottom();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to send reply';
		} finally {
			sending = false;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleSend();
		}
	}

	function scrollToBottom() {
		requestAnimationFrame(() => {
			if (messagesContainer) {
				messagesContainer.scrollTop = messagesContainer.scrollHeight;
			}
		});
	}

	function connectWebSocket() {
		try {
			ws = createChatWebSocket();
			ws.onmessage = (event) => {
				try {
					const data = JSON.parse(event.data);
					if (data.user_id === selectedUserId && data.content) {
						messages = [...messages, data as ChatMessage];
						scrollToBottom();
					}
					loadThreads();
				} catch {
					// ignore parse errors
				}
			};
			ws.onclose = () => {
				setTimeout(connectWebSocket, 3000);
			};
		} catch {
			// WebSocket not available, fall back to polling
		}
	}

	loadThreads();
	connectWebSocket();
	refreshTimer = setInterval(loadThreads, 10_000);

	onDestroy(() => {
		if (ws) ws.close();
		if (refreshTimer) clearInterval(refreshTimer);
	});

	let selectedThread = $derived(threads.find((t) => t.user_id === selectedUserId));
</script>

<svelte:head>
	<title>Chat - Admin</title>
</svelte:head>

<div class="flex h-[calc(100vh-48px)] gap-0 -m-6">
	<!-- Thread list -->
	<div class="w-72 shrink-0 border-r border-border bg-bg2 flex flex-col">
		<div class="border-b border-border px-4 py-3">
			<h2 class="text-[13px] font-medium text-text">Chat Threads</h2>
		</div>
		<div class="flex-1 overflow-y-auto">
			{#if loadingThreads}
				<div class="flex justify-center py-8"><Spinner size="sm" /></div>
			{:else if threads.length === 0}
				<div class="px-4 py-8 text-center text-[11px] text-text-dim">No chat threads</div>
			{:else}
				{#each threads as thread}
					<button
						onclick={() => selectThread(thread.user_id)}
						class="w-full border-b border-border/50 px-4 py-3 text-left transition-colors
							{thread.user_id === selectedUserId ? 'bg-cyan/5' : 'hover:bg-bg3'}"
					>
						<div class="flex items-center justify-between">
							<span class="text-[12px] font-medium text-text-soft truncate">
								{thread.user_name || thread.user_email || thread.user_id}
							</span>
							{#if thread.unread_count > 0}
								<span class="ml-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-cyan px-1 text-[9px] font-bold text-bg">
									{thread.unread_count}
								</span>
							{/if}
						</div>
						<div class="mt-0.5 text-[11px] text-text-dim truncate">{thread.last_message || '...'}</div>
						<div class="mt-0.5 text-[10px] text-text-dim/60">{timeAgo(thread.last_message_at)}</div>
					</button>
				{/each}
			{/if}
		</div>
	</div>

	<!-- Message area -->
	<div class="flex flex-1 flex-col bg-bg">
		{#if !selectedUserId}
			<div class="flex flex-1 items-center justify-center text-[12px] text-text-dim">
				Select a conversation to begin
			</div>
		{:else}
			<!-- Header -->
			<div class="border-b border-border bg-bg2 px-4 py-3 flex items-center gap-3">
				<span class="text-[13px] font-medium text-text">
					{selectedThread?.user_name || selectedThread?.user_email || selectedUserId}
				</span>
				{#if selectedThread?.user_email}
					<span class="text-[11px] text-text-dim">{selectedThread.user_email}</span>
				{/if}
			</div>

			<!-- Messages -->
			<div class="flex-1 overflow-y-auto p-4 space-y-3" bind:this={messagesContainer}>
				{#if loadingMessages}
					<div class="flex justify-center py-8"><Spinner size="md" /></div>
				{:else if messages.length === 0}
					<div class="text-center text-[11px] text-text-dim py-8">No messages yet</div>
				{:else}
					{#each messages as msg}
						{@const isAdmin = msg.role === 'admin'}
						{@const isAssistant = msg.role === 'assistant'}
						<div class="flex {isAdmin ? 'justify-end' : 'justify-start'}">
							<div
								class="max-w-[70%] rounded-xl px-3 py-2 text-[12px]
									{isAdmin
									? 'bg-bg4 text-text-soft rounded-br-sm'
									: isAssistant
									? 'bg-purple-900/30 text-purple-200 rounded-bl-sm border border-purple-800/30'
									: 'bg-blue/20 text-text rounded-bl-sm border border-blue/20'}"
							>
								{#if isAssistant}
									<div class="text-[9px] text-purple-400 mb-1 font-medium">AI Assistant</div>
								{/if}
								{#if msg.image_url}
									<img
										src={msg.image_url}
										alt=""
										class="max-w-full rounded mb-1"
										style="max-height: 200px"
									/>
								{/if}
								<div class="whitespace-pre-wrap break-words">{msg.content}</div>
								<div class="mt-1 text-[9px] {isAdmin ? 'text-text-dim/60' : 'text-text-dim/50'}">
									{timeAgo(msg.created_at)}
								</div>
							</div>
						</div>
					{/each}
				{/if}
			</div>

			<!-- Reply input -->
			<div class="border-t border-border bg-bg2 p-3 flex gap-2">
				<textarea
					bind:value={replyText}
					onkeydown={handleKeydown}
					placeholder="Type a reply..."
					rows="1"
					class="flex-1 resize-none rounded-lg border border-border bg-bg px-3 py-2 text-[12px] text-text placeholder:text-text-dim/50 focus:border-cyan/40 focus:outline-none focus:ring-1 focus:ring-cyan/20 transition-colors"
				></textarea>
				<button
					onclick={handleSend}
					disabled={!replyText.trim() || sending}
					class="rounded-lg bg-cyan/10 px-4 py-2 text-[12px] font-medium text-cyan hover:bg-cyan/20 disabled:opacity-30 transition-colors"
				>
					{#if sending}
						<Spinner size="sm" />
					{:else}
						Send
					{/if}
				</button>
			</div>
		{/if}
	</div>
</div>
