/**
 * Stage 1, Task D1e — the path layer, and the public root's one rule.
 *
 * These tests are pure. Everything here is a decision made before a byte
 * reaches a filesystem, which is where a traversal has to be refused: by the
 * time a path has been joined and opened, "did that escape the root?" is a
 * question about the filesystem's behaviour rather than about ours.
 *
 * The brief for this task required a traversal test on EVERY user-influenced
 * path component. That phrase is doing work: it is not enough to test the one
 * component a reviewer happens to think of, because a builder with four
 * components has four chances to be wrong and only one of them is the obvious
 * one. So the traversal cases below are driven over the builders themselves.
 */

import { describe, it, expect } from "vitest";
import path from "node:path";
import {
  MAX_UPLOAD_BYTES,
  SEAL_EXTENSIONS,
  StoragePathError,
  absoluteSealUrl,
  allSealRelativePaths,
  documentRoot,
  exhibitRelativePath,
  minutesRelativePath,
  publicAssetRoot,
  resolveWithin,
  sealExtensionFor,
  sealRelativePath,
  sealUrlFor,
  sniffFamily,
} from "../paths.js";

const ROOT = "/srv/tmm/documents";
const TOWN = "11111111-1111-4111-8111-111111111111";
const MEETING = "22222222-2222-4222-8222-222222222222";
const ITEM = "33333333-3333-4333-8333-333333333333";
const DOC = "44444444-4444-4444-8444-444444444444";

/**
 * Shapes that must never resolve inside a root.
 *
 * Encodings are in here deliberately. `%2e%2e%2f` is not decoded by this
 * layer — Fastify decodes the URL before the handler sees it — but a value
 * read back out of the database has been through no decoder at all, and
 * `resolveWithin` is applied to those too. A guard that only handles the
 * decoded form is a guard that depends on which caller it is behind.
 */
const TRAVERSALS = [
  "../etc/passwd",
  "..",
  "../../root/.ssh/id_rsa",
  "minutes/../../etc/passwd",
  "minutes/../../../etc/passwd",
  "./minutes/x.pdf",
  "/etc/passwd",
  "//etc/passwd",
  "..%2fetc%2fpasswd",
  "%2e%2e/etc/passwd",
  "minutes/..%5c..%5cwindows",
  "minutes\\..\\..\\windows\\system32",
  "minutes/\0/x.pdf",
  "...",
  ".hidden/x.pdf",
  "minutes//x.pdf",
  "",
  "C:/windows/system32",
  "https://evil.example/x.pdf",
];

describe("resolveWithin", () => {
  it.each(TRAVERSALS)("refuses %j", (candidate) => {
    expect(() => resolveWithin(ROOT, candidate)).toThrow(StoragePathError);
  });

  it("accepts a plain contained path and returns it inside the root", () => {
    const absolute = resolveWithin(ROOT, `minutes/${TOWN}/${MEETING}/${DOC}.pdf`);
    expect(absolute).toBe(path.join(ROOT, "minutes", TOWN, MEETING, `${DOC}.pdf`));
    expect(absolute.startsWith(ROOT + path.sep)).toBe(true);
  });

  it("refuses a path that resolves exactly TO the root, not merely outside it", () => {
    // `resolveWithin(root, ".")` normalises to the root itself. Serving a
    // directory is not serving a document, and the containment check is
    // written as `startsWith(root + sep)` rather than `startsWith(root)` so
    // that a sibling directory named `documents-public` cannot pass either.
    expect(() => resolveWithin(ROOT, ".")).toThrow(StoragePathError);
    expect(() => resolveWithin("/srv/tmm/doc", "../documents/x.pdf")).toThrow(StoragePathError);
  });
});

describe("every user-influenced component of every built path", () => {
  // Each entry names a builder and the position of each id it takes, so a
  // traversal is tried in EVERY slot rather than only the first.
  const builders: Array<{
    name: string;
    build: (bad: string, slot: number) => string;
    slots: number;
  }> = [
    {
      name: "minutesRelativePath",
      slots: 3,
      build: (bad, slot) =>
        minutesRelativePath(
          slot === 0 ? bad : TOWN,
          slot === 1 ? bad : MEETING,
          slot === 2 ? bad : DOC,
        ),
    },
    {
      name: "exhibitRelativePath",
      slots: 4,
      build: (bad, slot) =>
        exhibitRelativePath(
          slot === 0 ? bad : TOWN,
          slot === 1 ? bad : ITEM,
          slot === 2 ? bad : DOC,
          slot === 3 ? bad : "pdf",
        ),
    },
  ];

  for (const builder of builders) {
    for (let slot = 0; slot < builder.slots; slot += 1) {
      it.each(TRAVERSALS)(`${builder.name} refuses %j in argument ${slot}`, (candidate) => {
        expect(() => builder.build(candidate, slot)).toThrow(StoragePathError);
      });
    }
  }

  it("sealRelativePath refuses a traversal in the town id", () => {
    for (const candidate of TRAVERSALS) {
      expect(() => sealRelativePath(candidate, "png")).toThrow(StoragePathError);
    }
  });

  it("refuses an id that is merely not a UUID, not only one that traverses", () => {
    // A non-UUID id is refused BEFORE it can be a traversal. That ordering is
    // what makes the built paths safe by construction rather than safe by
    // having enumerated the attacks.
    expect(() => minutesRelativePath("not-a-uuid", MEETING, DOC)).toThrow(StoragePathError);
    expect(() => exhibitRelativePath(TOWN, ITEM, "12345", "pdf")).toThrow(StoragePathError);
  });

  it("builds paths that resolve cleanly inside the document root", () => {
    for (const relative of [
      minutesRelativePath(TOWN, MEETING, DOC),
      exhibitRelativePath(TOWN, ITEM, DOC, "docx"),
    ]) {
      expect(() => resolveWithin(ROOT, relative)).not.toThrow();
    }
  });
});

describe("the public asset root holds seals and nothing else", () => {
  it("offers exactly one path builder, and it always produces seals/<uuid>.<ext>", () => {
    for (const ext of SEAL_EXTENSIONS) {
      const relative = sealRelativePath(TOWN, ext);
      expect(relative).toBe(`seals/${TOWN}.${ext}`);
      expect(relative.startsWith("seals/")).toBe(true);
    }
  });

  it("refuses every extension outside the two-element allowlist", () => {
    // SVG in particular: it was offered by the component that never worked,
    // and it is a script container served from the app's own origin.
    for (const ext of ["svg", "pdf", "html", "js", "php", "png.html", ""]) {
      expect(() => sealRelativePath(TOWN, ext as never)).toThrow(StoragePathError);
    }
  });

  it("decides the extension from the BYTES, so a renamed document is refused", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
    const html = new Uint8Array(Buffer.from("<html><script>alert(1)</script>"));
    const svg = new Uint8Array(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/>'));
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]);

    expect(sealExtensionFor(png)).toBe("png");
    expect(sealExtensionFor(jpeg)).toBe("jpg");
    // Everything a caller might try to smuggle into the one directory nginx
    // serves without a check.
    expect(sealExtensionFor(pdf)).toBeUndefined();
    expect(sealExtensionFor(html)).toBeUndefined();
    expect(sealExtensionFor(svg)).toBeUndefined();
    expect(sealExtensionFor(zip)).toBeUndefined();
    expect(sealExtensionFor(new Uint8Array())).toBeUndefined();
  });

  it("names every path a town's seal could occupy, for the replace sweep", () => {
    expect(allSealRelativePaths(TOWN).sort()).toEqual(
      [`seals/${TOWN}.jpg`, `seals/${TOWN}.png`].sort(),
    );
  });

  it("stores a root-relative URL under the one public prefix", () => {
    expect(sealUrlFor(sealRelativePath(TOWN, "png"))).toBe(`/public-assets/seals/${TOWN}.png`);
  });
});

describe("absoluteSealUrl", () => {
  it("resolves the stored relative path against APP_URL for mail and Chromium", () => {
    const previous = process.env.APP_URL;
    process.env.APP_URL = "https://app.example.gov/";
    try {
      expect(absoluteSealUrl(`/public-assets/seals/${TOWN}.png`)).toBe(
        `https://app.example.gov/public-assets/seals/${TOWN}.png`,
      );
    } finally {
      if (previous === undefined) delete process.env.APP_URL;
      else process.env.APP_URL = previous;
    }
  });

  it("leaves an already-absolute value alone, so pre-existing rows still render", () => {
    const stored = "https://supabase.example/storage/v1/object/public/town-seals/x.png";
    expect(absoluteSealUrl(stored)).toBe(stored);
    expect(absoluteSealUrl(null)).toBeNull();
    expect(absoluteSealUrl("")).toBeNull();
  });
});

describe("exhibit content sniffing", () => {
  it("classifies each accepted family by its magic bytes", () => {
    expect(sniffFamily(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe("pdf");
    expect(sniffFamily(new Uint8Array([0xff, 0xd8, 0xff]))).toBe("image");
    expect(sniffFamily(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe("zip");
    expect(sniffFamily(new Uint8Array(Buffer.from("#!/bin/sh\nrm -rf /")))).toBeUndefined();
  });
});

describe("the roots and the limit", () => {
  it("reads both roots from the environment, with distinct defaults", () => {
    const before = { p: process.env.PUBLIC_ASSET_ROOT, d: process.env.DOCUMENT_ROOT };
    delete process.env.PUBLIC_ASSET_ROOT;
    delete process.env.DOCUMENT_ROOT;
    try {
      // The two must never be the same directory: the whole design is that
      // one is served by nginx with no check and the other is `internal`.
      expect(publicAssetRoot()).not.toBe(documentRoot());
    } finally {
      if (before.p !== undefined) process.env.PUBLIC_ASSET_ROOT = before.p;
      if (before.d !== undefined) process.env.DOCUMENT_ROOT = before.d;
    }
  });

  it("caps uploads at 5 MB, below the 10M nginx allows", () => {
    // Not a coincidence and not a duplicate: nginx's 10M is the transport
    // ceiling, and the gap is the range this application must refuse itself
    // with a message a clerk can act on rather than nginx's bare 413.
    expect(MAX_UPLOAD_BYTES).toBe(5 * 1024 * 1024);
    expect(MAX_UPLOAD_BYTES).toBeLessThan(10 * 1024 * 1024);
  });
});
