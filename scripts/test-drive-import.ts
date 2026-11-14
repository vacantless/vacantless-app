// Run with: npx tsx scripts/test-drive-import.ts
// S789b: Google Drive photo folder rules (lib/drive-import).
import {
  parseDriveFolderUrl,
  photoSourceOf,
  cleanPhotoFolderUrl,
  parseEmbeddedFolderView,
  driveImages,
  photosToPull,
  driveSourceRef,
  driveThumbnailUrl,
  embeddedFolderViewUrl,
  isDriveImageHost,
  drivePullLine,
  photoUrlsToTry,
  sizedViewThumb,
  pullsFrom,
} from "../lib/drive-import";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}`);
  }
}

const A = "16qAI2vaq8JCJgdNvXPB8NztnXYe5ELsT";
const r1 = parseDriveFolderUrl(`https://drive.google.com/drive/folders/${A}?usp=sharing`);
ok("folders link", r1.ok && r1.folderId === A && r1.resourceKey === null);
const r2 = parseDriveFolderUrl(`https://drive.google.com/drive/u/1/folders/${A}?resourcekey=0-xN3kMNyxJ0j4Le0Vy1anAA`);
ok("account folders link keeps resourcekey", r2.ok && r2.folderId === A && r2.resourceKey === "0-xN3kMNyxJ0j4Le0Vy1anAA");
const r3 = parseDriveFolderUrl(`https://drive.google.com/open?id=${A}`);
ok("old open link", r3.ok && r3.folderId === A);
const r4 = parseDriveFolderUrl(`https://drive.google.com/file/d/${A}/view`);
ok("a file link is not a folder", !r4.ok && r4.reason === "notfolder");
const r5 = parseDriveFolderUrl(`https://www.dropbox.com/scl/fo/abc/def`);
ok("dropbox is not drive", !r5.ok && r5.reason === "host");
ok("http and junk refused", !parseDriveFolderUrl(`http://drive.google.com/drive/folders/${A}`).ok && !parseDriveFolderUrl("hello").ok && !parseDriveFolderUrl("").ok);
ok("bad id refused", !parseDriveFolderUrl("https://drive.google.com/drive/folders/<script>").ok);

ok("source of links", photoSourceOf(`https://drive.google.com/drive/folders/${A}`) === "gdrive" && photoSourceOf("https://www.dropbox.com/scl/fo/x") === "dropbox" && photoSourceOf("https://www.icloud.com/sharedalbum/x") === "other" && photoSourceOf("") === null);
ok("clean folder url", cleanPhotoFolderUrl(" https://drive.google.com/drive/folders/x ") === "https://drive.google.com/drive/folders/x" && cleanPhotoFolderUrl("http://x.com") === null && cleanPhotoFolderUrl("https://x.com/" + "a".repeat(1001)) === null);

// Real markup from drive.google.com/embeddedfolderview (2026-11-13), trimmed.
const html = `<html><div class="flip-entries">
<div class="flip-entry" id="entry-${A}" tabindex="0" role="link"><div class="flip-entry-info"><a href="https://drive.google.com/drive/folders/${A}" target="_blank"><div class="flip-entry-title">833 Pillette Rd</div></a></div></div>
<div class="flip-entry" id="entry-1_MkY-Jofoz4vtuKzDEzCUnr55lrjEZpf" tabindex="0" role="link"><div class="flip-entry-info"><a href="https://drive.google.com/file/d/1_MkY-Jofoz4vtuKzDEzCUnr55lrjEZpf/view?usp=drive_web" target="_blank"><div class="flip-entry-visual"><div class="flip-entry-thumb"><img src="https://lh3.googleusercontent.com/x=s190" alt="JPEG Image"></div></div><div class="flip-entry-title">20230121_134806.jpg</div></a></div></div>
<div class="flip-entry" id="entry-1bbbbbbbbbbbbbbbbbbbbb" tabindex="0" role="link"><div class="flip-entry-info"><a href="https://drive.google.com/file/d/1bbbbbbbbbbbbbbbbbbbbb/view" target="_blank"><div class="flip-entry-title">002-kitchen.JPG</div></a></div></div>
<div class="flip-entry" id="entry-1ccccccccccccccccccccc" tabindex="0" role="link"><div class="flip-entry-info"><a href="https://drive.google.com/file/d/1ccccccccccccccccccccc/view" target="_blank"><div class="flip-entry-title">001-living &amp; dining.jpg</div></a></div></div>
<div class="flip-entry" id="entry-1ddddddddddddddddddddd" tabindex="0" role="link"><div class="flip-entry-info"><a href="https://drive.google.com/file/d/1ddddddddddddddddddddd/view" target="_blank"><div class="flip-entry-title">floor plan.pdf</div></a></div></div>
</div></html>`;
const entries = parseEmbeddedFolderView(html);
ok("five entries read", entries.length === 5);
ok("folder told from file", entries[0].kind === "folder" && entries[0].name === "833 Pillette Rd" && entries[1].kind === "file");
ok("entities decoded", entries.some((e) => e.name === "001-living & dining.jpg"));
const imgs = driveImages(entries);
ok("images only, gallery order", imgs.map((e) => e.name).join("|") === "001-living & dining.jpg|002-kitchen.JPG|20230121_134806.jpg");
ok("empty page reads nothing", parseEmbeddedFolderView("<html>sign in</html>").length === 0);

const pulled = new Set([driveSourceRef("1ccccccccccccccccccccc")]);
const todo = photosToPull(imgs, pulled, 24);
ok("already-pulled photos skipped", todo.length === 2 && todo[0].name === "002-kitchen.JPG");
ok("room caps the pull", photosToPull(imgs, new Set(), 1).length === 1 && photosToPull(imgs, new Set(), 0).length === 0);

ok("thumbnail url", driveThumbnailUrl("abc", null) === "https://drive.google.com/thumbnail?id=abc&sz=w2400" && driveThumbnailUrl("abc", "0-k").endsWith("&resourcekey=0-k"));
ok("folder view url", embeddedFolderViewUrl({ folderId: A, resourceKey: null }) === `https://drive.google.com/embeddedfolderview?id=${A}`);
ok("only Google image hosts", isDriveImageHost("drive.google.com") && isDriveImageHost("lh3.googleusercontent.com") && isDriveImageHost("drive.usercontent.google.com") && !isDriveImageHost("evil.com") && !isDriveImageHost("googleusercontent.com.evil.com"));

ok("pull lines", drivePullLine({ ok: true, added: 12, skipped: 0, alreadyIn: 0 }) === "12 photos pulled in from the folder." && drivePullLine({ ok: true, added: 1, skipped: 2, alreadyIn: 0 }) === "1 photo pulled in from the folder. 2 could not be read.");
ok("not shared tells how", drivePullLine({ ok: false, reason: "notshared" }).includes("Anyone with the link"));
ok("nested names the folders", drivePullLine({ ok: false, reason: "nested", subfolders: ["Unit 20", "Unit 22"] }).includes("Unit 20, Unit 22"));
const lines = [
  drivePullLine({ ok: true, added: 0, skipped: 0, alreadyIn: 3 }),
  ...(["badlink", "notshared", "empty", "nested", "full", "failed"] as const).map((r) => drivePullLine({ ok: false, reason: r })),
];
ok("no em dashes", lines.every((l) => !l.includes("—")));

const withThumb = entries.find((e) => e.name === "20230121_134806.jpg");
ok("folder view image link read", withThumb?.thumb === "https://lh3.googleusercontent.com/x=s190");
ok("view image asked for at 2400", sizedViewThumb("https://lh3.googleusercontent.com/drive-storage/AbC=s190") === "https://lh3.googleusercontent.com/drive-storage/AbC=s2400" && sizedViewThumb("https://evil.com/x=s190") === null && sizedViewThumb(undefined) === null);
const tries = photoUrlsToTry({ id: "abc", name: "a.jpg", kind: "file", thumb: "https://lh3.googleusercontent.com/drive-storage/AbC=s190" }, null);
ok("three routes in order", tries.length === 3 && tries[0].includes("/thumbnail?id=abc") && tries[1].endsWith("=s2400") && tries[2].startsWith("https://drive.usercontent.google.com/download?id=abc"));
ok("two routes without a view link", photoUrlsToTry({ id: "abc", name: "a.jpg", kind: "file" }, null).length === 2);
// S791b: Dropbox folders pull too.
ok("pulls from Drive and Dropbox only", pullsFrom("gdrive") && pullsFrom("dropbox") && !pullsFrom("other") && !pullsFrom(null));
ok("Dropbox link is a pull source", pullsFrom(photoSourceOf("https://www.dropbox.com/scl/fo/abc/xyz?rlkey=1")));
ok("bad link names both providers", drivePullLine({ ok: false, reason: "badlink" }).includes("Google Drive or Dropbox"));
console.log(`drive-import: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
