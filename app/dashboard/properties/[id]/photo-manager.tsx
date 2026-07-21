"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Icons } from "@/components/icons";
import {
  EmptyState,
  IconTile,
  PRIMARY_ACTION_CLASS,
} from "@/components/ui";
import {
  ALLOWED_PHOTO_TYPES,
  formatBytes,
  uploadErrorMessage,
  validatePhotoUpload,
} from "@/lib/photos";
import type { StorageUpsell } from "@/lib/billing";
import {
  confirmPropertyPhotos,
  createPhotoUploadTargets,
  deletePhoto,
  importPropertyPhotosFromUrls,
  movePhoto,
  setCoverPhoto,
  type PhotoUploadActionReason,
  type PhotoUploadTarget,
  type PropertyPhotoView,
} from "../actions";
import { DropboxFolderImport } from "./dropbox-folder-import";

type PickedPhoto = {
  localId: string;
  file: File;
  status: "queued" | "signing" | "uploading" | "uploaded" | "error";
  progress: number;
  error?: string;
};

function uploadActionMessage(
  reason: PhotoUploadActionReason,
  photoCap: number,
): string {
  if (reason === "type" || reason === "size" || reason === "empty") {
    return uploadErrorMessage(reason);
  }
  switch (reason) {
    case "none":
      return "Please choose at least one photo to upload.";
    case "max":
      return `You can add up to ${photoCap} photos per rental.`;
    case "forbidden":
      return "You do not have access to add photos to this rental.";
    case "sign":
      return "Could not prepare the upload links. Please try again.";
    case "path":
      return "The upload confirmation did not match this rental. Please try again.";
    case "failed":
      return "The upload finished, but the photos could not be saved. Please try again.";
  }
}

function uploadToSignedUrl({
  file,
  target,
  accessToken,
  onProgress,
}: {
  file: File;
  target: PhotoUploadTarget;
  accessToken: string | null;
  onProgress: (progress: number) => void;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", target.signedUrl);

    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
    if (anonKey) xhr.setRequestHeader("apikey", anonKey);
    if (accessToken || anonKey) {
      xhr.setRequestHeader("Authorization", `Bearer ${accessToken ?? anonKey}`);
    }
    xhr.setRequestHeader("x-upsert", "false");

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.max(1, Math.round((event.loaded / event.total) * 100)));
      } else {
        onProgress(50);
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve();
      } else {
        reject(new Error(`Storage upload failed with HTTP ${xhr.status}.`));
      }
    };
    xhr.onerror = () => reject(new Error("Storage upload failed."));
    xhr.onabort = () => reject(new Error("Storage upload was cancelled."));

    const body = new FormData();
    body.append("cacheControl", "3600");
    body.append("", file);
    xhr.send(body);
  });
}

export function PhotoManager({
  propertyId,
  initialPhotos,
  photoCap,
  storageUpsell,
}: {
  propertyId: string;
  initialPhotos: PropertyPhotoView[];
  photoCap: number;
  storageUpsell: StorageUpsell;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [photos, setPhotos] = useState<PropertyPhotoView[]>(initialPhotos);
  const [picked, setPicked] = useState<PickedPhoto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    setPhotos(initialPhotos);
  }, [initialPhotos]);

  const atPhotoLimit = photos.length >= photoCap;
  const remaining = Math.max(0, photoCap - photos.length);
  const currentUpsell = {
    ...storageUpsell,
    used: photos.length,
    remaining,
    atCap: atPhotoLimit,
  };

  function updatePicked(localId: string, patch: Partial<PickedPhoto>) {
    setPicked((items) =>
      items.map((item) =>
        item.localId === localId ? { ...item, ...patch } : item,
      ),
    );
  }

  function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    setSuccess(null);
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    for (const file of files) {
      const v = validatePhotoUpload({ type: file.type, size: file.size });
      if (!v.ok) {
        setError(uploadErrorMessage(v.reason));
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }
    }

    if (photos.length + picked.length + files.length > photoCap) {
      setError(`You can add up to ${photoCap} photos per rental.`);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setPicked((items) => [
      ...items,
      ...files.map((file, index) => ({
        localId: `${Date.now()}-${index}-${file.name}-${file.size}`,
        file,
        status: "queued" as const,
        progress: 0,
      })),
    ]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removePicked(localId: string) {
    if (uploading) return;
    setPicked((items) => items.filter((item) => item.localId !== localId));
  }

  async function uploadPicked() {
    if (uploading) return;
    if (picked.length === 0) {
      setError("Please choose at least one photo to upload.");
      return;
    }

    setUploading(true);
    setError(null);
    setSuccess(null);
    setPicked((items) =>
      items.map((item) => ({ ...item, status: "signing", progress: 0 })),
    );

    const targetResult = await createPhotoUploadTargets(
      propertyId,
      picked.map((item) => ({
        name: item.file.name,
        type: item.file.type,
        sizeBytes: item.file.size,
      })),
    );
    if (!targetResult.ok) {
      setUploading(false);
      setPicked((items) =>
        items.map((item) => ({
          ...item,
          status: "error",
          error: uploadActionMessage(targetResult.reason, photoCap),
        })),
      );
      setError(uploadActionMessage(targetResult.reason, photoCap));
      return;
    }

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    const uploaded: { storagePath: string; order: number }[] = [];
    await Promise.all(
      targetResult.targets.map(async (target, index) => {
        const item = picked[index];
        if (!item) return;
        updatePicked(item.localId, { status: "uploading", progress: 1 });
        try {
          await uploadToSignedUrl({
            file: item.file,
            target,
            accessToken: session?.access_token ?? null,
            onProgress: (progress) => updatePicked(item.localId, { progress }),
          });
          uploaded.push({ storagePath: target.storagePath, order: target.order });
          updatePicked(item.localId, { status: "uploaded", progress: 100 });
        } catch (err) {
          updatePicked(item.localId, {
            status: "error",
            error:
              err instanceof Error
                ? err.message
                : "Storage upload failed.",
          });
        }
      }),
    );

    if (uploaded.length === 0) {
      setUploading(false);
      setError("No photos uploaded. Please try again.");
      return;
    }

    const confirmed = await confirmPropertyPhotos(propertyId, uploaded);
    setUploading(false);
    if (!confirmed.ok) {
      setError(uploadActionMessage(confirmed.reason, photoCap));
      return;
    }

    setPhotos(confirmed.photos);
    setPicked([]);
    setSuccess(
      confirmed.added === 0
        ? "Photos already saved."
        : confirmed.added === 1
        ? "1 photo added."
        : `${confirmed.added} photos added.`,
    );
    router.refresh();
  }

  return (
    <div
      id="property-photos"
      className="mb-6 scroll-mt-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
    >
      <div className="mb-3 flex items-center gap-2.5">
        <IconTile size="sm">
          <Icons.page className="h-4 w-4" />
        </IconTile>
        <h3 className="text-sm font-semibold text-gray-900">
          Photos for this rental
        </h3>
      </div>
      <p className="mb-4 text-xs text-gray-500">
        Add photos renters will see on your listing page. The{" "}
        <strong>cover photo</strong> shows first. Drag isn&apos;t needed, just
        use the arrows to reorder. JPG, PNG, WebP, or GIF, up to 10&nbsp;MB each
        ({photos.length}/{photoCap}).
      </p>

      {success ? (
        <p className="mb-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">
          {success}
        </p>
      ) : null}
      {error ? (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      ) : null}

      {photos.length === 0 ? (
        <div className="mb-4">
          <EmptyState
            icon={<Icons.page />}
            title="No photos yet"
            description="A listing with photos gets far more inquiries, so add a few below."
          />
        </div>
      ) : (
        <ul className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.map((photo, i) => (
            <li
              key={photo.id}
              className="overflow-hidden rounded-xl border border-gray-200"
            >
              <div className="relative aspect-[4/3] bg-gray-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.url}
                  alt=""
                  className="h-full w-full object-cover"
                />
                {photo.is_cover && (
                  <span className="absolute left-1.5 top-1.5 rounded-full bg-brand px-2 py-0.5 text-[10px] font-semibold text-white">
                    Cover
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between gap-1 px-2 py-1.5">
                <div className="flex items-center gap-1">
                  <form action={movePhoto}>
                    <input type="hidden" name="property_id" value={propertyId} />
                    <input type="hidden" name="photo_id" value={photo.id} />
                    <input type="hidden" name="direction" value="up" />
                    <button
                      type="submit"
                      disabled={i === 0}
                      aria-label="Move earlier"
                      className="rounded px-1.5 py-0.5 text-sm text-gray-500 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      ←
                    </button>
                  </form>
                  <form action={movePhoto}>
                    <input type="hidden" name="property_id" value={propertyId} />
                    <input type="hidden" name="photo_id" value={photo.id} />
                    <input type="hidden" name="direction" value="down" />
                    <button
                      type="submit"
                      disabled={i === photos.length - 1}
                      aria-label="Move later"
                      className="rounded px-1.5 py-0.5 text-sm text-gray-500 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      →
                    </button>
                  </form>
                </div>
                <div className="flex items-center gap-1">
                  {!photo.is_cover && (
                    <form action={setCoverPhoto}>
                      <input type="hidden" name="property_id" value={propertyId} />
                      <input type="hidden" name="photo_id" value={photo.id} />
                      <button
                        type="submit"
                        className="rounded px-1.5 py-0.5 text-[11px] font-medium text-brand hover:bg-gray-100"
                      >
                        Set cover
                      </button>
                    </form>
                  )}
                  <form action={deletePhoto}>
                    <input type="hidden" name="property_id" value={propertyId} />
                    <input type="hidden" name="photo_id" value={photo.id} />
                    <button
                      type="submit"
                      aria-label="Delete photo"
                      className="rounded px-1.5 py-0.5 text-[11px] font-medium text-red-600 hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </form>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {currentUpsell.showUpsell && (
        <p className="mb-3 rounded-lg border border-brand/30 bg-brand/5 px-3 py-2 text-xs text-gray-600">
          {currentUpsell.atCap
            ? `You're at your plan's ${currentUpsell.cap}-photo limit for this rental.`
            : `${currentUpsell.remaining} of ${currentUpsell.cap} photo slots left on this rental.`}{" "}
          <Link href="/dashboard/billing" className="font-medium text-brand underline">
            Higher plans add more photos per rental →
          </Link>
        </p>
      )}

      {atPhotoLimit ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          You&apos;ve reached the {photoCap}-photo limit. Delete one to add
          another.
        </p>
      ) : (
        <div className="border-t border-gray-100 pt-3">
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileInputRef}
              id="photo-upload"
              type="file"
              aria-label="Add photos to this rental"
              accept={ALLOWED_PHOTO_TYPES.join(",")}
              multiple
              disabled={uploading}
              onChange={onPickFiles}
              className="block text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-gray-700 hover:file:bg-gray-200 disabled:opacity-60"
            />
            <button
              type="button"
              disabled={picked.length === 0 || uploading}
              onClick={uploadPicked}
              className={PRIMARY_ACTION_CLASS}
              style={{ backgroundColor: "var(--brand-color)" }}
            >
              {uploading ? "Uploading…" : "Upload photos"}
            </button>
          </div>

          {picked.length > 0 && (
            <ul className="mt-3 space-y-2">
              {picked.map((item) => (
                <li
                  key={item.localId}
                  className="rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-600"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate">
                      {item.file.name}{" "}
                      <span className="text-gray-400">
                        {formatBytes(item.file.size)}
                      </span>
                    </span>
                    {item.status === "queued" && !uploading ? (
                      <button
                        type="button"
                        onClick={() => removePicked(item.localId)}
                        className="shrink-0 font-medium text-gray-500 hover:text-red-600"
                      >
                        Remove
                      </button>
                    ) : (
                      <span className="shrink-0 capitalize text-gray-500">
                        {item.status}
                      </span>
                    )}
                  </div>
                  {item.status !== "queued" && (
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100">
                      <div
                        className="h-full rounded-full bg-brand"
                        style={{ width: `${item.progress}%` }}
                      />
                    </div>
                  )}
                  {item.error ? (
                    <p className="mt-1 text-red-600">{item.error}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          <details className="mt-3">
            <summary className="cursor-pointer text-xs font-medium text-brand">
              Or import from image links
            </summary>
            <form action={importPropertyPhotosFromUrls} className="mt-2">
              <input type="hidden" name="property_id" value={propertyId} />
              <p className="mb-2 text-xs text-gray-500">
                Paste one <strong>direct image link</strong> per line (each
                should open the image itself — ending in .jpg, .png, .webp, or
                .gif). Gallery pages and login-protected links won&apos;t work.
              </p>
              <textarea
                name="photo_urls"
                rows={4}
                required
                placeholder={
                  "https://example.com/photos/living-room.jpg\nhttps://example.com/photos/kitchen.jpg"
                }
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 placeholder:text-gray-400 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              />
              <button
                type="submit"
                className="mt-2 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Import from links
              </button>
            </form>
          </details>

          <details className="mt-3">
            <summary className="cursor-pointer text-xs font-medium text-brand">
              Or import from a Dropbox folder
            </summary>
            <DropboxFolderImport propertyId={propertyId} />
          </details>
        </div>
      )}
    </div>
  );
}
