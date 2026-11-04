import { describe, expect, it } from "vitest";
import { createCustomMap } from "../../game/customMaps.ts";
import { createCustomMode } from "../../game/customModes.ts";
import {
  getMapSelectionLabel,
  isPathBlockerSelection,
  renderCreatorBlockListHtml,
  renderCreatorWaveListHtml,
  renderMapBlockerListHtml,
  renderMapPathListHtml,
} from "./creatorScreens.ts";

describe("creatorScreens", () => {
  describe("renderMapPathListHtml", () => {
    it("renders path cards with options and active status", () => {
      const map = createCustomMap();
      const html = renderMapPathListHtml(map.paths, 0);

      expect(html).toContain("map-path-card active");
      expect(html).toContain('data-action="map-select-path"');
      expect(html).toContain("SOLID PATH");
    });
  });

  describe("renderMapBlockerListHtml", () => {
    it("renders path blockers with controls", () => {
      const blockers = [
        { id: "blocker-1", pathIndex: 0, startDistance: 100, length: 120 },
      ];
      const html = renderMapBlockerListHtml(blockers, 1, { type: "pathBlocker", id: "blocker-1" });

      expect(html).toContain("map-blocker-card active");
      expect(html).toContain('data-blocker-id="blocker-1"');
      expect(html).toContain("120 UNITS");
    });
  });

  describe("getMapSelectionLabel", () => {
    it("returns correct label for point selection", () => {
      const map = createCustomMap();
      const label = getMapSelectionLabel(map, { type: "point", pathIndex: 0, index: 0 });
      expect(label).toContain("PATH 1 // NODE 00");
    });

    it("returns correct label for unselected state", () => {
      const map = createCustomMap();
      expect(getMapSelectionLabel(map, null)).toBe("SELECT A ROUTE POINT, BLOCKED ZONE, OR PATH BLOCKER");
    });
  });

  describe("renderCreatorWaveListHtml and renderCreatorBlockListHtml", () => {
    it("renders waves list with counts", () => {
      const mode = createCustomMode();
      const html = renderCreatorWaveListHtml(mode.waves, 0);

      expect(html).toContain("WAVE 01");
      expect(html).toContain('class="active"');
      expect(html).toContain('data-action="creator-select-wave"');
    });

    it("renders block list with delay calculations and enemy options", () => {
      const mode = createCustomMode();
      const wave = mode.waves[0]!;
      const html = renderCreatorBlockListHtml(wave.blocks, (kind) => `<option value="${kind}">${kind}</option>`);

      expect(html).toContain("command-block");
      expect(html).toContain("BLOCK 01");
      expect(html).toContain("START +0.00s");
      expect(html).toContain('data-block-field="enemy"');
      expect(html).toContain('data-block-field="customPathToggle"');
      expect(html).toContain('data-block-field="spawnPathIndex"');
      expect(html).toContain('disabled placeholder="AUTO"');
      expect(html).toContain("Map default");
    });

    it("renders block list with active custom spawn path and 1-based path number", () => {
      const mode = createCustomMode();
      const wave = mode.waves[0]!;
      wave.blocks = [
        { command: "enemyGroup", enemy: "rusher", count: 5, spawnDelay: 1, nextBlockDelay: 5, spawnPathIndex: 2 },
      ];
      const html = renderCreatorBlockListHtml(wave.blocks, (kind) => `<option value="${kind}">${kind}</option>`);

      expect(html).toContain('data-block-field="customPathToggle" data-block-index="0" checked');
      expect(html).toContain("CUSTOM");
      expect(html).toContain('value="3" data-block-field="spawnPathIndex"');
      expect(html).toContain("Path 3");
    });
  });

  describe("isPathBlockerSelection", () => {
    it("detects pathBlocker selection type", () => {
      expect(isPathBlockerSelection({ type: "pathBlocker", id: "1" })).toBe(true);
      expect(isPathBlockerSelection({ type: "zone", id: "1" })).toBe(false);
      expect(isPathBlockerSelection(null)).toBe(false);
    });
  });
});
