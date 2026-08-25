#!/usr/bin/env python3
"""Capture how-to screenshots against a running VidPlot server."""

from __future__ import annotations

import os
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

OUT = Path(__file__).resolve().parent
BASE = os.environ.get("VIDPLOT_URL", "http://127.0.0.1:64162")
SAMPLE = (
    "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/"
    "Big_Buck_Bunny_720_10s_10MB.mp4"
)
SAMPLE_B = (
    "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/"
    "Big_Buck_Bunny_360_10s_1MB.mp4"
)
VIEWPORT = {"width": 1440, "height": 900}


def shot(page, name: str) -> None:
    path = OUT / name
    page.screenshot(path=str(path), type="png")
    print(f"wrote {path.name} ({path.stat().st_size // 1024} KB)")


def wait_loaded(page, timeout_ms: int = 180_000) -> None:
    page.wait_for_selector("#workspace", state="visible", timeout=timeout_ms)
    page.wait_for_function(
        "() => document.body.classList.contains('is-loaded')",
        timeout=timeout_ms,
    )
    try:
        page.wait_for_function(
            """() => !!document.querySelector(
              '#frameChart .js-plotly-plot, #frameChart .plot-container, #frameChart svg'
            )""",
            timeout=120_000,
        )
    except Exception as exc:
        print(f"warn: frame chart: {exc}")
    page.wait_for_timeout(1000)


def open_sample(page, url: str = SAMPLE) -> None:
    page.goto(BASE + "/", wait_until="domcontentloaded")
    page.wait_for_selector("#urlOpenInput", timeout=30_000)
    page.fill("#urlOpenInput", url)
    page.click("#urlOpenBtn")
    wait_loaded(page)


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_context(
            viewport=VIEWPORT,
            device_scale_factor=2,
        ).new_page()
        page.set_default_timeout(90_000)

        # 01 — launch
        page.goto(BASE + "/", wait_until="networkidle")
        page.wait_for_selector("#dropArea")
        page.wait_for_timeout(500)
        shot(page, "howto-01-launch.png")

        # Open + catch mid-analyze status
        page.fill("#urlOpenInput", SAMPLE)
        page.click("#urlOpenBtn")
        page.wait_for_selector("#workspace", state="visible", timeout=60_000)
        page.wait_for_timeout(600)
        shot(page, "howto-03-analysis-status.png")
        wait_loaded(page)
        page.wait_for_timeout(1200)

        # 02 overview
        shot(page, "howto-02-overview.png")

        # 06 transport (crop-ish: full page still fine)
        shot(page, "howto-06-transport.png")

        # 04 tracks & properties
        page.locator("#streamTree >> nth=0").click(timeout=3000)
        page.wait_for_timeout(400)
        shot(page, "howto-04-tracks-properties.png")

        # 05 frame graph hover
        chart = page.locator("#frameChart")
        box = chart.bounding_box()
        if box:
            page.mouse.move(box["x"] + box["width"] * 0.42, box["y"] + box["height"] * 0.35)
            page.wait_for_timeout(700)
        shot(page, "howto-05-frame-graph.png")

        # 07 scopes
        for scope in ("waveform", "rgbparade"):
            btn = page.locator(f'.scope-toggle[data-scope="{scope}"]')
            if btn.get_attribute("aria-checked") != "true":
                btn.click()
            page.wait_for_timeout(1000)
        page.wait_for_timeout(1500)
        shot(page, "howto-07-scopes.png")

        for scope in ("waveform", "rgbparade"):
            btn = page.locator(f'.scope-toggle[data-scope="{scope}"]')
            if btn.get_attribute("aria-checked") == "true":
                btn.click()
                page.wait_for_timeout(200)
        qp = page.locator('.scope-toggle[data-scope="qpmap"]')
        qp.click()
        page.wait_for_timeout(2500)
        shot(page, "howto-07-qpmap.png")
        if qp.get_attribute("aria-checked") == "true":
            qp.click()
            page.wait_for_timeout(300)

        # 08 options
        page.locator("#sideMenuToggle").click()
        page.wait_for_timeout(600)
        shot(page, "howto-08-options.png")
        page.locator("#sideMenuFold").click()
        page.wait_for_timeout(300)

        # 09 load choice (dialog)
        page.evaluate(
            """() => {
              const d = document.getElementById('loadChoiceDialog');
              d.hidden = false;
            }"""
        )
        page.wait_for_timeout(300)
        shot(page, "howto-09-load-choice.png")
        page.evaluate("() => { document.getElementById('loadChoiceDialog').hidden = true; }")

        # 10 raw params
        page.evaluate(
            """() => {
              const d = document.getElementById('rawParamsDialog');
              d.hidden = false;
              const hint = document.getElementById('rawParamsFileHint');
              if (hint) hint.textContent =
                'sample.yuv needs pixel format, size, and frame rate.';
              const pix = document.getElementById('rawPixFmt');
              const rate = document.getElementById('rawFrameRate');
              const size = document.getElementById('rawSize');
              if (pix) pix.value = 'yuv420p';
              if (rate) rate.value = '25';
              if (size) size.value = '1920x1080';
            }"""
        )
        page.wait_for_timeout(300)
        shot(page, "howto-10-raw-params.png")
        page.evaluate("() => { document.getElementById('rawParamsDialog').hidden = true; }")

        # 11–12 compare + B offset
        print("starting compare with B…")
        result = page.evaluate(
            """async (urlB) => {
              if (typeof window.vidplotStartCompare !== 'function') {
                return { ok: false, err: 'no vidplotStartCompare' };
              }
              await window.vidplotStartCompare(urlB);
              return { ok: true };
            }""",
            SAMPLE_B,
        )
        print("compare:", result)
        page.wait_for_selector("#compareStage:not([hidden])", timeout=120_000)
        # Wait for B preview / labels
        page.wait_for_timeout(4000)
        try:
            page.wait_for_function(
                """() => {
                  const a = document.getElementById('compareLabelA');
                  const b = document.getElementById('compareLabelB');
                  return !!(a && b && (a.textContent || b.textContent));
                }""",
                timeout=30_000,
            )
        except Exception:
            pass
        page.wait_for_timeout(1500)
        shot(page, "howto-11-compare-wipe.png")

        page.evaluate(
            """() => {
              if (typeof window.vidplotSetCompareOffsetFrames === 'function') {
                window.vidplotSetCompareOffsetFrames(3);
              }
            }"""
        )
        page.wait_for_timeout(1200)
        shot(page, "howto-12-b-offset.png")

        # 13 layout fold
        if page.locator("#compareEndBtn").count():
            page.locator("#compareEndBtn").click()
            page.wait_for_timeout(800)
        page.locator("#graphPanelToggle").click()
        page.wait_for_timeout(600)
        shot(page, "howto-13-layout.png")

        browser.close()

    print("done →", OUT)
    for p in sorted(OUT.glob("howto-*.png")):
        print(f"  {p.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
