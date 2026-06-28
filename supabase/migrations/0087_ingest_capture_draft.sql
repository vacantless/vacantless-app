-- ============================================================================
-- 0087_ingest_capture_draft — Capture Phase 3, Slice 2 (the review queue).
--
-- An email/text-in capture is parsed at INGEST time (app/api/inbound/asset calls
-- parseAssetImage once), but it is confirmed LATER, when the landlord opens the
-- "Captures awaiting review" queue. To prefill the confirm form without a second
-- vision call, the parsed AssetDraft is stored on the capture row as JSON.
--
-- ONE nullable jsonb column on documents. NULL for every non-ingress document
-- (and for an ingress capture whose image didn't parse / was a PDF), so this is
-- inert and invisible to all existing rows/queries.
-- ============================================================================

alter table public.documents
  add column if not exists ingest_draft jsonb;

comment on column public.documents.ingest_draft is
  'The parsed AssetDraft (lib/asset-capture) for an email/text-in capture, stored at ingest so the review queue can prefill the confirm form without re-parsing. NULL for non-ingress documents and for captures that did not parse (e.g. a PDF receipt).';
