// Unit tests for the pure Dropbox-folder-import logic (URL validation, image
// filtering, gallery sort order, nested grouping, error copy).
// Run: npx tsx scripts/test-dropbox-import.ts
import {
  parseDropboxFolderUrl,
  isDropboxImageName,
  filterImageEntries,
  subfolderNames,
  galleryOrderNum,
  sortGalleryEntries,
  groupByFirstSubfolder,
  normalizeSubfolderChoice,
  dropboxListPath,
  dropboxFilePath,
  dropboxImportErrorMessage,
  DROPBOX_IMAGE_EXTENSIONS,
  type DropboxEntry,
} from "../lib/dropbox-import";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

const file = (name: string, path_lower?: string): DropboxEntry => ({
  tag: "file",
  name,
  path_lower: path_lower ?? `/${name.toLowerCase()}`,
});
const folder = (name: string): DropboxEntry => ({
  tag: "folder",
  name,
  path_lower: `/${name.toLowerCase()}`,
});

// --- parseDropboxFolderUrl --------------------------------------------------
ok(
  "url: modern scl/fo folder link accepted",
  parseDropboxFolderUrl(
    "https://www.dropbox.com/scl/fo/abc123/xyz?rlkey=k&dl=0",
  ).ok === true,
);
ok(
  "url: legacy /sh/ folder link accepted",
  parseDropboxFolderUrl("https://www.dropbox.com/sh/abc/def?dl=0").ok === true,
);
ok(
  "url: bare dropbox.com host (no www) accepted",
  parseDropboxFolderUrl("https://dropbox.com/scl/fo/a/b?rlkey=k").ok === true,
);
ok(
  "url: keeps the query string (rlkey) on the canonical href",
  (() => {
    const r = parseDropboxFolderUrl(
      "https://www.dropbox.com/scl/fo/a/b?rlkey=secret&dl=0",
    );
    return r.ok === true && r.url.includes("rlkey=secret");
  })(),
);
ok(
  "url: single-file scl/fi link rejected as notfolder",
  parseDropboxFolderUrl(
    "https://www.dropbox.com/scl/fi/a/photo.jpg?rlkey=k",
  ).ok === false,
);
ok(
  "url: legacy single-file /s/ link rejected as notfolder",
  (() => {
    const r = parseDropboxFolderUrl("https://www.dropbox.com/s/a/photo.jpg");
    return r.ok === false && r.reason === "notfolder";
  })(),
);
ok(
  "url: non-dropbox host rejected as host",
  (() => {
    const r = parseDropboxFolderUrl("https://evil.com/scl/fo/a/b");
    return r.ok === false && r.reason === "host";
  })(),
);
ok(
  "url: lookalike subdomain rejected",
  parseDropboxFolderUrl("https://dropbox.com.evil.com/scl/fo/a/b").ok === false,
);
ok(
  "url: http scheme rejected",
  (() => {
    const r = parseDropboxFolderUrl("http://www.dropbox.com/scl/fo/a/b");
    return r.ok === false && r.reason === "scheme";
  })(),
);
ok(
  "url: garbage rejected as invalid",
  parseDropboxFolderUrl("not a url").ok === false,
);
ok(
  "url: empty/nullish rejected as invalid",
  parseDropboxFolderUrl("").ok === false &&
    parseDropboxFolderUrl(null).ok === false &&
    parseDropboxFolderUrl(undefined).ok === false,
);
ok(
  "url: a non-folder dropbox path (e.g. /home) rejected",
  parseDropboxFolderUrl("https://www.dropbox.com/home").ok === false,
);

// --- isDropboxImageName -----------------------------------------------------
ok("img: .jpg accepted", isDropboxImageName("001-highres_001.jpg"));
ok("img: uppercase .JPG accepted", isDropboxImageName("PHOTO.JPG"));
ok("img: .jpeg/.png/.webp/.gif accepted",
  isDropboxImageName("a.jpeg") && isDropboxImageName("a.png") &&
  isDropboxImageName("a.webp") && isDropboxImageName("a.gif"));
ok("img: .pdf rejected (clutter)", !isDropboxImageName("iGUIDE Report.pdf"));
ok("img: .heic rejected (not web-renderable)", !isDropboxImageName("IMG_0001.HEIC"));
ok("img: dotfile .DS_Store rejected", !isDropboxImageName(".DS_Store"));
ok("img: leading-dot hidden jpg rejected", !isDropboxImageName(".hidden.jpg"));
ok("img: no extension rejected", !isDropboxImageName("README"));
ok("img: trailing dot rejected", !isDropboxImageName("photo."));
ok("img: non-string rejected", !isDropboxImageName(null) && !isDropboxImageName(undefined));
ok("img: extension list is the 4 renderable types + jpeg",
  DROPBOX_IMAGE_EXTENSIONS.length === 5);

// --- filterImageEntries / subfolderNames ------------------------------------
const mixed: DropboxEntry[] = [
  file("002-highres_002.jpg"),
  folder("Outside & Common Areas"),
  file(".DS_Store"),
  file("iGUIDE Report.pdf"),
  file("001-highres_001.JPG"),
  { tag: "file", name: "floorplan.png" },
];
ok("filter: keeps only image files",
  filterImageEntries(mixed).map((e) => e.name).sort().join(",") ===
    ["001-highres_001.JPG", "002-highres_002.jpg", "floorplan.png"].sort().join(","));
ok("filter: drops folders, dotfiles, and pdfs",
  filterImageEntries(mixed).every((e) => e.tag === "file" && isDropboxImageName(e.name)));
ok("subfolders: lists folder entry names",
  JSON.stringify(subfolderNames(mixed)) === JSON.stringify(["Outside & Common Areas"]));
ok("subfolders: none when flat gallery",
  subfolderNames([file("001.jpg"), file("002.jpg")]).length === 0);

// --- galleryOrderNum / sortGalleryEntries -----------------------------------
ok("order: leading prefix parsed", galleryOrderNum("001-highres_001.jpg") === 1);
ok("order: multi-digit prefix", galleryOrderNum("014-x.jpg") === 14);
ok("order: no prefix -> null", galleryOrderNum("kitchen.jpg") === null);
ok("sort: numeric not lexical (2 before 10)",
  sortGalleryEntries([file("010-x.jpg"), file("002-x.jpg")]).map((e) => e.name)
    .join(",") === "002-x.jpg,010-x.jpg");
ok("sort: full 1..12 sequence ordered",
  (() => {
    const names = Array.from({ length: 12 }, (_, i) =>
      `${String(i + 1).padStart(3, "0")}-highres.jpg`);
    const shuffled = [...names].reverse().map((n) => file(n));
    return sortGalleryEntries(shuffled).map((e) => e.name).join(",") ===
      names.join(",");
  })());
ok("sort: prefixed entries come before un-prefixed, which sort by name",
  sortGalleryEntries([file("zoo.jpg"), file("003-x.jpg"), file("alpha.jpg")])
    .map((e) => e.name).join(",") === "003-x.jpg,alpha.jpg,zoo.jpg");
ok("sort: does not mutate input",
  (() => {
    const input = [file("010-x.jpg"), file("002-x.jpg")];
    sortGalleryEntries(input);
    return input[0].name === "010-x.jpg";
  })());

// --- groupByFirstSubfolder (multi-unit follow-on helper) ---------------------
const building: DropboxEntry[] = [
  file("01-a.jpg", "/unit 1/01-a.jpg"),
  file("02-b.jpg", "/unit 1/02-b.jpg"),
  file("01-c.jpg", "/unit 2/01-c.jpg"),
  file("01-out.jpg", "/outside & common areas/01-out.jpg"),
  file("cover.jpg", "/cover.jpg"), // a file at the root
  folder("ignored"),
];
const grouped = groupByFirstSubfolder(building, "");
ok("group: one bucket per first-level subfolder + root", grouped.size === 4);
ok("group: unit 1 has its two files",
  (grouped.get("unit 1")?.length ?? 0) === 2);
ok("group: root-level file under empty key",
  (grouped.get("")?.[0]?.name ?? "") === "cover.jpg");
ok("group: only files are grouped (folder entry ignored)",
  [...grouped.values()].flat().every((e) => e.tag === "file"));
ok("group: respects a non-empty root path_lower",
  (() => {
    const entries = [
      file("a.jpg", "/listings/123 main/gallery/unit 1/a.jpg"),
      file("b.jpg", "/listings/123 main/gallery/unit 2/b.jpg"),
    ];
    const g = groupByFirstSubfolder(entries, "/Listings/123 Main/gallery");
    return g.size === 2 && g.has("unit 1") && g.has("unit 2");
  })());

// --- normalizeSubfolderChoice (multi-unit pick) -----------------------------
const units = ["Unit 22", "Unit 27", "Outside & Common Areas"];
ok("pick: exact match returns the server-side name",
  normalizeSubfolderChoice("Unit 22", units) === "Unit 22");
ok("pick: case-insensitive match returns canonical casing",
  normalizeSubfolderChoice("unit 22", units) === "Unit 22");
ok("pick: surrounding whitespace tolerated",
  normalizeSubfolderChoice("  Unit 27 ", units) === "Unit 27");
ok("pick: a unit not in the list is rejected",
  normalizeSubfolderChoice("Unit 99", units) === null);
ok("pick: empty / nullish rejected",
  normalizeSubfolderChoice("", units) === null &&
    normalizeSubfolderChoice(null, units) === null &&
    normalizeSubfolderChoice(undefined, units) === null);
ok("pick: a path-traversal-ish choice never matches a real single segment",
  normalizeSubfolderChoice("../secret", units) === null);

// --- dropboxListPath --------------------------------------------------------
ok("listpath: no subfolder -> share root ''",
  dropboxListPath() === "" && dropboxListPath(null) === "" &&
    dropboxListPath("") === "");
ok("listpath: a unit -> /Unit 22", dropboxListPath("Unit 22") === "/Unit 22");
ok("listpath: tolerates a leading/trailing slash",
  dropboxListPath("/Unit 22/") === "/Unit 22");

// --- dropboxFilePath --------------------------------------------------------
ok("filepath: root file -> /name",
  dropboxFilePath(null, "001-highres.jpg") === "/001-highres.jpg");
ok("filepath: subfolder file -> /Unit 22/name",
  dropboxFilePath("Unit 22", "001-highres.jpg") === "/Unit 22/001-highres.jpg");
ok("filepath: joins cleanly without doubled slashes",
  dropboxFilePath("/Unit 22/", "/001.jpg") === "/Unit 22/001.jpg");
ok("filepath: empty subfolder behaves like root",
  dropboxFilePath("", "002.jpg") === "/002.jpg");

// --- dropboxImportErrorMessage ----------------------------------------------
ok("msg: dropboxurl mentions Dropbox + Share", /dropbox/i.test(dropboxImportErrorMessage("dropboxurl")) && /share/i.test(dropboxImportErrorMessage("dropboxurl")));
ok("msg: dropboxnested explains sub-folders", /sub-folder|unit/i.test(dropboxImportErrorMessage("dropboxnested")));
ok("msg: dropboxbadunit mentions the unit folder", /unit folder/i.test(dropboxImportErrorMessage("dropboxbadunit")));
ok("msg: dropboxempty mentions no photos found", /no photos/i.test(dropboxImportErrorMessage("dropboxempty")));
ok("msg: dropboxauth mentions not set up", /set up/i.test(dropboxImportErrorMessage("dropboxauth")));
ok("msg: dropboxmax mentions limit", /limit/i.test(dropboxImportErrorMessage("dropboxmax")));
ok("msg: dropboxfailed mentions anyone with the link", /anyone with the link/i.test(dropboxImportErrorMessage("dropboxfailed")));
ok("msg: unknown -> generic try again", /try again/i.test(dropboxImportErrorMessage("???")));

// --- summary ----------------------------------------------------------------
console.log(`\ndropbox-import: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
