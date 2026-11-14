// S791b: one entry point for "pull the photos from this unit's folder",
// whichever provider the link is on. Google Drive and Dropbox pull; other
// links (iCloud, Box) are kept for the landlord to open.
import type { SupabaseClient } from "@supabase/supabase-js";
import { photoSourceOf, type DrivePullResult } from "@/lib/drive-import";
import { pullDrivePhotos } from "@/lib/drive-import-server";
import { pullDropboxPhotos } from "@/lib/dropbox-import-server";

/** The pull result, or null when the link is not on a provider we pull from. */
export async function pullFolderPhotos(args: {
  admin: SupabaseClient;
  organizationId: string;
  propertyId: string;
  folderUrl: string;
  touchUp?: boolean;
}): Promise<DrivePullResult | null> {
  const source = photoSourceOf(args.folderUrl);
  if (source === "gdrive") return pullDrivePhotos(args);
  if (source === "dropbox") return pullDropboxPhotos(args);
  return null;
}
