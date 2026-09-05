import { describe, expect, it } from "vitest";
import { withPreviewCursor } from "./preview-cursor";

describe("preview cursor", () => {
  it("puts the cursor rule before generated styles while preserving the document", () => {
    const html =
      '<!DOCTYPE html><html><HEAD lang="en"><style>button{cursor:pointer!important}</style></HEAD><body><button>Go</button></body></html>';
    const result = withPreviewCursor(html);
    expect(result.startsWith('<!DOCTYPE html><html><HEAD lang="en">')).toBe(true);
    expect(result.indexOf("@layer harpyhare-cursor")).toBeLessThan(result.indexOf("button{cursor"));
    const doc = new DOMParser().parseFromString(result, "text/html");
    expect(doc.querySelector("button")?.textContent).toBe("Go");
    expect(doc.head.querySelector("#harpyhare-preview-cursor")).not.toBeNull();
  });

  it("supports fragments and documents without an explicit head", () => {
    for (const html of ["<p>Hello</p>", "<!doctype html><p>Hello</p>"]) {
      const result = withPreviewCursor(html);
      if (html.startsWith("<!doctype")) expect(result.startsWith("<!doctype html>")).toBe(true);
      expect(result).toContain("<p>Hello</p>");
      expect(result).toContain("cursor: default !important");
    }
  });

  it("does not duplicate the rule or turn an empty preview into a document", () => {
    expect(withPreviewCursor("")).toBe("");
    const first = withPreviewCursor("<p>Hello</p>");
    expect(withPreviewCursor(first)).toBe(first);
  });
});
