# Golden fixtures

Cross-language golden fixtures for the Restauranteer vault file format. They pin
the exact behavior of the production web modules (gray-matter 4.0.3 /
js-yaml 3.14.2 emission included) so a Swift port (`VaultFormat`) can be
tested against the very same bytes. **Do not edit anything in this tree by
hand** — it is generated.

## Regenerating

```sh
pnpm export-fixtures
```

That runs `scripts/export-fixtures.ts` via plain Node (type stripping) with
`scripts/fixtures-loader.mjs` mapping the SvelteKit-only import specifiers.
The exporter imports the production modules unmodified:

- `src/lib/server/vault/frontmatter.ts` (gray-matter parse/stringify + date normalization)
- `src/lib/server/vault/visit.ts` (visit block serialize/parse/summaries + body ops)
- `src/lib/server/vault/merge.ts` (three-way merge + conflict-copy naming)
- `src/lib/server/vault/filename.ts` (sanitize + collision resolution)
- `src/lib/server/vault/moc.ts` (list MOC generation, run against a scratch vault + SQLite index)
- `src/lib/attributes.ts` (attribute-override line serializer + slugs)

Everything is deterministic (fixed PRNG seeds, no timestamps, no absolute
paths). `tests/fixtures-export.test.ts` regenerates the tree on every test run
and fails on any byte difference, so a change in the web format shows up as a
reviewable fixture diff. If that test fails: run `pnpm export-fixtures`, review
the diff, commit it, and update the Swift side to match.

## Tagged-scalar JSON encoding

JSON cannot faithfully carry YAML value trees (int/float with equal value,
-0, NaN/Infinity, key order), so wherever fixture JSON contains YAML values
they are encoded as tagged objects:

| Tag | Shape | Notes |
| --- | --- | --- |
| `null` | `{"t":"null"}` | |
| `bool` | `{"t":"bool","v":true}` | |
| `int` | `{"t":"int","v":"4"}` | `v` is a decimal string. Used iff the JS number is a safe integer and not `-0`. |
| `float` | `{"t":"float","v":"4.5","bitsHex":"4012000000000000"}` | `v` is ECMA-262 `String(n)`; `bitsHex` is the exact IEEE-754 double, big-endian hex — reconstruct the number from `bitsHex`. |
| `str` | `{"t":"str","v":"text"}` | |
| `arr` | `{"t":"arr","v":[…]}` | Elements are tagged values. |
| `map` | `{"t":"map","v":[["key", …], …]}` | Ordered `[key, value]` pairs — order is the emission order and MUST be preserved. |

Plain (untagged) JSON is used where values are typed structs rather than YAML
trees (visit inputs/fields, merge metadata, filenames, MOC inputs).

## Families

| Path | Contents |
| --- | --- |
| `frontmatter/serialize/*.json` → `*.expected.md` | `{frontmatter: tagged, body}` → full file bytes from the production serializer. |
| `frontmatter/parse/*.md` → `*.expected.json` | file bytes → `{frontmatter: tagged, body}` from the production parser (YAML dates already normalized to ISO strings). |
| `yaml-scalars/scalars.json` | string quoting/folding torture set; each case emitted in a flat and a nested context (full document bytes). |
| `numbers/doubles.json` | curated + seeded-random doubles: IEEE-754 `bitsHex`, ECMA-262 `js` string, and emission bytes at two indent levels. |
| `visits/serialize/*.json` → `*.expected.md` | `VisitInput` JSON → `visitBlock()` bytes. |
| `visits/parse/*.md` → `*.expected.json` | body bytes → parsed visits (raw blocks + fields) + summary. |
| `visits/body-ops.json` | append/update-at/remove-at body transformations. |
| `merge/*.json` | three-way merge cases (`loaded/current/pending/dirtyFields/bodyDirty` → `MergeResult`); `conflict-copy-paths.json` for conflict-copy naming. |
| `filenames/cases.json` | collision-free path resolution, filename sanitization, attachment-dir slugs, attribute-id slugs. |
| `moc/*.json` → `*.expected.md` | list-MOC state → generated file bytes (sentinel frontmatter + wikilink body). |
| `documents/*.md` → `*.expected.json` + `*.reemit.md` | full realistic files → parse result AND parse→stringify bytes (`01-web-written-full` is a serializer fixed point). |
| `fuzz/corpus.ndjson` | 200 seeded-PRNG cases (seed `0x5eedf00d`), one JSON object per line: `{i, frontmatter: tagged, body, expected}`. |

## Format conventions worth knowing (captured by these fixtures)

- Emission is js-yaml 3.14.2 defaults: 2-space indent, 80-column line
  width with `>-` folding, single quotes for YAML-1.1-ambiguous scalars
  (`'yes'`, `'no'`, `'y'`, ISO timestamps, number-looking strings), `|-`/`|`/`|+`
  literal blocks for multiline strings, double quotes only when escapes are
  required (astral unicode emits `\U0001F35C`-style escapes).
- Numbers: integer-valued doubles emit `String(n)` (so `1e21` → `1e+21`);
  non-integers get a `.e` fix-up (`1e-7` → `1.e-7`); `-0` → `-0.0`;
  `NaN/±Infinity` → `.nan/.inf/-.inf`.
- An empty frontmatter map emits no `---` block at all; the body always gains a
  trailing newline if missing.
- Visit blocks: `### YYYY-MM-DD — Meal` headers (em-dash), bold labels with
  two trailing spaces (hard line breaks), literal `★`/`☆` stars, dish bullets
  with indented photo lines, `**Rating:** X/5 (avg)` when derived from areas.
