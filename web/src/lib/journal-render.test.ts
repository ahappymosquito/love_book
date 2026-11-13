import { describe, expect, it } from "vitest";
import { escapeHtml, renderJournalBlocks, renderJournalDocument, safeImageSrc } from "./journal-render";
import type { JournalAssets, JournalEntry, JournalOut } from "./journal-types";

const EVIL = `<script>alert("x")</script><img src=x onerror=alert(1)>`;

function entry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: 1,
    kind: "memory",
    title: EVIL,
    description: `${EVIL}\n第二行`,
    occurred_at: "2026-03-04T12:00:00Z",
    creator_id: 1,
    meeting_session_id: null,
    meeting_title: null,
    locked: false,
    images: [],
    comments: [{ id: 9, author_id: 2, content: EVIL, created_at: "2026-03-04T13:00:00Z" }],
    gift: null,
    ...overrides,
  };
}

function journal(entries: JournalEntry[]): JournalOut {
  return {
    scope: "all",
    title: `我们的${EVIL}`,
    start: null,
    end: null,
    generated_at: "2026-11-13T10:00:00Z",
    pair: {
      users: [
        { id: 1, display_name: `<b>小花</b>`, avatar: "🌸", avatar_has_image: false, avatar_updated_at: null },
        { id: 2, display_name: `"阿木"`, avatar: null, avatar_has_image: false, avatar_updated_at: null },
      ],
      together_since: "2024-05-20",
      together_days: 908,
    },
    meetings: [{ id: 7, title: `<i>杭州</i>`, started_on: "2026-03-01", ended_on: "2026-03-04" }],
    months: [{ month: "2026-03", label: "2026年3月", entries }],
    stats: { entry_count: entries.length, image_count: 0, gift_count: 0, meeting_count: 1 },
  };
}

const NO_ASSETS: JournalAssets = { images: new Map(), failedImages: new Set(), avatars: new Map() };

describe("escapeHtml", () => {
  it("escapes every HTML-significant character", () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&\``)).toBe("&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&#96;");
    expect(escapeHtml(null)).toBe("");
  });
});

describe("safeImageSrc", () => {
  it("only accepts base64 image data URLs", () => {
    expect(safeImageSrc("data:image/jpeg;base64,AAAA")).toBe("data:image/jpeg;base64,AAAA");
    expect(safeImageSrc("javascript:alert(1)")).toBeNull();
    expect(safeImageSrc('data:image/png;base64,AA" onerror="x')).toBeNull();
    expect(safeImageSrc("https://example.com/a.png")).toBeNull();
  });
});

describe("renderJournalDocument", () => {
  it("never lets user text become markup in the exported file", () => {
    const doc = renderJournalDocument(
      journal([
        entry(),
        entry({ id: 2, kind: "offline_meeting", meeting_session_id: 7, meeting_title: EVIL }),
        entry({
          id: 3,
          kind: "gift",
          gift: {
            state: "opened",
            sender_id: 1,
            receiver_id: 2,
            wrap_style: "rose",
            teaser: EVIL,
            opened_at: "2026-03-05T00:00:00Z",
            feelings: ["happy", EVIL],
            rating: 4,
            feedback: EVIL,
          },
        }),
        entry({
          id: 4,
          kind: "gift",
          gift: { state: "wrapped", sender_id: 2, receiver_id: 1, wrap_style: "starry", teaser: EVIL, opened_at: null, feelings: [], rating: null, feedback: null },
        }),
      ]),
      NO_ASSETS,
      { layout: "web", animate: true, includeImages: true },
    );
    expect(doc).not.toContain("<script>alert");
    expect(doc).not.toContain("<img src=x");
    expect(doc).not.toContain("<b>小花</b>");
    expect(doc).not.toContain("<i>杭州</i>");
    expect(doc).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(doc).toContain("&lt;b&gt;小花&lt;/b&gt;");
    expect(doc).toContain("<br>第二行");
    expect(doc).toContain("Content-Security-Policy");
    const scripts = doc.match(/<script>/g) ?? [];
    expect(scripts.length).toBe(2);
  });

  it("omits scripts in static layouts and renders locked entries as placeholders", () => {
    const doc = renderJournalDocument(journal([entry({ locked: true, title: "", description: null, comments: [] })]), NO_ASSETS, {
      layout: "web",
      animate: false,
      includeImages: false,
    });
    expect(doc).not.toContain("<script");
    expect(doc).toContain("还没解锁");
  });

  it("drops unsafe image sources and shows a placeholder for missing photos", () => {
    const assets: JournalAssets = { images: new Map([[5, "javascript:alert(1)"]]), failedImages: new Set([5]), avatars: new Map() };
    const doc = renderJournalDocument(journal([entry({ images: [{ id: 5, width: 800, height: 600 }] })]), assets, {
      layout: "web",
      animate: false,
      includeImages: true,
    });
    expect(doc).not.toContain("javascript:");
    expect(doc).toContain("照片暂时没取到");
  });
});

describe("renderJournalBlocks", () => {
  it("emits cover, month, meeting ticket, entries and closing in reading order", () => {
    const blocks = renderJournalBlocks(
      journal([entry(), entry({ id: 2, meeting_session_id: 7, meeting_title: "杭州" }), entry({ id: 3, meeting_session_id: 7, meeting_title: "杭州" })]),
      NO_ASSETS,
      { layout: "print", animate: false, includeImages: false },
    );
    expect(blocks.map((b) => b.kind)).toEqual(["cover", "month", "entry", "meeting", "entry", "entry", "closing"]);
  });

  it("shows an empty page when the range has no entries", () => {
    const blocks = renderJournalBlocks(journal([]), NO_ASSETS, { layout: "long", animate: false, includeImages: true });
    expect(blocks.map((b) => b.kind)).toEqual(["cover", "empty", "closing"]);
  });
});
