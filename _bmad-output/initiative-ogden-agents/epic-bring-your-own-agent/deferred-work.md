
- **21.6 review: the fake OpenCode ignores Ogden's permission config.** `tests/fixtures/fake-opencode.mjs` asks on every tool call whatever `OPENCODE_CONFIG`'s `permission` block says, so the Local conformance row's "every tool call is a card" would still pass if `config.ts` stopped setting `ask`. Make the fake honour the block and add a case where it says `allow`. Open.
