<script lang="ts">
	import { goto } from '$app/navigation';
	import { auth } from '$lib/api';
	import Spinner from '$lib/components/ui/Spinner.svelte';

	let loading = $state(false);
	let error = $state('');

	async function handleAppleSignIn() {
		loading = true;
		error = '';
		try {
			// @ts-expect-error - AppleID is loaded via script tag
			const res = await window.AppleID.auth.signIn();
			const idToken = res.authorization?.id_token;
			if (!idToken) {
				error = 'No token received from Apple';
				return;
			}
			await auth(idToken);
			goto('/admin');
		} catch (e: unknown) {
			if (e && typeof e === 'object' && 'error' in e) {
				const appleErr = e as { error: string };
				if (appleErr.error === 'popup_closed_by_user') return;
			}
			error = e instanceof Error ? e.message : 'Sign in failed';
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<script
		type="text/javascript"
		src="https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js"
	></script>
	<meta
		name="appleid-signin-client-id"
		content="com.waterful.web"
	/>
	<meta name="appleid-signin-scope" content="email" />
	<meta name="appleid-signin-redirect-uri" content="" />
	<meta name="appleid-signin-use-popup" content="true" />
</svelte:head>

<div class="flex h-screen items-center justify-center bg-bg">
	<div class="w-full max-w-sm">
		<!-- Card -->
		<div class="rounded-xl border border-border bg-card p-8 text-center">
			<!-- Logo -->
			<div class="mb-6">
				<span class="text-4xl">🫏</span>
				<h1 class="mt-3 text-xl font-semibold text-text">DonkeyGo Admin</h1>
				<p class="mt-1 text-[12px] text-text-dim">Sign in to access the dashboard</p>
			</div>

			<!-- Error -->
			{#if error}
				<div class="mb-4 rounded-lg border border-red/20 bg-red/5 px-3 py-2 text-[11px] text-red">
					{error}
				</div>
			{/if}

			<!-- Apple Sign In -->
			<button
				onclick={handleAppleSignIn}
				disabled={loading}
				class="flex w-full items-center justify-center gap-2 rounded-lg bg-white px-4 py-2.5 text-[13px] font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-50"
			>
				{#if loading}
					<Spinner size="sm" />
				{:else}
					<svg class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
						<path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
					</svg>
					Sign in with Apple
				{/if}
			</button>
		</div>

		<!-- Footer -->
		<p class="mt-4 text-center text-[10px] text-text-dim">
			Restricted access. Authorized admins only.
		</p>
	</div>
</div>
