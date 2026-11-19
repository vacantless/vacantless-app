// S726: the how-to videos in public/videos (see app/how-to/page.tsx).
export const HOW_TO_PATH = "/how-to";

export const HOW_TO_VIDEOS: { n: number; title: string; line: string; seconds: number }[] = [
  { n: 1, title: "Add a rental", line: "Copy an old ad or start fresh. Rent, photos and an AI draft.", seconds: 60 },
  { n: 2, title: "Set viewing times", line: "Weekly windows for all your rentals, days per building, and what renters see.", seconds: 38 },
  { n: 3, title: "Answer an inquiry", line: "Draft a reply with your booking link, or answer Marketplace chats from Quick replies: tap what they asked, copy, and the renter is saved.", seconds: 72 },
  { n: 4, title: "Post to rental sites", line: "Connect your sites once, and get renter emails from them on the same page. Then every rental posts itself: your Facebook Page, Marketplace in one click, and Kijiji, Rentals.ca and Zumper. Change a rental and Marketplace updates in one click. Ads come down when it rents.", seconds: 93 },
  { n: 5, title: "Showing agents", line: "Add the people who run viewings and let new bookings go to them.", seconds: 25 },
  { n: 6, title: "After the viewing", line: "Reminders, the unconfirmed-viewings box, one-tap nudges, group viewings, new times, calendar links, follow-ups, feedback and the application link.", seconds: 86 },
  { n: 7, title: "Little things that save you time", line: "Texts from your own number, a daily email, and warnings before things slip.", seconds: 39 },
  { n: 8, title: "Your agent's phone", line: "The agent's one link: call the renter, confirm, hand a viewing back, mark how it went.", seconds: 43 },
  { n: 9, title: "The paperwork", line: "The free Ontario tools: an N4 for unpaid rent, an N8 for late rent, an N12 for your own use, a rent increase with Form N1, and the Standard Lease.", seconds: 88 },
  { n: 10, title: "After you lease", line: "Start the tenancy from the renter, build the lease, fill the Ontario forms, collect rent, handle repairs and after-hours emergencies, rate your trades, inspections and rent receipts, a move-out date that relists the unit, the owner statement, and your T776 and accountant zip.", seconds: 179 },
  { n: 11, title: "Application to offer", line: "Send the application, they sign it, add a co-applicant, check Landlord and Tenant Board orders for free, ask for a credit check, then send an offer each of them signs.", seconds: 130 },
  { n: 12, title: "From your phone", line: "Screenshot a Marketplace chat, tap Share, then Send to Vacantless. The renter is saved and your reply is copied, ready to paste.", seconds: 42 },
];

// S729: the count in words, so headings never go stale when a video is added.
const COUNT_WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];
export const HOW_TO_COUNT_WORD = COUNT_WORDS[HOW_TO_VIDEOS.length] ?? String(HOW_TO_VIDEOS.length);

// S816: a version stamp per video (first 8 of the md5 of the mp4 then the jpg),
// so a re-shot video or poster can never come from a browser's old copy, and the
// help window can't show one video's poster over another. scripts/test-page-help
// fails if a file changes without its stamp: re-shoot, then update the stamp.
export const HOW_TO_FILE_VERSION: Record<number, string> = {
  1: "72bfee5d",
  2: "c75f7f46",
  3: "d1473f77",
  4: "74744e70",
  5: "5e766fae",
  6: "27db4a2d",
  7: "585f4ef1",
  8: "46b772aa",
  9: "15ce89cf",
  10: "345f174c",
  11: "302d1f1b",
  12: "4bfe6faa",
};

export function howToVideoSrc(n: number): string {
  return `/videos/howto-${n}.mp4?v=${HOW_TO_FILE_VERSION[n] ?? "0"}`;
}
export function howToPosterSrc(n: number): string {
  return `/videos/howto-${n}.jpg?v=${HOW_TO_FILE_VERSION[n] ?? "0"}`;
}
