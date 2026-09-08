/**
 * Help examples shown by the Browser CLI root command.
 */
/** Core Browser CLI examples for lifecycle and inspection commands. */
export const browserCoreExamples = [
  "carapace browser status",
  "carapace browser start",
  "carapace browser start --headless",
  "carapace browser stop",
  "carapace browser tabs",
  "carapace browser open https://example.com",
  "carapace browser focus abcd1234",
  "carapace browser close abcd1234",
  "carapace browser screenshot",
  "carapace browser screenshot --full-page",
  "carapace browser screenshot --ref 12",
  "carapace browser snapshot",
  "carapace browser snapshot --format aria --limit 200",
  "carapace browser snapshot --efficient",
  "carapace browser snapshot --labels",
];

/** Browser CLI examples for interaction/action commands. */
export const browserActionExamples = [
  "carapace browser navigate https://example.com",
  "carapace browser resize 1280 720",
  "carapace browser click 12 --double",
  "carapace browser click-coords 120 340",
  'carapace browser type 23 "hello" --submit',
  "carapace browser press Enter",
  "carapace browser hover 44",
  "carapace browser drag 10 11",
  "carapace browser select 9 OptionA OptionB",
  "carapace browser upload /tmp/carapace/uploads/file.pdf",
  "carapace browser upload media://inbound/file.pdf",
  'carapace browser fill --fields \'[{"ref":"1","value":"Ada"}]\'',
  "carapace browser dialog --accept",
  'carapace browser wait --text "Done"',
  "carapace browser evaluate --fn '(el) => el.textContent' --ref 7",
  "carapace browser evaluate --fn 'const title = document.title; return title;'",
  "carapace browser console --level error",
  "carapace browser pdf",
  "carapace browser batch --actions-file plan.json",
  'carapace browser batch --actions \'[{"kind":"wait","timeMs":500},{"kind":"click","ref":"12"},{"kind":"type","ref":"23","text":"hello"}]\'',
  "carapace browser batch --actions-file plan.json --continue",
];
