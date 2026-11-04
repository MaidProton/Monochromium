import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assignCreatorAssets, createCreatorFolder, deleteCreatorFolder, emptyCreatorFolderState, loadCreatorFolders, renameCreatorFolder, sanitizeCreatorFolders, saveCreatorFolders } from "./creatorFolders.ts";
import { installTestStorage, uninstallTestStorage } from "./testStorage.ts";

describe("creator folder persistence", () => {
  beforeEach(() => installTestStorage());
  afterEach(() => uninstallTestStorage());

  it("drops duplicate folders and assignments to missing folders", () => {
    const state = sanitizeCreatorFolders({
      modes: [{ id: "folder-a", name: "A", createdAt: 1, updatedAt: 1 }, { id: "folder-a", name: "duplicate" }],
      assignments: { modes: { mode1: "folder-a", mode2: "missing" } },
    });
    expect(state.modes).toHaveLength(1);
    expect(state.assignments.modes).toEqual({ mode1: "folder-a" });
  });

  it("creates, renames, assigns, deletes, and round-trips folders", () => {
    const created = createCreatorFolder(emptyCreatorFolderState(), "maps", "  Route Tests  ");
    const folder = created.maps[0]!;
    const renamed = renameCreatorFolder(created, "maps", folder.id, "Renamed Routes");
    const assigned = assignCreatorAssets(renamed, "maps", ["custom-map:one", ""], folder.id);
    expect(assigned.maps[0]!.name).toBe("Renamed Routes");
    expect(assigned.assignments.maps).toEqual({ "custom-map:one": folder.id });
    saveCreatorFolders(assigned);
    expect(loadCreatorFolders()).toEqual(assigned);
    expect(deleteCreatorFolder(assigned, "maps", folder.id).assignments.maps).toEqual({});
  });
});
