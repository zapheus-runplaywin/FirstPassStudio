# @firstpass/playhq

PlayHQ's public data for every FirstPass product: Studio, Vantage, and later HQ's `playhq` function.
One copy of the link parsing, the GraphQL queries, the guest-session handshake, and the parsers for
fixtures, line ups, ladders and the live scoring feed, instead of one per product.

It is TypeScript with no Node, Expo or browser built-ins. The product passes in `fetch` and is
told about every request, so the same code runs on a tablet (Hermes), in Studio (Node and Electron),
in an Edge Function and in tests. Caching, saving to disk and logging stay in the product.

## Use

```js
const { createTransport, createPlayhqApi, createKeeper, parseOrganisationLink } = require('@firstpass/playhq');

const link = parseOrganisationLink(config.playhqUrl); // { tenant, orgId } or null
const transport = createTransport({
  fetch,                                   // global fetch, or the product's own
  tenant: link.tenant,
  unreachableHint: 'Is this Mac connected to the internet?',
  onRequest: (r) => net.note({ ms: r.ms, bytes: r.length }),  // traffic counter, debug log
  onAnswer: (a) => recorder.playhq(a.operationName, a.variables, a.tenant, a.data),
  answer: (op, vars) => (practice.active() ? practice.answer(op, vars) : undefined),
});
const playhq = createPlayhqApi(transport, {
  learned: saved.learned,                  // what PlayHQ refused last time, if saved
  onLearn: (learned) => save({ learned }),
});

const competitions = await playhq.competitions(link.orgId);
const { grades } = await playhq.season(seasonId);
const ladder = await playhq.ladder(grades[0].id);
const rounds = await playhq.rounds(grades[0].id);
const games = await playhq.roundGames(rounds[0].id);
const detail = await playhq.game(games[0].id);         // line ups, positions, shooting
const live = await playhq.live(games[0].id);           // score, counts, scorer's clock; err.notScored before scoring starts

// Studio's "keep the last good answer while PlayHQ is down":
const ladders = createKeeper();
const { value, stale } = await ladders.get(gradeId, 60_000, () => playhq.ladder(gradeId));
```

HQ's fixture import is one call: `playhq.seasonFixtures(parseSeasonLink(url).seasonCode)` gives the
teams and fixture rows HQ saves (`createTransport({ fetch, tenant, session: false, allowPartial: true })`
matches what its Edge Function does today).

## What's in it

| Module | Holds |
| --- | --- |
| `links` | `parsePlayhqLink` for organisation and season links, plus `parseOrganisationLink` (Studio's `parsePlayhqUrl`) and `parseSeasonLink` (HQ's `parsePlayhqLink`) |
| `model` | The one fixture, line-up, ladder and live model, from Studio's shapes with PlayHQ's ids added |
| `rules` | `statCount`, `isFinished`, `startOf`, `localDate`, genders, `positionOf`, `POSITION_RANK`, `PERIOD_NUMBER`, `TIMEZONES` |
| `queries` | The GraphQL text and PlayHQ's URLs |
| `parse` | Answers into the model: `parseGame`, `parseLive`, `parseRoundGames`, `parseLadder`, `parseSeason`, `pickSeason`, `collectFixtures` |
| `transport` | `createTransport`: guest session, headers, one retry on 401/403, `PlayhqError` (`status`, `graphql`, `unreachable`, `notScored`) |
| `api` | `createPlayhqApi`: competitions, season, ladder, rounds, roundGames, game, live, gradeFixture, seasonFixtures |
| `keep` | `createKeeper`: a memory cache with one request per key and the last good answer, marked `stale`, while PlayHQ fails |

## Where it lives and how each product gets it

The source lives in FirstPass Studio's repository (`packages/playhq`), so anyone who forks or clones
Studio can build it without a token. It is published to the public npm registry as
`@firstpass/playhq` (MIT).

- **Studio** uses it from this folder through an npm workspace. `npm ci` at Studio's root builds
  `dist/` (the package's `prepare` script), and `require('@firstpass/playhq')` loads it.
- **Vantage and Vision** install the published version from npm: `"@firstpass/playhq": "^0.2.0"`.
- **HQ** can do the same when its `playhq` function moves onto it.

The build is CommonJS (`dist/index.js`) with type definitions (`dist/index.d.ts`); ES module code and
bundlers (Metro, esbuild) import it as usual.

## Versions

Each release has its own version. A pull request that changes this package bumps `version` in
`package.json` and adds a line to `CHANGELOG.md`; merging it to Studio's main publishes that version
to npm (Studio's "Publish packages" workflow, with npm trusted publishing: no stored token). Fields in
the model are only ever added: never renamed or removed, and consumers ignore fields they don't know.
Breaking changes need a major version.

## Develop

From Studio's root (`npm ci` installs and builds it):

```bash
npm test --workspace @firstpass/playhq            # vitest against a stand-in PlayHQ (test/world.ts), with coverage floors
npm run typecheck --workspace @firstpass/playhq   # source and tests
npm run build --workspace @firstpass/playhq       # dist/
npm run test:dist --workspace @firstpass/playhq   # loads dist/ with plain require() and import, as Studio does
```

PlayHQ can't be reached from CI, so the tests run against `test/world.ts`, ported from Studio's
stand-in PlayHQ (`test/support/playhq.js`).
