# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: paired-repository.spec.ts >> paired repository acceptance phase: first
- Location: tests/e2e/release/paired-repository.spec.ts:259:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('[data-clip-id="paired-release-clip"]')
Expected: visible
Timeout: 30000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 30000ms
  - waiting for locator('[data-clip-id="paired-release-clip"]')

Browser boot diagnostics: {"url":"http://127.0.0.1:49521/home","issues":["[console.error] Failed to load resource: the server responded with a status of 404 (Not Found)","[console.error] Failed to load resource: the server responded with a status of 404 (Not Found)","[console.error] [useStandaloneAuthRedirect.syncSessionAndRedirect] AppError: Supabase runtime is not initialized. Call initializeSupabaseClientRuntime() during app bootstrap. {errorType: AppError, cause: Supabase runtime is not initialized. Call initializeSupabaseClientRuntime() during app bootstrap., context: useStandaloneAuthRedirect.syncSessionAndRedirect}","[pageerror] Supabase runtime is not initialized. Call initializeSupabaseClientRuntime() during app bootstrap.","[console.error] The above error occurred in the <HomePage> component:\n\n    at HomePage (http://127.0.0.1:49521/src/pages/Home/HomePage.tsx:44:22)\n    at Suspense\n    at RenderedRoute (http://127.0.0.1:49521/node_modules/.vite/deps/react-router-dom.js?v=be8caedc:4132:5)\n    at Routes (http://127.0.0.1:49521/node_modules/.vite/deps/react-router-dom.js?v=be8caedc:4602:5)\n    at AppRoutes\n    at DndContext2 (http://127.0.0.1:49521/node_modules/.vite/deps/chunk-QW7JCGZE.js?v=55f1a1b0:2521:5)\n    at FloatingDelayGroup (http://127.0.0.1:49521/node_modules/.vite/deps/chunk-7CZZBWIQ.js?v=55f1a1b0:274:5)\n    at TooltipProvider2 (http://127.0.0.1:49521/node_modules/.vite/deps/@base-ui_react_tooltip.js?v=8db09c03:680:5)\n    at TooltipProvider (http://127.0.0.1:49521/src/shared/components/ui/overlay/tooltip.tsx:28:28)\n    at TooltipProvider (http://127.0.0.1:49521/src/shared/components/ui/tooltip.tsx:25:28)\n    at AppInternalContent (http://127.0.0.1:49521/src/app/App.tsx:48:35)\n    at ToolPageHeaderProvider (http://127.0.0.1:49521/src/shared/contexts/ToolPageHeaderContext.tsx:24:42)\n    at SelectionStoreBoundary (http://127.0.0.1:49521/src/app/providers/AppProviders.tsx:101:35)\n    at AgentChatProvider (http://127.0.0.1:49521/src/shared/contexts/AgentChatContext.tsx:33:41)\n    at PanesStoreBootstrapBoundary (http://127.0.0.1:49521/src/shared/state/panesStore.ts:321:47)\n    at IncomingTasksProvider (http://127.0.0.1:49521/src/shared/contexts/IncomingTasksContext.tsx:28:41)\n    at GenerationTaskProvider (http://127.0.0.1:49521/src/shared/contexts/GenerationTaskContext.tsx:27:42)\n    at ShotsContextProvider (http://127.0.0.1:49521/src/shared/contexts/ShotsContext.tsx:32:40)\n    at AstridShotsProvider (http://127.0.0.1:49521/src/shared/contexts/ShotsContext.tsx:47:43)\n    at AuthorityAwareShotsProvider (http://127.0.0.1:49521/src/app/providers/AppProviders.tsx:51:47)\n    at RealtimeProvider (http://127.0.0.1:49521/src/shared/providers/RealtimeProvider.tsx:101:36)\n    at AstridCapabilityBootstrap (http://127.0.0.1:49521/src/integrations/astrid/AstridCapabilityBootstrap.tsx:24:126)\n    at ProjectProvider (http://127.0.0.1:49521/src/shared/contexts/ProjectContext.tsx:29:35)\n    at UserSettingsProvider (http://127.0.0.1:49521/src/shared/contexts/UserSettingsContext.tsx:41:44)\n    at TaskTypeConfigInitializer (http://127.0.0.1:49521/src/shared/components/TaskTypeConfigInitializer.tsx:23:45)\n    at AuthGate (http://127.0.0.1:49521/src/shared/auth/components/AuthGate.tsx:23:28)\n    at AuthProvider (http://127.0.0.1:49521/src/shared/contexts/AuthContext.tsx:36:103)\n    at ProviderTree (http://127.0.0.1:49521/src/app/providers/AppProviders.tsx:91:36)\n    at FloatingDelayGroup (http://127.0.0.1:49521/node_modules/.vite/deps/chunk-7CZZBWIQ.js?v=55f1a1b0:274:5)\n    at TooltipProvider2 (http://127.0.0.1:49521/node_modules/.vite/deps/@base-ui_react_tooltip.js?v=8db09c03:680:5)\n    at TooltipProvider (http://127.0.0.1:49521/src/shared/components/ui/overlay/tooltip.tsx:28:28)\n    at TooltipProvider (http://127.0.0.1:49521/src/shared/components/ui/tooltip.tsx:25:28)\n    at QueryClientProvider (http://127.0.0.1:49521/node_modules/.vite/deps/@tanstack_react-query.js?v=f5833394:3235:3)\n    at AppProviders (http://127.0.0.1:49521/src/app/providers/AppProviders.tsx:193:32)\n    at Router (http://127.0.0.1:49521/node_modules/.vite/deps/react-router-dom.js?v=be8caedc:4545:15)\n    at BrowserRouter (http://127.0.0.1:49521/node_modules/.vite/deps/react-router-dom.js?v=be8caedc:5291:5)\n    at App\n    at AppErrorBoundary (http://127.0.0.1:49521/src/app/components/error/AppErrorBoundary.tsx:170:9)\n\nReact will try to recreate this component tree from scratch using the error boundary you provided, AppErrorBoundary.","[console.error] [AppErrorBoundary.componentDidCatch] AppError: Supabase runtime is not initialized. Call initializeSupabaseClientRuntime() during app bootstrap. {errorType: AppError, cause: Supabase runtime is not initialized. Call initializeSupabaseClientRuntime() during app bootstrap., context: AppErrorBoundary.componentDidCatch, name: Error, stack: Error: Supabase runtime is not initialized. Call i….vite/deps/chunk-JYISVMFP.js?v=55f1a1b0:16456:34)}"],"consoleWarnings":[],"failedRequests":["[requestfailed] HEAD http://127.0.0.1:49521/api/astrid/projects/paired-release-demo/media/__reigh_capability_probe__/content — net::ERR_ABORTED","[requestfailed] GET http://127.0.0.1:49521/thumbs/916-1-thumb.jpg — net::ERR_ABORTED","[requestfailed] GET http://127.0.0.1:49521/thumbs/916-2-thumb.jpg — net::ERR_ABORTED","[requestfailed] GET http://127.0.0.1:49521/thumbs/916-3-thumb.jpg — net::ERR_ABORTED","[requestfailed] GET http://127.0.0.1:49521/thumbs/916-4-thumb.jpg — net::ERR_ABORTED","[requestfailed] GET http://127.0.0.1:49521/thumbs/916-output-poster-thumb.jpg — net::ERR_ABORTED","[requestfailed] GET http://127.0.0.1:49521/thumbs/animatediff-poster-thumb.jpg — net::ERR_ABORTED","[requestfailed] GET http://127.0.0.1:49521/thumbs/h-output-poster-thumb.jpg — net::ERR_ABORTED","[requestfailed] GET http://127.0.0.1:49521/thumbs/h1-crop-thumb.webp — net::ERR_ABORTED","[requestfailed] GET http://127.0.0.1:49521/thumbs/h2-crop-thumb.webp — net::ERR_ABORTED","[requestfailed] GET http://127.0.0.1:49521/thumbs/h3-crop-thumb.webp — net::ERR_ABORTED","[requestfailed] GET http://127.0.0.1:49521/thumbs/h4-crop-thumb.webp — net::ERR_ABORTED","[requestfailed] GET http://127.0.0.1:49521/thumbs/h5-crop-thumb.webp — net::ERR_ABORTED","[requestfailed] GET http://127.0.0.1:49521/thumbs/h6-crop-thumb.webp — net::ERR_ABORTED","[requestfailed] GET http://127.0.0.1:49521/thumbs/h7-crop-thumb.webp — net::ERR_ABORTED","[requestfailed] GET http://127.0.0.1:49521/thumbs/hero-background-poster-thumb.jpg — net::ERR_ABORTED","[requestfailed] GET http://127.0.0.1:49521/thumbs/motion-input-poster-thumb.jpg — net::ERR_ABORTED","[requestfailed] GET http://127.0.0.1:49521/thumbs/motion-output-poster-thumb.jpg — net::ERR_ABORTED","[requestfailed] GET http://127.0.0.1:49521/thumbs/slow-motion-explode-poster-thumb.jpg — net::ERR_ABORTED","[requestfailed] GET http://127.0.0.1:49521/thumbs/steampunk-willy-poster-thumb.jpg — net::ERR_ABORTED","[requestfailed] GET http://127.0.0.1:49521/thumbs/water-morphing-poster-thumb.jpg — net::ERR_ABORTED","[requestfailed] GET http://127.0.0.1:49521/thumbs/example-image2-thumb.jpg — net::ERR_ABORTED","[requestfailed] GET http://127.0.0.1:49521/intro-output.mp4 — net::ERR_ABORTED","[requestfailed] GET http://127.0.0.1:49521/lora-grid-pingpong.mp4 — net::ERR_ABORTED","[requestfailed] GET http://127.0.0.1:49521/lora-grid-pingpong.mp4 — net::ERR_ABORTED","[requestfailed] GET http://127.0.0.1:49521/intro-output.mp4 — net::ERR_ABORTED","[requestfailed] GET http://127.0.0.1:49521/hero-background-easeout-smooth-web.mp4 — net::ERR_ABORTED"],"bodyText":"something went wrong we're sorry, but something unexpected happened. please try refreshing the page. error: supabase runtime is not initialized. call initializesupabaseclientruntime() during app bootstrap. at getsupabaseruntimeclientresult (http://127.0.0.1:49521/src/integrations/supabase/runtime/supabaseruntime.ts:41:16) at getsupabaseclientresult (http://127.0.0.1:49521/src/integrations/supabase/client.ts:20:20) at getsupabaseclient (http://127.0.0.1:49521/src/integrations/supabase/client.ts:27:20) at http://127.0.0.1:49521/src/pages/home/hooks/auth/usehomeauthsubscription.ts:37:36 at commithookeffectlistmount (http://127.0.0.1:49521/node_modules/.vite/deps/chunk-jyisvmfp.js?v=55f1a1b0:16456:34) try again reload page if this keeps happening, try clearing your browser cache or contact support.","rootHtml":"<div class=\"min-h-screen bg-background flex items-center justify-center p-4\"><div class=\"max-w-md w-full space-y-6 text-center\"><div class=\"flex justify-center\"><div class=\"rounded-full bg-destructive/10 p-4\"><svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" class=\"lucide lucide-triangle-alert h-12 w-12 text-destructive\"><path d=\"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3\"></path><path d=\"M12 9v4\"></path><path d=\"M12 17h.01\"></path></svg></div></div><div class=\"space-y-2\"><h1 class=\"text-2xl font-semibold text-foreground\">Something went wrong</h1><p class=\"text-muted-foreground\">We're sorry, but something unexpected happened. Please try refreshing the page.</p></div><div class=\"bg-muted rounded-lg p-4 text-left\"><p class=\"text-sm font-mono text-destructive break-all\">Error: Supabase runtime is not initialized. Call initializeSupabaseClientRuntime() during app bootstrap.</p><pre class=\"mt-2 text-xs text-muted-foreground overflow-x-auto max-h-32\"> at getSupabaseRuntimeClientResult (http://127.0.0.1:49521/src/integrations/supa"}
```

# Page snapshot

```yaml
- generic [ref=e4]:
  - img [ref=e7]
  - generic [ref=e9]:
    - heading "Something went wrong" [level=1] [ref=e10]
    - paragraph [ref=e11]: We're sorry, but something unexpected happened. Please try refreshing the page.
  - generic [ref=e12]:
    - paragraph [ref=e13]: "Error: Supabase runtime is not initialized. Call initializeSupabaseClientRuntime() during app bootstrap."
    - generic [ref=e14]: at getSupabaseRuntimeClientResult (http://127.0.0.1:49521/src/integrations/supabase/runtime/supabaseRuntime.ts:41:16) at getSupabaseClientResult (http://127.0.0.1:49521/src/integrations/supabase/client.ts:20:20) at getSupabaseClient (http://127.0.0.1:49521/src/integrations/supabase/client.ts:27:20) at http://127.0.0.1:49521/src/pages/Home/hooks/auth/useHomeAuthSubscription.ts:37:36 at commitHookEffectListMount (http://127.0.0.1:49521/node_modules/.vite/deps/chunk-JYISVMFP.js?v=55f1a1b0:16456:34)
  - generic [ref=e15]:
    - button "Try Again" [ref=e16] [cursor=pointer]:
      - img
      - text: Try Again
    - button "Reload Page" [ref=e17] [cursor=pointer]
  - paragraph [ref=e18]: If this keeps happening, try clearing your browser cache or contact support.
```

# Test source

```ts
  55  |   config: TimelineConfig;
  56  |   registry: Record<string, unknown>;
  57  |   config_version: number;
  58  | };
  59  |
  60  | type RunawaySnapshot = { count: number; hash: string };
  61  |
  62  | function canonicalValue(value: unknown): unknown {
  63  |   if (Array.isArray(value)) return value.map(canonicalValue);
  64  |   if (value !== null && typeof value === 'object') {
  65  |     return Object.fromEntries(Object.entries(value as Record<string, unknown>)
  66  |       .sort(([left], [right]) => left.localeCompare(right))
  67  |       .map(([key, entry]) => [key, canonicalValue(entry)]));
  68  |   }
  69  |   return value;
  70  | }
  71  |
  72  | function canonicalJson(value: unknown): string {
  73  |   return JSON.stringify(canonicalValue(value));
  74  | }
  75  |
  76  | function sha256Text(value: string): string {
  77  |   return createHash('sha256').update(value).digest('hex');
  78  | }
  79  |
  80  | function timelineStateHash(timelineState: TimelineEnvelope): string {
  81  |   return sha256Text(canonicalJson({
  82  |     config: timelineState.config,
  83  |     registry: timelineState.registry,
  84  |   }));
  85  | }
  86  |
  87  | async function readTimeline(request: APIRequestContext): Promise<TimelineEnvelope> {
  88  |   const response = await request.get(timelineUrl);
  89  |   expect(response.status()).toBe(200);
  90  |   return response.json() as Promise<TimelineEnvelope>;
  91  | }
  92  |
  93  | async function readRunawaySnapshot(request: APIRequestContext): Promise<RunawaySnapshot | null> {
  94  |   const response = await request.get(runawayUrl);
  95  |   if (response.status() === 404) return null;
  96  |   expect(response.status()).toBe(200);
  97  |   expect(response.headers()['x-astrid-bridge-version']).toBe('v1');
  98  |   const payload = await response.json() as { count?: number; total_count?: number; transitions?: unknown[] };
  99  |   expect(payload.count).toBe(payload.transitions?.length);
  100 |   const count = payload.total_count ?? payload.count;
  101 |   if (typeof count !== 'number') throw new Error('Runaway response has no total count');
  102 |   return {
  103 |     count,
  104 |     hash: sha256Text(canonicalJson({
  105 |       timingSummary: (payload as { timing_summary?: unknown }).timing_summary,
  106 |       transitions: payload.transitions,
  107 |     })),
  108 |   };
  109 | }
  110 |
  111 | function primaryClip(config: TimelineConfig) {
  112 |   return config.clips?.find((clip) => clip.id === 'paired-release-clip');
  113 | }
  114 |
  115 | function captionCount(config: TimelineConfig): number {
  116 |   return config.clips?.filter((clip) => clip.id?.startsWith('transcript-caption-')).length ?? 0;
  117 | }
  118 |
  119 | async function openEditor(page: Page): Promise<string[]> {
  120 |   const issues: string[] = [];
  121 |   const consoleWarnings: string[] = [];
  122 |   const failedRequests: string[] = [];
  123 |   page.on('pageerror', (error) => issues.push(`[pageerror] ${error.message}`));
  124 |   page.on('console', (message) => {
  125 |     if (message.type() === 'error') issues.push(`[console.error] ${message.text()}`);
  126 |     if (message.type() === 'warning') consoleWarnings.push(`[console.warn] ${message.text()}`);
  127 |   });
  128 |   page.on('requestfailed', (request) => {
  129 |     failedRequests.push(`[requestfailed] ${request.method()} ${request.url()} — ${request.failure()?.errorText ?? 'unknown'}`);
  130 |   });
  131 |   await page.addInitScript(() => {
  132 |     window.localStorage.removeItem('reigh.dev-extensions.disabled');
  133 |     window.localStorage.setItem('reigh.lastSelectedProjectId', 'stale-project-must-remain-isolated');
  134 |   });
  135 |   const response = await page.goto(editorUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  136 |   expect(response?.ok()).toBe(true);
  137 |   try {
  138 |     await expect(page.locator('[data-clip-id="paired-release-clip"]')).toBeVisible({ timeout: 30_000 });
  139 |   } catch (error) {
  140 |     // Preserve the useful browser failure signal in the receipt. Without this
  141 |     // context a module-evaluation crash is misreported as a missing seeded
  142 |     // clip, because Playwright only reports the final selector timeout.
  143 |     const bodyText = await page.locator('body').innerText().catch(() => '');
  144 |     const rootHtml = await page.locator('#root').innerHTML().catch(() => '');
  145 |     const compact = (value: string) => value.replace(/\s+/g, ' ').trim().slice(0, 1200);
  146 |     const diagnostics = JSON.stringify({
  147 |       url: page.url(),
  148 |       issues,
  149 |       consoleWarnings,
  150 |       failedRequests,
  151 |       bodyText: compact(bodyText),
  152 |       rootHtml: compact(rootHtml),
  153 |     });
  154 |     const message = error instanceof Error ? error.message : String(error);
> 155 |     throw new Error(`${message}\nBrowser boot diagnostics: ${diagnostics}`);
      |           ^ Error: expect(locator).toBeVisible() failed
  156 |   }
  157 |   await expect(page.locator('[data-lane-kind="reigh.transcript"]')).toBeVisible();
  158 |   return issues;
  159 | }
  160 |
  161 | async function proveAllExtensionLifecycles(page: Page) {
  162 |   await page.getByRole('tab', { name: 'Extensions' }).click();
  163 |   const rows = page.locator('[data-video-editor-dev-local-extension]');
  164 |   await expect(rows).toHaveCount(expectedExtensions);
  165 |   for (let index = 0; index < expectedExtensions; index += 1) {
  166 |     await expect(rows.nth(index)).toContainText('Active');
  167 |   }
  168 |
  169 |   // Drive every reviewed extension through its real DEV lifecycle control.
  170 |   // The gate returns each one to enabled immediately so later surface checks
  171 |   // still exercise the complete inventory.
  172 |   const ids = await rows.evaluateAll((elements) => elements.map((element) => (
  173 |     element.getAttribute('data-video-editor-dev-local-extension')
  174 |   )));
  175 |   expect(new Set(ids).size).toBe(expectedExtensions);
  176 |   for (const id of ids) {
  177 |     expect(id).toBeTruthy();
  178 |     const toggle = page.locator(`[data-video-editor-dev-local-toggle="${id}"]`);
  179 |     await toggle.click();
  180 |     await expect(toggle).toHaveAccessibleName(`Enable ${id}`);
  181 |     await toggle.click();
  182 |     await expect(toggle).toHaveAccessibleName(`Disable ${id}`);
  183 |   }
  184 | }
  185 |
  186 | async function dragPrimaryClip(page: Page) {
  187 |   const clip = page.locator('[data-clip-id="paired-release-clip"]');
  188 |   const box = await clip.boundingBox();
  189 |   if (!box) throw new Error('primary clip has no browser geometry');
  190 |   const x = box.x + box.width / 2;
  191 |   const y = box.y + box.height / 2;
  192 |   await page.mouse.move(x, y);
  193 |   await page.mouse.down();
  194 |   await page.mouse.move(x + 64, y, { steps: 8 });
  195 |   await page.mouse.up();
  196 | }
  197 |
  198 | async function waitForPersistedEdit(request: APIRequestContext, previousAt: number) {
  199 |   await expect.poll(async () => {
  200 |     const current = await readTimeline(request);
  201 |     return primaryClip(current.config)?.at;
  202 |   }, { timeout: 30_000 }).not.toBe(previousAt);
  203 | }
  204 |
  205 | async function materializeTranscript(page: Page, request: APIRequestContext) {
  206 |   const actions = page.getByRole('button', { name: 'Transcript actions' });
  207 |   await actions.scrollIntoViewIfNeeded();
  208 |   await actions.click();
  209 |   await page.getByRole('menuitem', { name: 'Render transcript as editable video text' }).click();
  210 |   await expect.poll(async () => captionCount((await readTimeline(request)).config), {
  211 |     timeout: 30_000,
  212 |   }).toBeGreaterThanOrEqual(2);
  213 | }
  214 |
  215 | async function renderAndDownload(
  216 |   page: Page,
  217 |   timelineState: TimelineEnvelope,
  218 |   persistedStateHash: string,
  219 | ): Promise<{ bytes: number; sha256: string }> {
  220 |   await page.getByRole('button', { name: 'Render', exact: true }).click();
  221 |   const downloadLink = page.getByRole('link', { name: 'Download', exact: true });
  222 |   await expect(downloadLink).toBeVisible({ timeout: 240_000 });
  223 |   const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
  224 |   await downloadLink.click();
  225 |   const download = await downloadPromise;
  226 |   const path = resolve(evidenceDir!, 'paired-release-render.mp4');
  227 |   await download.saveAs(path);
  228 |   const bytes = (await stat(path)).size;
  229 |   expect(bytes).toBeGreaterThan(10_000);
  230 |   const body = await readFile(path);
  231 |   expect(body.subarray(4, 8).toString('ascii')).toBe('ftyp');
  232 |   const expectedFps = timelineState.config.output?.fps;
  233 |   expect(expectedFps).toBe(24);
  234 |   const expectedDuration = Math.max(...(timelineState.config.clips ?? []).map((clip) => (
  235 |     Number(clip.at ?? 0) + Number(clip.hold ?? clip.duration ?? 0)
  236 |   )));
  237 |   const captionMidpoints = (timelineState.config.clips ?? [])
  238 |     .filter((clip) => clip.id?.startsWith('transcript-caption-'))
  239 |     .map((clip) => Number(clip.at ?? 0) + Number(clip.hold ?? clip.duration ?? 0) / 2)
  240 |     .filter(Number.isFinite);
  241 |   expect(expectedDuration).toBeGreaterThan(0);
  242 |   expect(captionMidpoints.length).toBeGreaterThanOrEqual(2);
  243 |   await writeFile(
  244 |     resolve(evidenceDir!, 'render-browser-receipt.json'),
  245 |     `${JSON.stringify({
  246 |       schemaVersion: 1,
  247 |       persistedStateHash,
  248 |       expectedDuration,
  249 |       expectedFps,
  250 |       captionMidpoints,
  251 |       bytes,
  252 |       sha256: createHash('sha256').update(body).digest('hex'),
  253 |     }, null, 2)}\n`,
  254 |     { encoding: 'utf8', flag: 'wx', mode: 0o600 },
  255 |   );
```