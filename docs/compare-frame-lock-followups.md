# Compare frame lock — deferred follow-ups

Known gaps left open by the compare frame-lock work, with the measurements
already taken so they don't have to be re-derived. Nothing here is a
regression: items 1 and 3 are pre-existing couplings the feature ran into,
item 2 is an optimisation the feature only applied to its own narrow path.

Measurements below were taken on two real DirecTV clips, both 1920×1080,
~417 s, ~12,500 frames:

| file | codec | size | `start_time` |
|---|---|---|---|
| `KCBS_full_1080p_vsr1p0_…_v5.mp4` | HEVC | 633 MB | 0.0 |
| `KCBS_8619_…_deinterlaced.mp4` | H.264 | 999 MB | 0.8 |

---

## 1. Transport keybinding is gated behind the decoded frame table

**Symptom.** On a long clip the compare offset control is live in ~0.4 s, but
`<` / `>` frame stepping does nothing for the first ~95 s. The chart shows
"Analyzing frames…" for that whole time.

**Cause.** `setupPlotlyChart()` (`static/js/plotly.js:177`) early-returns at the
frame-table guard on `:179`, and the transport keydown handler is not registered
until `:992`, at the very end of the same function. No decoded table means no
chart, and no chart means no key bindings — including the ones that have nothing
to do with the chart.

This is pre-existing. It was invisible before because a short clip's frame table
lands in well under a second; it only becomes visible once the lock itself stops
waiting for that table (see item 2).

**Confirmed, not assumed.** With the chart placeholder still showing,
`media.seekToFrame(3100, true)` moved the ref index 3000 → 3100 correctly, so the
lock mechanism is fully functional — only the key binding is missing. Stepping is
unaffected once the table lands: 9/9 aligned forward and back.

**Sketch.** Move the keydown registration (and the transport wiring it depends
on) ahead of the `:179` guard, leaving chart construction behind it. The obstacle
is that the intervening setup closes over `allFrames` / `frameTimestamps` /
`frameDuration`, so the split is not purely mechanical.

**Deliberately not done here.** This is the `transport` /
`suppressPauseSideEffects` area that the original brief fenced off as "fiddly and
works". Restructuring it is a scope decision, not a bug fix.

---

## 2. Source frame PTS and sizes globally from packets, not a full decode

**What was done so far.** `frame_times_for_path()` (`app.py:806`) and
`/api/frame-times` give a PTS-only probe with no decoding, and the compare frame
lock reads either that or the decoded table, whichever is available. That
unblocked the lock and nothing else.

**What is still on the table.** `analyze_frames_for_path()` (`app.py:745`)
decodes every frame of the file to report `pict_type`, and that is what the whole
app waits on before it can draw the frame chart.

| probe | HEVC 633 MB | H.264 999 MB |
|---|---|---|
| full decode (`-show_entries frame=…`) | 95 s (185 s cold) | 86 s |
| packet probe (`-show_entries packet=pts_time`) | **0.17 s** | **0.18 s** |

Equivalence was checked on the 12,500-frame HEVC file, not inferred:

- **12,500 / 12,500** packet `pts_time` values matched `best_effort_timestamp_time` exactly
- **12,500 / 12,500** packet `size` values matched `pkt_size` exactly

So both quantities the chart plots — timestamp and size — are available ~1000×
faster than they are currently obtained.

**The one genuine blocker.** `pict_type` (the I/P/B bar colouring) really does
require decoding. Packets carry only a keyframe flag (`K__`), which distinguishes
I from not-I but not P from B.

**Sketch.** Populate timestamps and sizes from the packet probe so the chart
draws almost immediately, then either (a) run the decode in the background and
recolour bars when `pict_type` arrives, or (b) make it on-demand for users who
want frame-type colouring. Packets come out in decode order and must be sorted by
PTS — B-frames put them out of order — which `frame_times_for_path()` already
does.

**Related cheap win.** `extract_mean_qp_per_frame()` (`app.py:548`) is a *third*
full decode pass per file (`-debug:v qp`, parsed line by line). On the HEVC file
it costs **17 s to return nothing** — `qp_available: false`, zero values, because
HEVC does not emit the QP debug output the parser needs. The docstring already
says so. Worth skipping the pass for codecs known not to produce it rather than
decoding the whole file to rediscover it each time. (On H.264 it works: ~20 s,
12,491 values.)

---

## 3. Active slot still repoints the global frame table

`setActiveSlot()` (`static/js/compare.js:93`) calls `setupPlotlyChart(B.jsonData)`,
which sets `window.vidplotJsonData` and re-captures the chart closures. So
clicking a slot still changes which table is "current" globally.

Stepping is now immune — it resolves against A's table via the lock — so this no
longer affects frame accuracy, which is why it was left alone. But the coupling
is still there, and anything else that reads `window.vidplotJsonData` while
compare mode is active still sees the active slot rather than A. Worth
decoupling if that global grows more readers.

---

## Not a bug, for the record

The two DirecTV clips differ in container `start_time` by 0.8 s. At 30000/1001
that is **23.976 frames — not an integer**, so it could never be expressed as a
frame offset. Per-slot resolution absorbs it: each slot resolves a ref index
against its own table, so the offset dialled in the toolbar is pure content
delay. Verified at ref index 3000 — A landed on its own timeline, B on its own,
separation 0.8 s, and offset +24 landed on B exactly where predicted.
