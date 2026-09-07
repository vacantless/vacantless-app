"use client";

import { useEffect, useRef, useState } from "react";
import { Button, ButtonLink, Card, StatusBanner } from "@/components/ui";
import { readLinkPortalTiles, setKijijiTier } from "./actions";
import type { LinkPortalTileVM, LinkPortalsVM } from "./view-model";

// Stage 1 connect tiles (Post Everywhere Slice 1, SPEC-S688 3.4).
//
// Renders the server view model as given. With the wizard flag on and at
// least one tile reading "checking", it POSTs /api/distribution/session-check
// once on mount for those channels, then re-reads the tiles every 5 s for up
// to 90 s until every polled tile's lastCheckedAt moves. With the flag off it
// never fetches or writes: the page is a plain render of the rows.

const POLL_EVERY_MS = 5_000;
const POLL_FOR_MS = 90_000;

export function ConnectTiles({ initial }: { initial: LinkPortalsVM }) {
  const [vm, setVm] = useState<LinkPortalsVM>(initial);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!initial.probeEnabled || startedRef.current) return;
    const stale = initial.groups
      .flatMap((g) => g.rows)
      .filter((row) => row.needsCheck || row.state === "checking");
    if (stale.length === 0) return;
    startedRef.current = true;

    const watched = new Map(stale.map((row) => [row.channel, row.lastCheckedAt]));
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();

    const poll = async () => {
      if (cancelled) return;
      try {
        const next = await readLinkPortalTiles();
        if (cancelled) return;
        if (next) {
          setVm(next);
          for (const row of next.groups.flatMap((g) => g.rows)) {
            const before = watched.get(row.channel);
            if (before === undefined) continue;
            if (row.lastCheckedAt && row.lastCheckedAt !== before) {
              watched.delete(row.channel);
            }
          }
        }
      } catch {
        // A failed poll is not a verdict; try again on the next tick.
      }
      if (watched.size > 0 && Date.now() - startedAt < POLL_FOR_MS) {
        timer = setTimeout(poll, POLL_EVERY_MS);
      }
    };

    const request = async () => {
      const channels = stale.filter((row) => row.needsCheck).map((row) => row.channel);
      if (channels.length > 0) {
        try {
          await fetch("/api/distribution/session-check", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ channels }),
          });
        } catch {
          // The worker's due filter is the real guard; polling still shows
          // whatever the last probe wrote.
        }
      }
      timer = setTimeout(poll, POLL_EVERY_MS);
    };

    void request();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      // Strict mode runs the effect twice in dev; let the second run start
      // the poll loop the first run's cleanup just cancelled.
      startedRef.current = false;
    };
    // Mount-only by design: the initial verdict decides whether to probe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = async () => {
    const next = await readLinkPortalTiles();
    if (next) setVm(next);
  };

  return (
    <>
      {vm.groups.map((group) => (
        <section key={group.id} className="space-y-3">
          <h2 className="text-[length:var(--vl-type-h2)] font-semibold leading-tight text-[var(--vl-text-primary)]">
            {group.title}
          </h2>
          <div className="space-y-4">
            {group.rows.map((row) => (
              <ConnectTile key={row.channel} row={row} onChanged={refresh} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

function ConnectTile({
  row,
  onChanged,
}: {
  row: LinkPortalTileVM;
  onChanged: () => Promise<void>;
}) {
  return (
    <Card className="space-y-4" padded>
      <div className="space-y-3">
        <h3 className="text-xl font-bold leading-tight text-[var(--vl-text-primary)]">
          {row.label}
        </h3>
        <StatusBanner tone={row.tone} title={row.title}>
          {row.state === "checking" ? (
            <span className="inline-flex items-center gap-2">
              <span
                aria-hidden
                className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
              />
              {row.sub}
            </span>
          ) : (
            row.sub
          )}
        </StatusBanner>
      </div>

      {(row.accountLine || row.checkedLine) && (
        <p className="text-[length:var(--vl-type-guided-body)] leading-relaxed text-[var(--vl-text-primary)]">
          {row.accountLine && <span className="font-semibold">{row.accountLine}</span>}
          {row.accountLine && row.checkedLine && <span aria-hidden> · </span>}
          {row.checkedLine && (
            <span className="text-[var(--vl-text-muted)]">{row.checkedLine}</span>
          )}
        </p>
      )}

      {(row.capLine || row.costLine) && (
        <p className="text-[length:var(--vl-type-guided-body)] leading-relaxed text-[var(--vl-text-secondary)]">
          {row.capLine && <span>{row.capLine}</span>}
          {row.capLine && row.costLine && " "}
          {row.costLine && <span>{row.costLine}</span>}
        </p>
      )}

      {row.kijijiTier && <KijijiTierPicker copy={row.kijijiTier} onSaved={onChanged} />}

      <p className="text-[length:var(--vl-type-guided-body)] leading-relaxed text-[var(--vl-text-secondary)]">
        {row.kindLine}
      </p>

      <div className="space-y-3">
        {row.button && (
          <ButtonLink
            href={row.button.href}
            size="lg"
            variant={row.button.kind === "authorize" ? "secondary" : "primary"}
          >
            {row.button.label}
          </ButtonLink>
        )}
        {row.igNote && (
          <p className="text-base leading-relaxed text-[var(--vl-text-muted)]">
            {row.igNote}
          </p>
        )}
      </div>
    </Card>
  );
}

function KijijiTierPicker({
  copy,
  onSaved,
}: {
  copy: NonNullable<LinkPortalTileVM["kijijiTier"]>;
  onSaved: () => Promise<void>;
}) {
  const [tier, setTier] = useState<"personal" | "business" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <fieldset className="space-y-2 rounded-[var(--vl-radius-md)] border border-[var(--vl-border)] p-3">
      <legend className="px-1 text-sm font-semibold text-[var(--vl-text-primary)]">
        {copy.prompt}
      </legend>
      <label className="flex items-center gap-2 text-sm text-[var(--vl-text-primary)]">
        <input
          type="radio"
          name="kijiji_tier"
          value="personal"
          checked={tier === "personal"}
          onChange={() => setTier("personal")}
        />
        {copy.personal}
      </label>
      <label className="flex items-center gap-2 text-sm text-[var(--vl-text-primary)]">
        <input
          type="radio"
          name="kijiji_tier"
          value="business"
          checked={tier === "business"}
          onChange={() => setTier("business")}
        />
        {copy.business}
      </label>
      <Button
        size="md"
        variant="secondary"
        disabled={!tier || pending}
        onClick={() => {
          if (!tier || pending) return;
          setError(null);
          setPending(true);
          void (async () => {
            try {
              const result = await setKijijiTier(tier);
              if (result.ok) {
                await onSaved();
              } else {
                setError(result.error);
              }
            } catch {
              setError("save_failed");
            } finally {
              setPending(false);
            }
          })();
        }}
      >
        {copy.save}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-[var(--vl-status-attention-text)]">
          {error}
        </p>
      )}
    </fieldset>
  );
}
