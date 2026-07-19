import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { define } from "./index";
import {
  dictionaryContext,
  morphologicalCandidates,
  normalizeDictionaryTerm,
  selectContextualSense,
  type CompactSense,
} from "./lookup";

describe("offline dictionary lookup", () => {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith("/dict/manifest.json")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            name: "Princeton WordNet",
            version: "3.1",
            shards: { r: { entries: 1, bytes: 1 } },
          }),
        ),
      );
    }
    if (url.endsWith("/dict/r.json")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            run: [["v", "move fast by using one's feet", "race sprint"]],
          }),
        ),
      );
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  });

  beforeAll(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("loads a local shard and resolves an inflected word", async () => {
    const result = await define("Running", "She was running quickly on her feet.");
    expect(result.message).toBeNull();
    expect(result.definition).toMatchObject({
      word: "running",
      headword: "run",
      partOfSpeech: "verb",
      source: "Princeton WordNet 3.1",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/dict/manifest.json",
      expect.objectContaining({ credentials: "same-origin" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/dict/r.json",
      expect.objectContaining({ cache: "force-cache" }),
    );
  });

  it("normalizes punctuation and Unicode presentation forms", () => {
    expect(normalizeDictionaryTerm("  ‘QUIET’  ")).toBe("quiet");
    expect(normalizeDictionaryTerm("ice‐cream")).toBe("ice-cream");
  });

  it("generates conservative morphology candidates", () => {
    expect(morphologicalCandidates("children")).toContain("child");
    expect(morphologicalCandidates("studies")).toContain("study");
    expect(morphologicalCandidates("running")).toContain("run");
    expect(morphologicalCandidates("quieter")).toContain("quiet");
  });

  it("uses nearby book text to prefer a relevant sense", () => {
    const senses: CompactSense[] = [
      ["n", "a financial institution that accepts deposits", "depository"],
      ["n", "sloping land beside a body of water", "riverbank riverside"],
    ];
    expect(selectContextualSense(senses, "They rested on the river bank beside the water.")).toBe(
      senses[1],
    );
  });

  it("extracts a calm sentence context without breaking Malayalam", () => {
    expect(dictionaryContext("Earlier. അവൻ ", "പുസ്തകം", " വായിച്ചു. Later")).toBe(
      "അവൻ പുസ്തകം വായിച്ചു.",
    );
    const longLead = "This complete sentence begins well before the compact locator context and ";
    expect(
      dictionaryContext(`Earlier. ${longLead}`, "continues", " to its natural end. Later"),
    ).toBe(`${longLead}continues to its natural end.`);
  });
});
