// S726: the how-to videos in public/videos (see app/how-to/page.tsx).
export const HOW_TO_PATH = "/how-to";

export const HOW_TO_VIDEOS: { n: number; title: string; line: string; seconds: number }[] = [
  { n: 1, title: "Add a rental", line: "Copy an old ad or start fresh. Rent, photos and an AI draft.", seconds: 60 },
  { n: 2, title: "Set viewing times", line: "Weekly windows for all your rentals, days per building, and what renters see.", seconds: 38 },
  { n: 3, title: "Answer an inquiry", line: "Draft a reply with your booking link, send it, and ask renters a few questions.", seconds: 41 },
  { n: 4, title: "Post to rental sites", line: "Connect your sites once. Then every rental posts itself: your Facebook Page, Marketplace in one click, and Kijiji, Rentals.ca and Zumper. Ads come down when it rents.", seconds: 61 },
  { n: 5, title: "Showing agents", line: "Add the people who run viewings and let new bookings go to them.", seconds: 25 },
  { n: 6, title: "After the viewing", line: "Reminders, new times, follow-ups, feedback and the application link.", seconds: 63 },
  { n: 7, title: "Little things that save you time", line: "Texts from your own number, a daily email, and warnings before things slip.", seconds: 39 },
  { n: 8, title: "Your agent's phone", line: "The agent's one link: call the renter, confirm, hand a viewing back, mark how it went.", seconds: 43 },
  { n: 9, title: "The paperwork", line: "The free Ontario tools: an N4 for unpaid rent, an N8 for late rent, an N12 for your own use, a rent increase with Form N1, and the Standard Lease.", seconds: 88 },
  { n: 10, title: "After you lease", line: "Start the tenancy from the renter, build the lease, fill the Ontario forms, collect rent, log repairs and costs, see the owner statement, and get your T776 and accountant zip.", seconds: 99 },
];

// S729: the count in words, so headings never go stale when a video is added.
const COUNT_WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];
export const HOW_TO_COUNT_WORD = COUNT_WORDS[HOW_TO_VIDEOS.length] ?? String(HOW_TO_VIDEOS.length);
