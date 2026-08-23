import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";
import { openEditor, resetBridgeBaseline } from "./support";

const EVIDENCE_DIR = resolve(
  process.cwd(),
  "docs/extensions/evidence/chrome-acceptance",
);

const VIEWPORTS = [
  {
    name: "desktop",
    width: 1600,
    height: 1000,
    touch: false,
    screenshot: "25-shell-desktop-node20.png",
  },
  {
    name: "tablet-portrait",
    width: 834,
    height: 1194,
    touch: true,
    screenshot: "26-shell-tablet-portrait-node20.png",
  },
  {
    name: "phone",
    width: 420,
    height: 820,
    touch: true,
    screenshot: "27-shell-phone-node20.png",
  },
] as const;

async function auditMarkerLayerPages(
  page: Page,
): Promise<{ total: number; keys: string[] }> {
  const legend = page.getByTestId("timeline-marker-layer-legend");
  await expect(legend).toBeVisible();
  const next = legend.getByRole("button", { name: "Next marker layers" });
  const previous = legend.getByRole("button", {
    name: "Previous marker layers",
  });
  const keys = new Set<string>();
  let total = 0;

  for (let pageIndex = 0; pageIndex < 12; pageIndex += 1) {
    const label = (await legend.textContent()) ?? "";
    const match = /Layers \d+[–-]\d+\/(\d+)/.exec(label);
    expect(match, `unexpected marker pager label: ${label}`).not.toBeNull();
    total = Number(match![1]);

    const composition = await page.evaluate(() => {
      const layers = Array.from(
        document.querySelectorAll('[data-testid="timeline-marker-layer"]'),
      );
      const markers = Array.from(
        document.querySelectorAll("[data-marker-anchor-x]"),
      );
      const groups = new Map<
        string,
        Array<{ lane: string | null; offset: string | null }>
      >();
      for (const marker of markers) {
        const anchor = marker.getAttribute("data-marker-anchor-x") ?? "";
        const group = groups.get(anchor) ?? [];
        group.push({
          lane: marker.getAttribute("data-marker-layer-lane"),
          offset: marker.getAttribute("data-marker-visual-offset-x"),
        });
        groups.set(anchor, group);
      }
      return {
        keys: layers.map((layer) =>
          layer.getAttribute("data-marker-layer-key"),
        ),
        indexes: layers.map((layer) =>
          layer.getAttribute("data-marker-layer-index"),
        ),
        coincident: [...groups.values()]
          .filter((group) => group.length > 1)
          .map((group) => ({
            count: group.length,
            positions: new Set(
              group.map((entry) => `${entry.lane}:${entry.offset}`),
            ).size,
          })),
      };
    });

    expect(composition.keys.length).toBeGreaterThan(0);
    expect(new Set(composition.indexes).size).toBe(composition.indexes.length);
    for (const key of composition.keys) {
      expect(key).not.toBeNull();
      keys.add(key!);
    }
    for (const group of composition.coincident) {
      expect(group.positions, JSON.stringify(composition)).toBe(group.count);
    }

    if (await next.isDisabled()) break;
    const oldLabel = label;
    await next.click();
    await expect(legend).not.toHaveText(oldLabel);
  }

  expect(keys.size).toBe(total);
  while (!(await previous.isDisabled())) {
    await previous.click();
  }
  return { total, keys: [...keys] };
}

for (const viewport of VIEWPORTS) {
  test.describe(viewport.name, () => {
    test.use({
      viewport: { width: viewport.width, height: viewport.height },
      ...(viewport.touch
        ? { hasTouch: true, isMobile: true, deviceScaleFactor: 2 }
        : {}),
    });

    test(`keeps composed editor shell inside the ${viewport.name} viewport`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await resetBridgeBaseline();
      await openEditor(page);

      const geometry = await page.evaluate(() => {
        const rect = (selector: string) => {
          const element = document.querySelector(selector);
          if (!element) return null;
          const box = element.getBoundingClientRect();
          return {
            x: Math.round(box.x),
            y: Math.round(box.y),
            width: Math.round(box.width),
            height: Math.round(box.height),
            right: Math.round(box.right),
            bottom: Math.round(box.bottom),
          };
        };
        return {
          viewport: { width: window.innerWidth, height: window.innerHeight },
          page: {
            bodyWidth: document.body.scrollWidth,
            documentWidth: document.documentElement.scrollWidth,
          },
          main: rect("main.grid"),
          toolbarNavigation: rect(
            '[data-testid="toolbar-navigation-controls"]',
          ),
          phoneModeBar: rect('[aria-label="Phone timeline mode bar"]'),
          compactModeBar: rect('[aria-label="Timeline mode switcher"]'),
          markerPager: rect('[data-testid="timeline-marker-layer-legend"]'),
          sceneMarkersPanel: rect('[data-testid="scene-markers-panel"]'),
          editArea: rect(".timeline-canvas-edit-area"),
          preview: rect('[data-testid="video-editor-preview-surface"]'),
          selectors: Array.from(
            document.querySelectorAll(
              '[data-testid="editor-project-timeline-selectors"] [role="combobox"]',
            ),
          ).map((element) => {
            const box = element.getBoundingClientRect();
            return { left: Math.round(box.left), right: Math.round(box.right) };
          }),
          sceneMarkerControls: Array.from(
            document.querySelectorAll(
              '[data-testid="scene-markers-panel"] button, [data-testid="scene-markers-panel"] select, [data-testid="scene-markers-panel"] input',
            ),
          ).map((element) => {
            const box = element.getBoundingClientRect();
            return {
              label:
                element.getAttribute("data-testid") ??
                element.getAttribute("aria-label") ??
                element.textContent?.trim() ??
                element.tagName,
              left: Math.round(box.left),
              top: Math.round(box.top),
              right: Math.round(box.right),
              bottom: Math.round(box.bottom),
            };
          }),
        };
      });

      expect(
        geometry.page.bodyWidth,
        JSON.stringify(geometry),
      ).toBeLessThanOrEqual(viewport.width);
      expect(
        geometry.page.documentWidth,
        JSON.stringify(geometry),
      ).toBeLessThanOrEqual(viewport.width);
      for (const region of [
        geometry.main,
        geometry.editArea,
        geometry.preview,
        geometry.markerPager,
        geometry.sceneMarkersPanel,
      ]) {
        expect(region, JSON.stringify(geometry)).not.toBeNull();
        expect(region!.x, JSON.stringify(geometry)).toBeGreaterThanOrEqual(0);
        expect(region!.right, JSON.stringify(geometry)).toBeLessThanOrEqual(
          viewport.width,
        );
      }
      expect(geometry.sceneMarkerControls).toHaveLength(5);
      for (const control of geometry.sceneMarkerControls) {
        expect(control.left, JSON.stringify(geometry)).toBeGreaterThanOrEqual(
          0,
        );
        expect(control.top, JSON.stringify(geometry)).toBeGreaterThanOrEqual(0);
        expect(control.right, JSON.stringify(geometry)).toBeLessThanOrEqual(
          viewport.width,
        );
        expect(control.bottom, JSON.stringify(geometry)).toBeLessThanOrEqual(
          viewport.height,
        );
      }
      for (const selector of geometry.selectors) {
        expect(selector.left, JSON.stringify(geometry)).toBeGreaterThanOrEqual(
          0,
        );
        expect(selector.right, JSON.stringify(geometry)).toBeLessThanOrEqual(
          viewport.width,
        );
      }

      if (viewport.name === "phone") {
        expect(geometry.phoneModeBar, JSON.stringify(geometry)).not.toBeNull();
        expect(
          geometry.phoneModeBar!.right,
          JSON.stringify(geometry),
        ).toBeLessThanOrEqual(viewport.width);
      } else if (viewport.name === "tablet-portrait") {
        expect(
          geometry.compactModeBar,
          JSON.stringify(geometry),
        ).not.toBeNull();
        expect(
          geometry.compactModeBar!.right,
          JSON.stringify(geometry),
        ).toBeLessThanOrEqual(viewport.width);
      }
      if (viewport.name === "desktop") {
        expect(geometry.sceneMarkersPanel!.height).toBeLessThanOrEqual(36);
      } else {
        expect(geometry.sceneMarkersPanel!.height).toBeGreaterThan(36);
      }

      const layerComposition = await auditMarkerLayerPages(page);
      expect(layerComposition.total).toBe(11);

      await page.screenshot({
        path: resolve(EVIDENCE_DIR, viewport.screenshot),
        fullPage: true,
        animations: "disabled",
      });
    });
  });
}
