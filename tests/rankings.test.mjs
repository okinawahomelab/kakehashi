import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const catalog = JSON.parse(readFileSync(new URL("../top.json", import.meta.url), "utf8"));
const handles = { yt: /^UC[\w-]{22}$/, ig: /^[\w.]{1,30}$/, tt: /^[\w.]{1,30}$/ };

test("each immersion list has 100 distinct accounts with Wikidata provenance", () => {
  assert.equal(catalog.schema, 1);
  assert.equal(catalog.source, "Wikidata (CC0)");
  for (const [network, format] of Object.entries(handles)) {
    const rows = catalog[network];
    assert.equal(rows.length, 100, network);
    const ids = new Set(rows.map(({ id }) => network === "yt" ? id : id.toLowerCase()));
    assert.equal(ids.size, 100, network);
    assert.equal(new Set(rows.map(({ source }) => source)).size, 100, network);
    assert.ok(new Set(rows.slice(0, 7).map(({ topic }) => topic)).size >= 5, network);
    for (const row of rows) {
      assert.ok(Object.keys(row).every(key => ["id", "name", "source", "topic", "english", "description", "english_source", "description_source"].includes(key)));
      assert.match(row.id, format);
      assert.match(row.source, /^Q[1-9]\d*$/);
      assert.ok(row.name.trim() && row.topic.trim());
      for (const key of ["english", "description"]) assert.ok(typeof row[key] === "string" && row[key].trim());
      if (row.english_source) assert.equal(row.english_source, "romanization");
      if (row.description_source) assert.equal(row.description_source, "ja-translation");
    }
  }
});

test("the Taiwan-focused Iku account is not presented as a Japanese immersion pick", () => {
  assert.ok(catalog.yt.every(row => row.id !== "UCi6Ki2oniUnaI1pne31TFoQ"));
  assert.ok(catalog.ig.every(row => row.id.toLowerCase() !== "ikulaoshi"));
});

test("the sampled replacement creators remain in the corresponding lists", () => {
  const evidence = JSON.parse(readFileSync(new URL('./fixtures/replacement-samples.json', import.meta.url), 'utf8'));
  for (const sample of evidence.samples) {
    const network = sample.platform === 'instagram' ? 'ig' : 'yt';
    assert.equal(sample.detected_language, 'ja');
    assert.equal(sample.source_channel, sample.creator);
    assert.match(sample.sample_sha256, /^[a-f0-9]{64}$/);
    assert.ok(catalog[network].some(row => row.id === sample.creator));
  }
});
