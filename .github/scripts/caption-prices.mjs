// Rebuilds captionprices.json, what Studio's AI captions (captions.ts) cost per model, from LiteLLM's public price
// list (https://github.com/BerriAI/litellm, model_prices_and_context_window.json): the chat models of the three
// providers Studio writes captions with, in US dollars per million tokens. Run weekly by .github/workflows/caption-prices.yml,
// which opens a pull request when a price changes; run it by hand with: node .github/scripts/caption-prices.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'captionprices.json');
// LiteLLM's provider name, the prefix on its model names, and ours.
const PROVIDERS = [['anthropic', '', 'anthropic'], ['openai', '', 'openai'], ['gemini', 'gemini/', 'google']];
const perMillion = n => Math.round(n * 1e6 * 1e6) / 1e6;

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`LiteLLM's price list answered ${res.status}`);
const all = await res.json();
const models = {};
for (const [, , ours] of PROVIDERS) models[ours] = {};
for (const [name, m] of Object.entries(all).sort(([a], [b]) => a.localeCompare(b))) {
  if (!m || typeof m !== 'object' || !['chat', 'responses'].includes(m.mode)) continue;
  const p = PROVIDERS.find(([lp, prefix]) => m.litellm_provider === lp && (prefix ? name.startsWith(prefix) : !name.includes('/')));
  if (!p || typeof m.input_cost_per_token !== 'number' || typeof m.output_cost_per_token !== 'number') continue;
  models[p[2]][name.slice(p[1].length)] = { in: perMillion(m.input_cost_per_token), out: perMillion(m.output_cost_per_token) };
}
for (const [, , ours] of PROVIDERS) if (Object.keys(models[ours]).length < 5) throw new Error(`Only ${Object.keys(models[ours]).length} ${ours} models in LiteLLM's list: not trusting it`);
const file = { about: 'US dollars per million tokens, from LiteLLM\'s price list. Made by .github/scripts/caption-prices.mjs: don\'t edit by hand.', source: SOURCE, models };
fs.writeFileSync(OUT, JSON.stringify(file, null, 2) + '\n');
console.log(`captionprices.json: ${PROVIDERS.map(([, , o]) => `${Object.keys(models[o]).length} ${o}`).join(', ')} models`);
