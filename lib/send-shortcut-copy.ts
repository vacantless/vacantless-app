// S816l: the words for building the "Send to Vacantless" Apple Shortcut by
// hand, used until we have a shared Shortcut link (NEXT_PUBLIC_SEND_SHORTCUT_URL).
export const SEND_URL_PATH = "/api/shortcut/renter";

export const SEND_SHORTCUT_STEPS: string[] = [
  'Open the Shortcuts app on your iPhone. Tap + and name it "Send to Vacantless".',
  'Tap the i button at the bottom. Turn on "Show in Share Sheet". Set it to take Images only.',
  'Add the action "Convert Image". Set it to JPEG.',
  'Add the action "Get Contents of URL". Paste this web address: {URL}',
  'Tap the arrow on that action. Set Method to Post and Request Body to Form.',
  'Add a Text field named key and paste your key. Add a File field named screenshot and pick Converted Image.',
  'Add the action "Show Result". Tap Done.',
];
