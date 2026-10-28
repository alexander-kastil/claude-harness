# Claude Harness 0.4.0 film: story

The film behind `docs/images/harness-demo.gif` (silent, 45.4 s, 800x550, 12 fps) and its narrated MP4 (45.4 s, 1024x704, H.264 + AAC). Lead line over the opening: "See what your harness does, then change it". The closing is the last 4.5 s of the 0.3 film.

Footage: an isolated VS Code at 1024x704 with the demo fixture (`test/ui/fixture.mjs`), the pointer drawn from recorded events, each scene ending on one hover card where it explains the point. Voice: inworld-ai/realtime-tts-1.5-max, voice Dennis (DeepInfra). Mix: -16.2 LUFS, peak -1.4 dBFS.

| Starts | Title on screen | Footage | Spoken |
|---|---|---|---|
| 0.00 s | Which agent did what | Search finds a session, its Delegation map; ends on the hover card of a stop sign | Your harness grew one agent at a time. Here is what it actually did. |
| 5.83 s | What it cost, what to fix | The cost row with Who spent it, then the Findings cards | Every run has a price. Each finding names the cost and the fix. |
| 11.33 s | Spot what never runs | A skill's Used in tab, then the Skills table filtered to Never used; ends on the "never" card | Some skills never ran once. Now you can see which ones. |
| 17.83 s | Find skills that fill your context | Ranked by description cost, the top skill's Size card; ends on the Size flag card | Others load into every session. Rank them by what they cost you. |
| 24.00 s | Edit globally or per repo | Edit mode, change the description, Save; ends on the Global chip card | Fix it right here, for every repo or just one. |
| 30.17 s | One source per skill | The Consolidate card of a differing repo copy, with Merge with Claude | Merge the copies into one source. |
| 34.58 s | Hand it to Claude, on your plan | Slim with Claude on the skill flagged before, its confirm card ("The run counts against your plan"), the terminal with the request loaded | Or hand the job to Claude, on your own plan. Claude Harness adds no charge. |
| 40.92 s | Closing | The 0.3 closing: the fleet overview and the end card | Claude Harness. See what your harness does, then change it. |
