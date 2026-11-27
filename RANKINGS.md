# Top 100 for Japanese immersion

Each platform has 100 editorial picks. Account identity comes from
[Wikidata structured data under CC0](https://www.wikidata.org/wiki/Wikidata:Licensing).
Each row in `top.json` records the Wikidata item used for its Japanese
display name and account identifier. English labels and descriptions are
taken from that item where available. Entries marked `description_source` as
`ja-translation` use our English translation of the item's Japanese
description; the two marked `english_source` as `romanization` use our
romanization of the Japanese name. Descriptions concern the person or
organization and may not describe every linked channel. Open
**Account source** in a preview to see that record.

## How the list was made

The first edition queried Wikidata for accounts linked to people with
Japanese citizenship (P27) or entities with Japan as country of origin
(P495), using the Japanese label and the platform identifier. The account
properties are [YouTube channel ID](https://www.wikidata.org/wiki/Property:P2397),
[Instagram username](https://www.wikidata.org/wiki/Property:P2003), and
[TikTok username](https://www.wikidata.org/wiki/Property:P7085).

Occupation statements, Japanese descriptions, and language statements
helped shortlist candidates. The editorial selection favors cooking demos,
comedy, explainers, gaming commentary, everyday life, culture, and sports
commentary. Each topic has its own selections in editorial order. The final
list cycles through the topics while there are picks left. This gives each
platform variety near the top. Account availability, activity, and language
can change. The first edition used source metadata and editorial judgment.
An account-by-account playback or language audit was outside that review.

## Updating the list

For each candidate, verify the Japanese label and platform ID on the linked
Wikidata item, check the account fits the immersion theme, and assign a topic.
If an item lists more than one account, use one verified account per
platform. Record the QID in `source` and keep the platform lists at 100
unique accounts. Update `updated` and run `node --test tests/*.test.mjs`.

The new catalog carries no third-party rankings, follower counts, scraped
descriptions, or media files. The topic assignments and order are
Kakehashi's editorial work. Live previews still use external platforms and
have their own terms. The private development history contains the original ranking snapshot and requires separate clearance before publishing that history.
