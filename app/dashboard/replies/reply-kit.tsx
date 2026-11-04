"use client";

import { useState } from "react";
import { replyKitText, type ReplyKitCard } from "@/lib/reply-kit";

// S750: the phone reply kit. One name box for all cards, a site button per
// live ad, then Copy (clipboard) or Share (the phone's share sheet, which
// lists Messenger, Messages and WhatsApp). Nothing is sent from here.

export function ReplyKit({ cards, phone }: { cards: ReplyKitCard[]; phone: string | null }) {
  const [name, setName] = useState("");
  if (cards.length === 0) {
    return (
      <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-600">
        No rentals are available right now.
      </div>
    );
  }
  return (
    <div className="mt-4 space-y-4">
      <label className="block">
        <span className="text-xs font-medium text-gray-600">Renter&apos;s first name, if you know it</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoCapitalize="words"
          autoComplete="off"
          placeholder="e.g. Khushpreet"
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-3 text-base focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
        />
      </label>
      {cards.map((card) => (
        <ReplyCard key={card.propertyId} card={card} phone={phone} name={name} />
      ))}
    </div>
  );
}

function ReplyCard({ card, phone, name }: { card: ReplyKitCard; phone: string | null; name: string }) {
  const [siteKey, setSiteKey] = useState(card.sites[0]?.key ?? "direct");
  const [done, setDone] = useState<string | null>(null);
  const site = card.sites.find((s) => s.key === siteKey) ?? card.sites[0];
  const text = replyKitText({ card, site, phone, renterName: name });

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setDone("Copied. Paste it in the chat.");
    } catch {
      setDone("Press and hold the reply below to copy it.");
    }
    setTimeout(() => setDone(null), 2500);
  }
  async function share() {
    const nav = navigator as Navigator & { share?: (d: { text: string }) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ text });
      } catch {
        // The renter closed the share sheet; nothing to do.
      }
    } else {
      await copy();
    }
  }

  return (
    <section className={`rounded-2xl border bg-white p-4 shadow-sm ${card.available ? "border-gray-200" : "border-amber-200"}`}>
      <div className="flex gap-3">
        {card.photos[0] ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={card.photos[0]} alt="" className="h-24 w-24 shrink-0 rounded-xl object-cover" />
        ) : (
          <div className="h-24 w-24 shrink-0 rounded-xl bg-gray-100" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-2xl font-bold text-gray-900">{card.rentLabel ?? "No rent set"}</div>
            {!card.available && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">Rented</span>
            )}
          </div>
          <div className="text-sm font-medium text-gray-800">{card.rental}</div>
          {card.facebookTitle && <div className="text-xs text-gray-500">On Facebook: {card.facebookTitle}</div>}
          {card.priceShared && (
            <div className="mt-1 text-xs font-medium text-amber-700">Another rental has this price. Match the photo.</div>
          )}
        </div>
      </div>
      {card.photos.length > 1 && (
        <div className="mt-2 flex gap-2">
          {card.photos.slice(1).map((u) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={u} src={u} alt="" className="h-14 w-14 rounded-lg object-cover" />
          ))}
        </div>
      )}
      {card.available && (
        <div className="mt-1 text-xs text-gray-600">
          {card.hasViewingTimes
            ? card.nextTimes
              ? `Next open: ${card.nextTimes}`
              : "Viewing times are open."
            : "No viewing times open: the reply asks renters to send their details."}
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {card.sites.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setSiteKey(s.key)}
            className={`rounded-full border px-3 py-1.5 text-sm ${
              s.key === site.key ? "border-brand bg-brand text-white" : "border-gray-300 bg-white text-gray-700"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <p className="mt-3 select-all whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-sm text-gray-800">{text}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" onClick={copy} className="rounded-xl bg-brand px-4 py-3 text-base font-semibold text-white">
          Copy reply
        </button>
        <button type="button" onClick={share} className="rounded-xl border border-gray-300 bg-white px-4 py-3 text-base font-semibold text-gray-800">
          Share
        </button>
      </div>
      {done && <p className="mt-2 text-sm text-green-700">{done}</p>}
    </section>
  );
}
