# TECH500 — import report

Made by `tools/import-template.js` from https://cio.economictimes.indiatimes.com/tech-500-summit on 2026-09-24, with ET's export.
Theme colour #D8151E: 17 place(s) now read `var(--theme-color, …)`.

| section | name | live id | widget | cards | CSS | notes |
|---|---|---|---|---|---|---|
| banner | Banner | #banner | et-banner |  | 1.2 KB, 0 theme colour | ET's inline script replaced by the et-banner widget's |
| why-now | Technology has stopped supporting the business | #whyNowSection |  | .why-now-card ×4, fit 4 | 6.4 KB, 0 theme colour |  |
| overview | What is Tech 500 | #overview |  |  | 0.8 KB, 0 theme colour |  |
| power-chain | The Power Chain | #power-chain |  | .power-chain-item ×5, fit 5 | 9.0 KB, 8 theme colour |  |
| summit-spotlight | One days. one power room. the full chain in… | #summitSpotlight |  | .summit-spotlight-card ×6, fit 3 | 5.5 KB, 2 theme colour |  |
| agenda | Be in the room where India'senterprise… | #agendaSection |  | .agenda-card ×6, fit 3 | 6.6 KB, 4 theme colour |  |
| industries-in-the-room | Every sector where technology is rewriting the… | #industriesInTheRoom |  | .industry-card ×12, fit 4 | 3.0 KB, 1 theme colour |  |
| strategic-influence | Where the CEO's mandate | #strategicInfluence |  | .strategic-influence-btn ×2 | 5.1 KB, 0 theme colour |  |
| faq | Frequently Asked Questions | #frequently-asked-questions |  | .faq-item ×7 | 5.3 KB, 0 theme colour | ET script wrapped in RevampSections.register() |
| contact-us | Contact us | #contact-us | et-contact |  | 2.9 KB, 0 theme colour | ET app onclick removed |
| about-us | About ETCIO | #about_us_event |  |  | 1.7 KB, 0 theme colour |  |

## Still to do by hand

- Map the custom sections to Create Event content in template.json → content.map (from: hero, about, priorities, stats, whyjoin, attend, contact …; rules in editor-fill.js; TECH500's map is a worked example). Candidates: why-now (.why-now-card), overview (no card list), power-chain (.power-chain-item), summit-spotlight (.summit-spotlight-card), agenda (.agenda-card), industries-in-the-room (.industry-card), strategic-influence (.strategic-influence-btn), faq (.faq-item), about-us (no card list).
- Check the section names and the design selectors in template.json.
- Compare with the live site: node tools/check-template.js tech500-check --live https://cio.economictimes.indiatimes.com/tech-500-summit
