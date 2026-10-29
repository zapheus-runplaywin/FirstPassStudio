# Replay a recorded game's graphics in 4K

29 October 2026. Design only, no code yet. Also a Claude Doc: https://claude.ai/artifact/2EPMsEBAJTBfgCtxLjN3MB

Planning notes on the 2026-10-29 review: 4K became a Studio-wide control, Studio never plays video, demo games take only the competition, teams and athletes from the historic game.

## Summary

Revised after the review (2026-10-29). Three outcomes, three pieces of work. **4K** is one HD / 4K control on the Output page that sharpens every live output under the hood, with nothing to reconfigure. **Recording** keeps every on-air night as a file. That file then plays back three ways: a **practice game** (rehearsal, test data), a **demo game** (the client's competition and teams over the recorded game), and a **4K replay** (the night's graphics again, at 4K, for a switcher or recorder to lay over the 4K camera file). Studio never plays or processes video.

- Live stays at 1080p until you flip the 4K control. The control changes what the outputs send, not how anything is set up.
- A practice or demo game feeds the recording's PlayHQ data back into Studio, so Studio does everything it did on the night: auto-select, Follow PlayHQ, sequences at the breaks, streaks, moments.
- A 4K replay plays the on-air layer, so the graphics come out exactly as they went to air, including every manual override and Stream Deck press.
- Sound for a 4K re-record comes from the 1080p HyperDeck recording. It is the real programme mix.
- One Recordings tab holds all of it. Scoreboard control and the Output page only gain a red strip while a practice, demo or replay runs.

## 4K output mode

One control on the Output page, above the output cards: **HD** or **4K**. It is saved in the outputs settings (quality: hd or uhd) and remembered between launches. Flipping it changes what the outputs send and nothing else.

What 4K does under the hood:

- Each output keeps its saved format (for example 1080p50). With 4K on, Studio sends the 2160p version at the same rate: NDI always; Blackmagic only when the device offers a 2160p mode, otherwise that card says "stays 1080p on this device"; display outputs are unchanged (a 4K screen already draws at 2x).
- The output window keeps the 1920x1080 layout and draws at 2x, as the 4K design chose. The first PR checks the result is sharp, since one 2x path once looked soft.
- The clash, winner and streak canvases size by devicePixelRatio, and the stinger uses its 2160p file when one exists.
- Every page fits itself when opened larger than 1920x1080, so a browser source at 3840x2160 is sharp without `?fit=1` on the link. At 1920x1080 nothing changes.
- Soft-picture warnings on the Output page for raster logos and 1080p videos.

What must not change: saved format names, NDI source names, scene placements, sequences, /deck links, page links, Stream Deck keys, ATEM setup. Switching back to HD is lossless.

Not in scope: 4K ATEM control, 4K mics or sound changes.

## What gets recorded

One file per on-air night, from Open Studio until Studio goes off air, with a chapter for each game. It goes in a Recordings folder in the data folder, gzipped. Each entry is a time (ms since the recording began, plus the Mac's clock) and what happened. Two layers:

| Layer | What | Where it comes from today | Used by |
| --- | --- | --- | --- |
| Inputs | Every answer PlayHQ gave (live score, clock and quarter; line-ups and shooting stats; round games; ladders) and every operator action (score and clock presses, Follow PlayHQ / Manual, game picks, sequence plays, Delay / Next, sources shown and hidden, Stream Deck links) | playhq.js answers; board.js actions, /api/scene types, /deck links | Practice games, demo games, tests |
| On air | Every scene state and board message the pages were sent, and every answer the pages fetched from /api, including the ticker and streak polls | scene.js notify() and publishBoard(); the /api reads | 4K replay |

Things to get right:

- Clock times are absolute today (the board's clock has startedAt, the board has serverNow, games have start times). Playback shifts them by the gap between the recorded time and now, and the gap grows while playback is paused.
- Scene states are deduplicated the way publishBoard() already does, since notify() sends the whole state on every change.
- Recorded answers matter for load-once pages. A ladder replayed next week must show the ladder from the night, not the new one.
- Videos and logos are referenced by name. Playback warns if a media file used that night has gone or changed.
- Nothing secret is recorded: pairing keys, device secrets and Stream Deck keys stay out.
- Recordings hold athletes' names, so a recording committed to the repo as test data gets made-up names first.
- Recording is on by default; recordings older than 60 days are removed.

## Practice games and test data

A practice game plays a recording's inputs into Studio in place of PlayHQ, so the whole of Studio reacts as it did on the night. Studio already has a stand-in for PlayHQ in the tests (test/support/playhq.js, pointed at with `PLAYHQ_API_URL` and `PLAYHQ_SPECTATOR_URL`), so a practice game is that stand-in fed from a file, built into the app.

- **Where:** the Recordings tab lists nights and games. Pick one and press Practice. While it runs, Scoreboard control and the Output page show a red strip with Pause and Jump to (start, each quarter, final two minutes, full time).
- **Time:** the game is moved to start a few minutes from now, so "N min before the start" sequences and auto-select fire as they would. This is only inside a practice game; the rule against rewriting a picked round's dates stays.
- **Speed:** real time only. Studio's own clock runs between PlayHQ answers, so playing at 5x would make the clock wrong. Jump to covers skipping ahead.
- **Outputs:** can be on, so you can watch it on the real outputs.
- **Safety:** sponsor exposure, athlete records, the game cache, the automatic moments review and the ATEM switcher are not written or driven while it runs. Stop puts the real PlayHQ back.
- **Tests:** a short recording of a real Thunder League game, with made-up names, is committed to test/recordings, and journey tests play it through: auto-select, the QT sequence, a super shot, full time.

### Demo games (Matt, 2026-10-29)

A demo game is a practice game wearing the client's competition. You pick a recording, then a historic game in the client's competition setup. Studio takes the competition name and theme, the team names (with their logos and colours) and the athletes from that game. Everything else comes from the recording: the result, scores, clock, quarters, moments, streaks, stats and when each graphic went on air. Studio never plays or processes video. You play the pre-recorded game video wherever you like and lay Studio's output over it; the video not matching the competition or teams is fine.

- **Under the hood:** the recording carries the recorded competition's PlayHQ ids (organisation, season, grade, round, game) and Studio asks for the client's. The stand-in translates them, division to division, picked once. You don't see this.
- **Teams:** recorded Home and Away become the historic game's Home and Away. A Swap button lets the client's team be the winner.
- **Athletes:** matched by position, so the recorded GS's goals go to the historic game's GS. A table lets you change any pairing. When the historic game has no line-up, Studio uses the season's line-ups, then silhouettes. Bench players fill the remaining slots in order. A goal by an athlete with no match goes to the team only.
- **Rules:** quarter length and super shots follow the recording, so the score and moments stay true.
- **Ladder, fixtures, team lists, top shooters:** from the recording, with the mapped names.
- **Sponsors:** the client's, from their setup. No exposure is written.
- Mappings are saved by name, so a demo can be set up once and run again.

## Replaying the graphics at 4K

A 4K replay plays the night's on-air layer again through Studio's outputs, with the 4K control on. Studio never plays the video. A 4K switcher or recorder keys Studio's output over the 4K camera file, the same way the live stream keys it over the camera. A separate replay.html does the drawing, so scene.html stays untouched for live, and it works as a browser source at its own link.

**How it draws.** The 4K output mode above does the work. Pages keep their 1920x1080 layout and are drawn at 2x, so text, shapes and SVG logos come out sharp. Raster logos and 1080p videos are only as sharp as the files, and the Output page warns about those.

**Controls.** In the Recordings tab, pick a night and a game and press Replay. The red strip shows Play, Pause, a nudge of one frame or 100 ms either way, and a list of what went on air ("19:42:10 Scoreboard on", "Q1 start", "Super shot, Home") to jump to. Jumping sends the latest state before that time, so seeking is instant. Animations that were half way through start from their beginning. /deck/replay/play, pause, toggle, nudge and /deck/practice/... links let a Stream Deck run it, and they are listed in STREAMDECK.md.

**Sync.** Recordings store the Mac's time of day, and the 4K file's own start time gives the first guess at the offset. Clocks on two devices differ, so you then set one sync point: pause the video on a moment you can see, such as the first centre pass, and pick the matching entry (Q1 start) from the list. A nudge fixes the rest. The offset is saved with the recording, so a second take needs no new sync. With Play on a Stream Deck key and the video's play on another, one Multi Action starts both. A PlayHQ score lands when the scorer presses it, so it can be a second after the goal on the video. That is the same delay viewers saw live.

**Timecode (Matt asked 2026-10-29).** When the recorder's file carries time-of-day timecode (a HyperDeck's own clock, or timecode embedded from the ATEM), Studio reads the file's start timecode from its header with the bundled ffmpeg, no video processing, and sets the offset from that. The replay then starts at the right moment by itself. Two clocks can still differ by a second, so the nudge stays. The 1080p programme recording gives the exact frame: Studio's graphics are burned into it, so Studio can find the frame the scoreboard first appeared, lock the offset to it, and carry it to the 4K file by timecode. Pressing Play on both at a marked moment (the 10 min before sequence) is the fallback when there is no timecode.

## Sound

Take the sound from the 1080p HyperDeck recording. Don't save a sound track from Studio.

|  | Studio saves a sound track | Extract from the HyperDeck file |
| --- | --- | --- |
| What it holds | Only what Studio plays: videos, music, effects, mics routed through Studio | The real programme mix: commentary, court sound and Studio's sound, as streamed |
| Quality | Clean, but missing most of the mix | Whatever the HyperDeck records (PCM in ProRes or DNx, AAC in H.264 or H.265) |
| Sync | Free, it shares the recording's clock | One sync point, like the video |
| Work | New recording path, big files, one more thing to run on the night | None on the night. Studio copies the sound out with the bundled ffmpeg, no re-encode |

Syncing the HyperDeck file to the recording is easy because its picture has Studio's graphics burned in: pause on the frame the scoreboard first appears and the recording knows that time exactly. Studio can copy the sound out of the HyperDeck file with the bundled ffmpeg, no re-encode, if you want a plain audio file. Matching the camera file to the HyperDeck picture uses a moment that camera was live.

If the 4K ISO file already carries the programme mix, use that sound and skip the HyperDeck step. I haven't checked what your Rode puts in its ISO files.

## PR plan

Seven PRs, one change each. 4K first, since it stands alone and every later piece shows through it. Each PR keeps the Docs page, Data and bandwidth, the user guide, STREAMDECK.md and docs/ARCHITECTURE.md in sync. The feature bumps minor once.

1. **4K output mode.** The HD / 4K control, 2160p derived for NDI and Blackmagic, output window at 2x with a sharpness check, canvases by devicePixelRatio, pages fit themselves above 1080p, 2160p stinger pick, soft-picture warnings. Perf meter run on your M1 and M3 Pro.
2. **Record games.** The two-layer recording, the Recordings folder and tab (nights, games, size, delete), the record switch, 60-day tidy.
3. **Practice games.** Built-in PlayHQ stand-in fed from a recording, the red strip with Pause and Jump to, clock shifting, nothing written to exposure, athletes or the game cache.
4. **Tests from recordings.** A real-game recording with made-up names in test/recordings, the test stand-in loads it, journey tests for a whole game, clock-shift and pause tests.
5. **Demo games.** Id translation to the client's competition, team and athlete mapping table with line-up fallbacks, Swap, saved mappings.
6. **4K replay.** replay.html from the on-air layer, the Replay strip, event list, jump, sync point and nudge, /deck/replay links, missing-media warnings.
7. **Stream Deck keys** for practice, demo and replay in the plugin, with the Output dropdown as for other keys.

Later, only if syncing by hand proves fiddly: Studio renders the night's graphics to a 2160p ProRes 4444 file with alpha, frame by frame, the way the stinger is rendered, for an editor to composite.

## Questions for Matt

Decided 2026-10-29: 4K is one Studio-wide control (yes); Studio replays at 4K and never plays video (yes); demo games take only the competition, teams and athletes from the historic game. Still open, my default in brackets:

1. Record every on-air night by itself? [Yes, switch on by default, 60-day tidy]
2. OK to commit a real game's recording to the public repo with made-up names? [Yes]
3. Start with PR 1 (4K output mode) now, and PRs 2 to 4 after? [Yes]
