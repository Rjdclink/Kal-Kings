// Kal Kings -- pricing and simulation engine. All dollar amounts are USD.
export const cash = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const validPrice = v => Number.isFinite(Number(v)) && Number(v) > 0 && Number(v) < 1;
export function americanToDecimal(value) {
  const odd = Number(value);
  if (!Number.isFinite(odd) || Math.abs(odd) < 100) throw new RangeError('Invalid American odds');
  return odd > 0 ? 1 + odd / 100 : 1 + 100 / -odd;
}
export function estimatedKalshiFee(count, price) {
  if (!Number.isInteger(count) || count < 1 || !validPrice(price)) throw new RangeError('Invalid contract price or quantity');
  return Math.ceil((0.07 * count * Number(price) * (1 - Number(price))) * 100 - 1e-9) / 100;
}
export function quoteAge(quote, now = Date.now()) {
  const t = new Date(quote?.updatedAt ?? quote?.observedAt ?? '').getTime();
  return Number.isFinite(t) && now >= t ? now - t : Infinity;
}
export function evaluatePair({contracts, kalshiAsk, dkStake, dkAmerican, feeUSD, reviewed, sameResolution, dkAccepted}, now = Date.now()) {
  const units = Number(contracts);
  const stake = Number(dkStake);
  const ask = Number(kalshiAsk);
  if (!Number.isInteger(units) || units < 1 || units > 100000 || !validPrice(ask) || !Number.isFinite(stake) || stake <= 0) throw new RangeError('Invalid trade dimensions');
  const decimal = americanToDecimal(dkAmerican);
  const fee = feeUSD == null ? estimatedKalshiFee(units, ask) : Number(feeUSD);
  if (!Number.isFinite(fee) || fee < 0) throw new RangeError('Fee must be nonnegative');
  const debit = units * ask + stake + fee;
  const kalshiWins = cash(units - debit);
  const draftKingsWins = cash(stake * decimal - debit);
  return {
    contracts: units, kalshiAsk: ask, dkStake: cash(stake), dkAmerican: Number(dkAmerican),
    feeEstimate: cash(fee), capitalRequired: cash(debit), kalshiWins, draftKingsWins,
    minimumProfit: Math.min(kalshiWins, draftKingsWins),
    positiveQuotedSpread: Math.min(kalshiWins, draftKingsWins) > 0,
    executableArbitrage: Boolean(reviewed && sameResolution && dkAccepted && Math.min(kalshiWins, draftKingsWins) > 0),
    assumptions: 'Only if both positions are accepted, opposite, settled equivalently, and all costs match the estimate.',
    calculatedAt: new Date(now).toISOString(),
  };
}
export function seeded(seed = 4579) {
  let state = seed >>> 0;
  return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
}
function quantile(sorted, p) { return sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))]; }
export function monteCarlo(pair, {winProbability = 0.5, secondLegFillProbability = 0.85, trials = 5000, seed = 4579} = {}) {
  if (!(winProbability >= 0 && winProbability <= 1) || !(secondLegFillProbability >= 0 && secondLegFillProbability <= 1)) throw new RangeError('Invalid assumption');
  if (!Number.isInteger(trials) || trials < 100 || trials > 100000) throw new RangeError('Invalid sample count');
  const rng = seeded(seed);
  const results = [];
  const kCost = pair.contracts * pair.kalshiAsk + pair.feeEstimate;
  for (let i = 0; i < trials; i++) {
    const filled = rng() < secondLegFillProbability;
    const kWins = rng() < winProbability;
    let pl = (kWins ? pair.contracts : 0) - kCost;
    if (filled) pl += (kWins ? 0 : pair.dkStake * americanToDecimal(pair.dkAmerican)) - pair.dkStake;
    results.push(pl);
  }
  results.sort((a, b) => a - b);
  return {
    trials, expectedProfit: cash(results.reduce((a, b) => a + b, 0) / trials),
    p05: cash(quantile(results, .05)), median: cash(quantile(results, .5)), p95: cash(quantile(results, .95)),
    lossFrequency: cash(results.filter(v => v < 0).length / trials * 100),
    assumptions: {winProbability, secondLegFillProbability, seed},
    note: 'Scenario model, not a forecast or guarantee. Estimates depend on manually supplied probabilities and fees.',
  };
}
export function normalizedTitle(text) { return String(text || '').toLowerCase().replace(/\b(the|vs|versus|at|will|win|winner|game|match|of|on|to)\b/g, ' ').replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim(); }
export function suggestSimilarMarkets(a, b) {
  // Discovery only. Never use fuzzy matching alone as settlement equivalence.
  const aa = new Set(normalizedTitle(a).split(' ').filter(w => w.length > 2));
  const bb = new Set(normalizedTitle(b).split(' ').filter(w => w.length > 2));
  const shared = [...aa].filter(w => bb.has(w)).length;
  return shared >= 2 && shared / Math.max(aa.size, bb.size, 1) >= .45;
}
export function rankCandidates(rows, max = 10) {
  return rows.filter(row => row?.reviewed && row?.sameResolution && row?.fresh && row?.minimumProfit > 0 && row?.funded)
    .sort((a, b) => b.minimumProfit - a.minimumProfit || String(a.id).localeCompare(String(b.id)))
    .slice(0, max);
}
