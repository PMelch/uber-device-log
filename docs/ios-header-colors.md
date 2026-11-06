# Native iOS header colors

Presentation only: captured records, process metadata, clipboard/export and search input are unchanged. Android and WebView records do not opt in. Existing file-failure and crash/stack presentation takes precedence (those records keep their diagnostic styling rather than header spans). No severity filtering or capture-level changes.

The anchored parser follows the envelope shapes in shared/ios-processes.ts: month day HH:mm:ss, optional device, process(component)[PID] <Level>:; and YYYY-MM-DD[ T]HH:mm:ss with optional fraction and Z/numeric offset, followed by either that syslog envelope or process[PID:thread]. Spaces/tabs, punctuation, body, newlines and original labels are retained as source slices; Vue text interpolation prevents markup execution. PID must be a safe nonnegative integer. No missing year/timezone is invented. Numeric day/month ranges are checked, not calendar validity.

Month tokens: English Jan–Dec, plus explicit case-insensitive Jän, Mär, Mai, Okt, Dez; janv, févr, mars, avr, juin, juil, août, sept, oct, nov, déc; ene, abr, ago, dic; gen, mag, giu, lug, set. A trailing period is allowed. These are bounded lexical aliases, not universal locale/date parsing. Numeric slash dates, unknown months, arbitrary prefixes and ambiguous envelopes remain raw. Process/device tokens cannot contain whitespace; nested components are unsupported.

Debug is blue, Info/Notice green, Warning amber, Error red and Fault/Critical/Alert/Emergency magenta. Unknown labels (including Default) remain neutral; OSLog and legacy syslog vocabularies are not assumed equivalent. Labels themselves always remain verbatim.

Palette (light / dark): timestamp and unknown #59616c / #b3b8c2; device/debug #245a9b / #96c2ff; process #086b66 / #78d4c7; subsystem #6c5878 / #c5afd5; PID #765321 / #dfc08b; info/notice #27623d / #9cd5a9; warning #805000 / #f0c579; error #a52c35 / #ffa5ad; fatal #8e2865 / #f0a4d2.

Verification: npm test; npm run build; node --import tsx scripts/test-ios-header.mjs. Browser fixture uses synthetic data at desktop/mobile widths in both themes, tests raw DOM text, HTML safety, crash priority, search and Android exclusion; measures WCAG normal-text contrast >=4.5 against current panel, wash, selection and severity backgrounds. There is no existing zebra-striping rule; wash is tested as the stripe-equivalent background without introducing striping. Override IOS_HEADER_ARTIFACTS to choose screenshot directory.
