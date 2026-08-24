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
Error: strict mode violation: locator('[data-clip-id="paired-release-clip"]') resolved to 3 elements:
    1) <div tabindex="0" role="button" data-row-id="V1" data-clip-id="paired-release-clip" class="clip-action group relative flex h-full w-full select-none overflow-hidden rounded-md border text-left outline-none border-border bg-card/90 text-foreground hover:border-accent">…</div> aka getByRole('button', { name: 'paired-release.jpg' })
    2) <div data-row-id="V1" data-resize-edge="left" data-clip-id="paired-release-clip" class="absolute inset-y-0 left-0 z-10 cursor-ew-resize rounded-l-sm border-l border-[color:var(--video-editor-accent-ring)] bg-transparent transition-colors group-hover:bg-[var(--video-editor-accent-bg)]"></div> aka locator('.absolute.inset-y-0.left-0.z-10')
    3) <div data-row-id="V1" data-resize-edge="right" data-clip-id="paired-release-clip" class="absolute inset-y-0 right-0 z-10 cursor-ew-resize rounded-r-sm border-r border-[color:var(--video-editor-accent-ring)] bg-transparent transition-colors group-hover:bg-[var(--video-editor-accent-bg)]"></div> aka locator('.absolute.inset-y-0.right-0')

Call log:
  - Expect "toBeVisible" with timeout 30000ms
  - waiting for locator('[data-clip-id="paired-release-clip"]')

Browser boot diagnostics: {"url":"http://127.0.0.1:54734/tools/video-editor?localProject=paired-release-demo&localTimeline=f5tx523nt7e2jxq6ckp2y024vk&localTest=1&transcriptLaneFixture=1&runawayTimelineProject=runaway-piano-colour-demo","issues":["[console.error] Failed to load resource: the server responded with a status of 404 (Not Found)","[console.error] Failed to load resource: the server responded with a status of 404 (Not Found)","[console.error] Failed to load resource: the server responded with a status of 403 (Forbidden)"],"consoleWarnings":[],"failedRequests":["[requestfailed] HEAD http://127.0.0.1:54734/api/astrid/projects/paired-release-demo/media/__reigh_capability_probe__/content — net::ERR_ABORTED"],"bodyText":"timeline mode select. precision disabled. desktop pointer controls are active. ← back paired-release-demo paired release timeline paired release timeline 0:00.00 live sources export clear render destination Download Project media render preview overlay transforms are available in the preview. mode select. precision disabled. 1280x720 inspector extensions processes select a clip to edit timing, position, audio, text, or effects. saved clear 1 unused 0:00.00 0:05.00 0:10.00 0:15.00 0:20.00 0:25.00 0:30.00 0:35.00 0:40.00 ‹ layers 1–6/11 › video paired-release.jpg video 2 audio runaway transitions 116/566 + video + audio new text new effect create animation sequence scene markers playhead 0.00s no markers — press b at each phase. mark (b) track V1 V2 tail duration align shots to transitions clear/delete data codepanel — m4 writingpanel — m4 stagepanel — m3 select a project to browse shots 0 action cancel all processing (0) succeeded (0) failed (0) all current no tasks processing timeline agent chat is managed in astrid run the agent workflow in astrid, then refresh this editor to load the updated timeline. tools main tools generate images structure, loras + prompt control. travel betw","rootHtml":"<div class=\"flex flex-col h-screen overflow-hidden\"><div class=\"fixed inset-0 bg-gradient-to-br from-background via-secondary/10 to-accent/5 opacity-40 dark:opacity-0 pointer-events-none\"></div><div class=\"relative z-10 content-container h-screen overflow-hidden transition-[margin,padding] duration-300 ease-smooth\" data-video-editor-route=\"true\" data-video-editor-shell-active=\"true\" style=\"margin-right: 0px; margin-left: 0px; padding-top: 0px; padding-bottom: 0px; --content-width: 1280px; --content-height: 720px; --content-sm: 1; --content-md: 1; --content-lg: 1; --content-xl: 1; --content-2xl: 0; will-change: margin, padding;\"><main class=\"h-full w-full overflow-hidden\"><div class=\"flex h-full w-full flex-col overflow-hidden bg-background\"><div class=\"min-h-0 flex-1 overflow-hidden\"><div class=\"flex h-full w-full min-h-0 min-w-0 max-w-full flex-col overflow-hidden bg-background text-foreground\"><div class=\"sr-only\" aria-live=\"polite\" aria-atomic=\"true\">Timeline mode select. Precision disabled. Desktop pointer controls are active.</div><div class=\"flex h-10 items-center gap-3 border-b border-border bg-background px-3 text-sm text-muted-foreground\"><button type=\"button\" class=\"shrin"}
```

# Page snapshot

```yaml
- generic [ref=e2]:
  - generic [ref=e3]:
    - main [ref=e5]:
      - generic [ref=e8]:
        - generic [ref=e9]: Timeline mode select. Precision disabled. Desktop pointer controls are active.
        - generic [ref=e10]:
          - button "← Back" [ref=e11] [cursor=pointer]
          - generic [ref=e13]:
            - combobox "Select project" [ref=e14] [cursor=pointer]:
              - img [ref=e15]
              - generic [ref=e17]: paired-release-demo
              - img [ref=e18]
            - combobox "Select timeline" [ref=e21] [cursor=pointer]:
              - generic [ref=e22]: Paired Release Timeline
              - img [ref=e23]
          - generic [ref=e26]: Paired Release Timeline
          - button "Settings" [ref=e27] [cursor=pointer]:
            - img
        - main [ref=e28]:
          - generic [ref=e29]:
            - generic:
              - generic [ref=e30]: 0:00.00
              - generic [ref=e31]:
                - region "Live sources" [ref=e32]:
                  - button "Live sources" [ref=e33] [cursor=pointer]:
                    - generic [ref=e34]:
                      - img [ref=e35]
                      - generic [ref=e41]: Live Sources
                    - generic [ref=e42]:
                      - img [ref=e43]
                      - text: Export clear
                - generic [ref=e46]: Render destination
                - combobox "Render destination" [ref=e47]:
                  - option "Download" [selected]
                  - option "Project media"
                - button "Render" [ref=e48] [cursor=pointer]:
                  - img
                  - text: Render
            - region "Preview panel" [ref=e49]:
              - generic [ref=e51]:
                - generic [ref=e52]: Preview overlay transforms are available in the preview. Mode select. Precision disabled.
                - generic [ref=e55]:
                  - img [ref=e65]
                  - generic:
                    - button "Jump to beginning" [ref=e66] [cursor=pointer]:
                      - img
                    - button "Play" [ref=e67] [cursor=pointer]:
                      - img
                    - generic: 1280x720
          - generic [ref=e70]:
            - tablist [ref=e71]:
              - tab "Inspector" [selected] [ref=e72] [cursor=pointer]
              - tab "Extensions" [ref=e73] [cursor=pointer]
              - tab "Processes" [ref=e74] [cursor=pointer]
            - tabpanel "Inspector" [ref=e75]:
              - generic [ref=e77]: Select a clip to edit timing, position, audio, text, or effects.
          - generic [ref=e79]:
            - generic [ref=e80]:
              - generic [ref=e81]: saved
              - button "Undo" [disabled]:
                - img
              - button "Redo" [disabled]:
                - img
              - button "History" [ref=e82] [cursor=pointer]:
                - img
            - img [ref=e84]
            - generic [ref=e91]:
              - button "Maximize timeline" [ref=e92] [cursor=pointer]:
                - img
              - button "Zoom out timeline" [ref=e93] [cursor=pointer]:
                - img
              - button "Zoom in timeline" [ref=e94] [cursor=pointer]:
                - img
          - region "Extension activity" [ref=e96]
          - generic [ref=e100]:
            - button "Clear 1 unused" [ref=e101] [cursor=pointer]
            - generic [ref=e103]:
              - generic: 0:00.00
              - generic: 0:05.00
              - generic: 0:10.00
              - generic: 0:15.00
              - generic: 0:20.00
              - generic: 0:25.00
              - generic: 0:30.00
              - generic: 0:35.00
              - generic: 0:40.00
            - generic:
              - generic:
                - group "Timeline markers"
                - group "Timeline markers"
                - group "Timeline markers"
                - group "Timeline markers"
                - group "Timeline markers"
                - group "Timeline markers"
              - group "Marker layer pages" [ref=e146]:
                - button "Previous marker layers" [disabled] [ref=e147]: ‹
                - generic [ref=e148]: Layers 1–6/11
                - button "Next marker layers" [ref=e149] [cursor=pointer]: ›
            - generic [ref=e150]:
              - generic [ref=e151]:
                - generic [ref=e152]:
                  - generic [ref=e154]:
                    - img [ref=e156]
                    - generic [ref=e159]: Video
                    - generic [ref=e160]:
                      - textbox [ref=e161]: Video
                      - generic [ref=e162]:
                        - button "Reorder track" [ref=e163]:
                          - img
                        - button "Track defaults" [ref=e164] [cursor=pointer]:
                          - img
                        - button "Remove track" [ref=e165] [cursor=pointer]:
                          - img
                  - button "paired-release.jpg" [ref=e167] [cursor=pointer]:
                    - generic [ref=e170]: paired-release.jpg
                - generic [ref=e175]:
                  - img [ref=e177]
                  - generic [ref=e180]: Video 2
                  - generic [ref=e181]:
                    - textbox [ref=e182]: Video 2
                    - generic [ref=e183]:
                      - button "Reorder track" [ref=e184]:
                        - img
                      - button "Track defaults" [ref=e185] [cursor=pointer]:
                        - img
                      - button "Remove track" [ref=e186] [cursor=pointer]:
                        - img
                - generic [ref=e189]:
                  - img [ref=e191]
                  - generic [ref=e195]: Audio
                  - generic [ref=e196]:
                    - textbox [ref=e197]: Audio
                    - generic [ref=e198]:
                      - button "Reorder track" [ref=e199]:
                        - img
                      - button "Track defaults" [ref=e200] [cursor=pointer]:
                        - img
                      - button "Remove track" [ref=e201] [cursor=pointer]:
                        - img
                - status [ref=e202]
                - group "Data lanes" [ref=e203]:
                  - generic [ref=e204]:
                    - generic [ref=e205]:
                      - generic "Runaway transitions" [ref=e206]
                      - generic "116 of 566 lane items mounted" [ref=e207]: 116/566
                    - group "566 transitions, 116 shown, 2 of 11 regions in window" [ref=e210]:
                      - generic "S01 · Opening main notes"
                      - generic "S02 · Drive A"
                      - button "T0001, S01, rose, 0.292 seconds" [ref=e211] [cursor=pointer]
                      - button "T0002, S01, teal, 1.792 seconds" [ref=e212] [cursor=pointer]
                      - button "T0003, S01, rose, 3.292 seconds" [ref=e213] [cursor=pointer]
                      - button "T0004, S01, teal, 4.792 seconds" [ref=e214] [cursor=pointer]
                      - button "T0005, S01, rose, 6.271 seconds" [ref=e215] [cursor=pointer]
                      - button "T0006, S01, teal, 7.792 seconds" [ref=e216] [cursor=pointer]
                      - button "T0007, S01, rose, 9.292 seconds" [ref=e217] [cursor=pointer]
                      - button "T0008, S01, teal, 10.833 seconds" [ref=e218] [cursor=pointer]
                      - button "T0009, S01, rose, 12.271 seconds" [ref=e219] [cursor=pointer]
                      - button "T0010, S01, teal, 13.792 seconds" [ref=e220] [cursor=pointer]
                      - button "T0011, S01, rose, 15.292 seconds" [ref=e221] [cursor=pointer]
                      - button "T0012, S01, teal, 16.792 seconds" [ref=e222] [cursor=pointer]
                      - button "T0013, S01, rose, 18.292 seconds" [ref=e223] [cursor=pointer]
                      - button "T0014, S01, teal, 19.792 seconds" [ref=e224] [cursor=pointer]
                      - button "T0015, S01, rose, 21.292 seconds" [ref=e225] [cursor=pointer]
                      - button "T0016, S01, teal, 22.792 seconds" [ref=e226] [cursor=pointer]
                      - button "T0017, S02, orange, 23.542 seconds" [ref=e227] [cursor=pointer]
                      - button "T0018, S02, blue, 23.729 seconds" [ref=e228] [cursor=pointer]
                      - button "T0019, S02, orange, 23.917 seconds" [ref=e229] [cursor=pointer]
                      - button "T0020, S02, blue, 24.104 seconds" [ref=e230] [cursor=pointer]
                      - button "T0021, S02, orange, 24.292 seconds" [ref=e231] [cursor=pointer]
                      - button "T0022, S02, blue, 24.479 seconds" [ref=e232] [cursor=pointer]
                      - button "T0023, S02, orange, 24.667 seconds" [ref=e233] [cursor=pointer]
                      - button "T0024, S02, blue, 24.854 seconds" [ref=e234] [cursor=pointer]
                      - button "T0025, S02, orange, 25.042 seconds" [ref=e235] [cursor=pointer]
                      - button "T0026, S02, blue, 25.229 seconds" [ref=e236] [cursor=pointer]
                      - button "T0027, S02, orange, 25.417 seconds" [ref=e237] [cursor=pointer]
                      - button "T0028, S02, blue, 25.604 seconds" [ref=e238] [cursor=pointer]
                      - button "T0029, S02, orange, 25.792 seconds" [ref=e239] [cursor=pointer]
                      - button "T0030, S02, blue, 25.979 seconds" [ref=e240] [cursor=pointer]
                      - button "T0031, S02, orange, 26.167 seconds" [ref=e241] [cursor=pointer]
                      - button "T0032, S02, blue, 26.354 seconds" [ref=e242] [cursor=pointer]
                      - button "T0033, S02, orange, 26.542 seconds" [ref=e243] [cursor=pointer]
                      - button "T0034, S02, blue, 26.729 seconds" [ref=e244] [cursor=pointer]
                      - button "T0035, S02, orange, 26.917 seconds" [ref=e245] [cursor=pointer]
                      - button "T0036, S02, blue, 27.104 seconds" [ref=e246] [cursor=pointer]
                      - button "T0037, S02, orange, 27.292 seconds" [ref=e247] [cursor=pointer]
                      - button "T0038, S02, blue, 27.479 seconds" [ref=e248] [cursor=pointer]
                      - button "T0039, S02, orange, 27.667 seconds" [ref=e249] [cursor=pointer]
                      - button "T0040, S02, blue, 27.854 seconds" [ref=e250] [cursor=pointer]
                      - button "T0041, S02, orange, 28.042 seconds" [ref=e251] [cursor=pointer]
                      - button "T0042, S02, blue, 28.229 seconds" [ref=e252] [cursor=pointer]
                      - button "T0043, S02, orange, 28.417 seconds" [ref=e253] [cursor=pointer]
                      - button "T0044, S02, blue, 28.604 seconds" [ref=e254] [cursor=pointer]
                      - button "T0045, S02, orange, 28.792 seconds" [ref=e255] [cursor=pointer]
                      - button "T0046, S02, blue, 28.979 seconds" [ref=e256] [cursor=pointer]
                      - button "T0047, S02, orange, 29.167 seconds" [ref=e257] [cursor=pointer]
                      - button "T0048, S02, blue, 29.354 seconds" [ref=e258] [cursor=pointer]
                      - button "T0049, S02, orange, 29.542 seconds" [ref=e259] [cursor=pointer]
                      - button "T0050, S02, blue, 29.729 seconds" [ref=e260] [cursor=pointer]
                      - button "T0051, S02, orange, 29.917 seconds" [ref=e261] [cursor=pointer]
                      - button "T0052, S02, blue, 30.104 seconds" [ref=e262] [cursor=pointer]
                      - button "T0053, S02, orange, 30.292 seconds" [ref=e263] [cursor=pointer]
                      - button "T0054, S02, blue, 30.479 seconds" [ref=e264] [cursor=pointer]
                      - button "T0055, S02, orange, 30.667 seconds" [ref=e265] [cursor=pointer]
                      - button "T0056, S02, blue, 30.854 seconds" [ref=e266] [cursor=pointer]
                      - button "T0057, S02, orange, 31.042 seconds" [ref=e267] [cursor=pointer]
                      - button "T0058, S02, blue, 31.229 seconds" [ref=e268] [cursor=pointer]
                      - button "T0059, S02, orange, 31.417 seconds" [ref=e269] [cursor=pointer]
                      - button "T0060, S02, blue, 31.604 seconds" [ref=e270] [cursor=pointer]
                      - button "T0061, S02, orange, 31.792 seconds" [ref=e271] [cursor=pointer]
                      - button "T0062, S02, blue, 31.979 seconds" [ref=e272] [cursor=pointer]
                      - button "T0063, S02, orange, 32.167 seconds" [ref=e273] [cursor=pointer]
                      - button "T0064, S02, blue, 32.354 seconds" [ref=e274] [cursor=pointer]
                      - button "T0065, S02, orange, 32.542 seconds" [ref=e275] [cursor=pointer]
                      - button "T0066, S02, blue, 32.729 seconds" [ref=e276] [cursor=pointer]
                      - button "T0067, S02, orange, 32.917 seconds" [ref=e277] [cursor=pointer]
                      - button "T0068, S02, blue, 33.104 seconds" [ref=e278] [cursor=pointer]
                      - button "T0069, S02, orange, 33.292 seconds" [ref=e279] [cursor=pointer]
                      - button "T0070, S02, blue, 33.479 seconds" [ref=e280] [cursor=pointer]
                      - button "T0071, S02, orange, 33.667 seconds" [ref=e281] [cursor=pointer]
                      - button "T0072, S02, blue, 33.854 seconds" [ref=e282] [cursor=pointer]
                      - button "T0073, S02, orange, 34.042 seconds" [ref=e283] [cursor=pointer]
                      - button "T0074, S02, blue, 34.229 seconds" [ref=e284] [cursor=pointer]
                      - button "T0075, S02, orange, 34.417 seconds" [ref=e285] [cursor=pointer]
                      - button "T0076, S02, blue, 34.604 seconds" [ref=e286] [cursor=pointer]
                      - button "T0077, S02, orange, 34.792 seconds" [ref=e287] [cursor=pointer]
                      - button "T0078, S02, blue, 34.979 seconds" [ref=e288] [cursor=pointer]
                      - button "T0079, S02, orange, 35.167 seconds" [ref=e289] [cursor=pointer]
                      - button "T0080, S02, blue, 35.354 seconds" [ref=e290] [cursor=pointer]
                      - button "T0081, S02, orange, 35.542 seconds" [ref=e291] [cursor=pointer]
                      - button "T0082, S02, blue, 35.729 seconds" [ref=e292] [cursor=pointer]
                      - button "T0083, S02, orange, 35.917 seconds" [ref=e293] [cursor=pointer]
                      - button "T0084, S02, blue, 36.104 seconds" [ref=e294] [cursor=pointer]
                      - button "T0085, S02, orange, 36.292 seconds" [ref=e295] [cursor=pointer]
                      - button "T0086, S02, blue, 36.479 seconds" [ref=e296] [cursor=pointer]
                      - button "T0087, S02, orange, 36.667 seconds" [ref=e297] [cursor=pointer]
                      - button "T0088, S02, blue, 36.854 seconds" [ref=e298] [cursor=pointer]
                      - button "T0089, S02, orange, 37.042 seconds" [ref=e299] [cursor=pointer]
                      - button "T0090, S02, blue, 37.229 seconds" [ref=e300] [cursor=pointer]
                      - button "T0091, S02, orange, 37.417 seconds" [ref=e301] [cursor=pointer]
                      - button "T0092, S02, blue, 37.604 seconds" [ref=e302] [cursor=pointer]
                      - button "T0093, S02, orange, 37.792 seconds" [ref=e303] [cursor=pointer]
                      - button "T0094, S02, blue, 37.979 seconds" [ref=e304] [cursor=pointer]
                      - button "T0095, S02, orange, 38.167 seconds" [ref=e305] [cursor=pointer]
                      - button "T0096, S02, blue, 38.354 seconds" [ref=e306] [cursor=pointer]
                      - button "T0097, S02, orange, 38.542 seconds" [ref=e307] [cursor=pointer]
                      - button "T0098, S02, blue, 38.729 seconds" [ref=e308] [cursor=pointer]
                      - button "T0099, S02, orange, 38.917 seconds" [ref=e309] [cursor=pointer]
                      - button "T0100, S02, blue, 39.104 seconds" [ref=e310] [cursor=pointer]
                      - button "T0101, S02, orange, 39.292 seconds" [ref=e311] [cursor=pointer]
                      - button "T0102, S02, blue, 39.479 seconds" [ref=e312] [cursor=pointer]
                      - button "T0103, S02, orange, 39.667 seconds" [ref=e313] [cursor=pointer]
                      - button "T0104, S02, blue, 39.854 seconds" [ref=e314] [cursor=pointer]
                      - button "T0105, S02, orange, 40.042 seconds" [ref=e315] [cursor=pointer]
                      - button "T0106, S02, blue, 40.229 seconds" [ref=e316] [cursor=pointer]
                      - button "T0107, S02, orange, 40.417 seconds" [ref=e317] [cursor=pointer]
                      - button "T0108, S02, blue, 40.604 seconds" [ref=e318] [cursor=pointer]
                      - button "T0109, S02, orange, 40.792 seconds" [ref=e319] [cursor=pointer]
                      - button "T0110, S02, blue, 40.979 seconds" [ref=e320] [cursor=pointer]
                      - button "T0111, S02, orange, 41.167 seconds" [ref=e321] [cursor=pointer]
                      - button "T0112, S02, blue, 41.354 seconds" [ref=e322] [cursor=pointer]
                      - button "T0113, S02, orange, 41.542 seconds" [ref=e323] [cursor=pointer]
                      - button "T0114, S02, blue, 41.729 seconds" [ref=e324] [cursor=pointer]
                      - button "T0115, S02, orange, 41.917 seconds" [ref=e325] [cursor=pointer]
                      - button "T0116, S02, blue, 42.104 seconds" [ref=e326] [cursor=pointer]
              - generic [ref=e328]:
                - button "+ Video" [ref=e329] [cursor=pointer]
                - button "+ Audio" [ref=e330] [cursor=pointer]
            - generic:
              - generic "Drag onto timeline to add text" [ref=e332]:
                - img [ref=e333]
                - generic: New text
              - generic "Drag onto timeline to add an effect layer" [ref=e335]:
                - img [ref=e336]
                - generic: New effect
              - button "Create animation sequence" [ref=e340] [cursor=pointer]:
                - img [ref=e341]
                - generic: Create animation sequence
        - generic [ref=e343]:
          - generic [ref=e344]: Scene Markers
          - generic [ref=e345]: Playhead 0.00s
          - generic [ref=e346]: No markers — press B at each phase.
          - button "Mark (B)" [ref=e347] [cursor=pointer]
          - generic [ref=e349]:
            - text: Track
            - combobox "Track" [ref=e350]:
              - option "V1" [selected]
              - option "V2"
          - generic [ref=e351]:
            - text: Tail duration
            - spinbutton "Tail duration" [ref=e352]
          - button "Align shots to transitions" [disabled] [ref=e353]
          - button "Clear/Delete Data" [disabled] [ref=e355]
        - generic [ref=e356]:
          - generic [ref=e358]: codePanel — M4
          - generic [ref=e360]: writingPanel — M4
          - generic [ref=e362]: stagePanel — M3
    - button "Lock pane" [ref=e364] [cursor=pointer]:
      - img
    - generic [ref=e366]: Select a project to browse shots
    - generic [ref=e367]:
      - button "Open Action pane (0 active tasks)" [ref=e368] [cursor=pointer]:
        - generic [ref=e369]: "0"
      - button "Lock pane" [ref=e370] [cursor=pointer]:
        - img
    - generic [ref=e372]:
      - generic:
        - generic:
          - heading "Action" [level=2]
          - generic:
            - button "Cancel All" [disabled]
        - generic:
          - generic:
            - generic:
              - button "Processing (0)":
                - generic: Processing
                - generic: (0)
              - button "Succeeded (0)":
                - generic: Succeeded
                - generic: (0)
              - button "Failed (0)":
                - generic: Failed
                - generic: (0)
          - generic:
            - combobox:
              - generic: all
            - textbox: all
            - combobox:
              - generic: current
            - textbox: current
        - generic:
          - generic:
            - generic:
              - paragraph: No tasks processing
        - button "Expand tasks to fill pane":
          - img
      - generic [ref=e373]:
        - generic [ref=e374]:
          - img [ref=e375]
          - paragraph [ref=e376]: Timeline agent chat is managed in Astrid
          - paragraph [ref=e377]: Run the agent workflow in Astrid, then refresh this editor to load the updated timeline.
        - button "Expand chat to fill pane" [ref=e378] [cursor=pointer]:
          - img [ref=e379]
    - generic [ref=e381]:
      - 'button "Current tool: Video Editor" [ref=e382] [cursor=pointer]':
        - img
      - button "Lock pane" [ref=e383] [cursor=pointer]:
        - img
    - generic [ref=e384]:
      - generic:
        - generic:
          - generic:
            - img
            - heading "Tools" [level=2]
        - generic:
          - generic:
            - heading "Main Tools" [level=3]
            - generic:
              - generic:
                - generic:
                  - generic:
                    - generic:
                      - img
                    - generic:
                      - heading "Generate Images" [level=3]
                      - paragraph: Structure, LoRAs + prompt control.
                    - generic:
                      - button "Set as default landing tool":
                        - img
              - generic:
                - generic:
                  - generic:
                    - generic:
                      - img
                    - generic:
                      - heading "Travel Between Images" [level=3]
                      - paragraph: Image anchors with structure + LoRA control!
                    - generic:
                      - button "Default landing tool":
                        - img
              - generic:
                - generic:
                  - generic:
                    - generic:
                      - img
                    - generic:
                      - heading "Video Editor" [level=3]
                      - paragraph: Multi-track timeline + custom effects.
                    - generic:
                      - button "Set as default landing tool":
                        - img
          - generic:
            - heading "Assistant Tools" [level=3]
            - generic:
              - generic:
                - generic:
                  - generic:
                    - generic:
                      - img
                    - generic:
                      - heading "Animate Characters" [level=3]
                      - paragraph: Drive motion from reference video.
                    - generic:
                      - button "Set as default landing tool":
                        - img
              - generic:
                - generic:
                  - generic:
                    - generic:
                      - img
                    - generic:
                      - heading "Join Clips" [level=3]
                      - paragraph: AI-generated transitions between clips.
                    - generic:
                      - button "Set as default landing tool":
                        - img
              - generic:
                - generic:
                  - generic:
                    - generic:
                      - img
                    - generic:
                      - heading "Edit Images" [level=3]
                      - paragraph: Prompt edits, inpaint, restyle + transforms.
                    - generic:
                      - button "Set as default landing tool":
                        - img
              - generic:
                - generic:
                  - generic:
                    - generic:
                      - img
                    - generic:
                      - heading "Edit Videos" [level=3]
                      - paragraph: Regenerate + fix video segments.
                    - generic:
                      - button "Set as default landing tool":
                        - img
    - generic [ref=e385]:
      - button "Go to Image Generation tool" [ref=e386] [cursor=pointer]:
        - img
      - button "Lock pane" [ref=e387] [cursor=pointer]:
        - img
      - button "Generate new image" [ref=e388] [cursor=pointer]:
        - img
    - generic [ref=e389]:
      - generic:
        - generic:
          - generic:
            - generic:
              - generic:
                - generic:
                  - combobox:
                    - generic: no-shot
                  - textbox: no-shot
              - generic:
                - button "Search prompts":
                  - img
            - generic:
              - generic:
                - button "Images"
                - button "Videos"
          - generic:
            - generic:
              - generic: No items
            - generic:
              - button "Show only starred items":
                - img
        - generic:
          - generic: No generations found for this project.
  - region "Notifications"
  - status [ref=e390]
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