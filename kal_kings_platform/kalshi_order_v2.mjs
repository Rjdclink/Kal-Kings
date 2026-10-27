/**
 * Normalize every internal Kalshi order into the event-market V2 API shape.
 * The V2 endpoint accepts side=bid|ask and one YES-scale dollar price; it does
 * not accept the legacy action=buy/sell, side=yes/no, or yes/no_price_dollars
 * request fields.
 */
const tickerOk = value => typeof value === 'string' && /^[A-Z0-9_-]{4,128}$/.test(value);
const uuidOk = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value);
const finite = value => Number.isFinite(Number(value));
const price4 = value => (Math.round(Number(value) * 10000) / 10000).toFixed(4);
const count2 = value => (Math.round(Number(value) * 100) / 100).toFixed(2);

export function normalizeKalshiOrderV2(order) {
  if (!order || typeof order !== 'object' || Array.isArray(order)) {
    throw new TypeError('Invalid Kalshi order');
  }
  const ticker = order.ticker;
  const clientOrderId = order.client_order_id;
  if (!tickerOk(ticker) || !uuidOk(clientOrderId)) {
    throw new RangeError('Invalid Kalshi order identity');
  }

  let side;
  let price;
  if (['bid', 'ask'].includes(order.side) && order.price != null) {
    // Already in V2 format (used by reduce-only exit orders).
    side = order.side;
    price = Number(order.price);
  } else {
    if (!['yes', 'no'].includes(order.side) || !['buy', 'sell'].includes(order.action)) {
      throw new RangeError('Unsupported legacy Kalshi order shape');
    }
    const outcomePrice = order.side === 'yes'
      ? (order.yes_price_dollars ?? (order.yes_price == null ? null : Number(order.yes_price) / 100))
      : (order.no_price_dollars ?? (order.no_price == null ? null : Number(order.no_price) / 100));
    if (!finite(outcomePrice)) throw new RangeError('Missing or invalid Kalshi limit price');
    const outcomePriceNumber = Number(outcomePrice);
    if (outcomePriceNumber <= 0 || outcomePriceNumber >= 1) {
      throw new RangeError('Kalshi limit price outside valid range');
    }
    // V2 prices are always quoted on the YES book. Buying NO is an ask on the
    // YES book at 1 - NO price; selling NO is a bid at that complementary price.
    price = order.side === 'yes' ? outcomePriceNumber : 1 - outcomePriceNumber;
    side = order.side === 'yes'
      ? (order.action === 'buy' ? 'bid' : 'ask')
      : (order.action === 'buy' ? 'ask' : 'bid');
  }

  const count = Number(order.count);
  if (!finite(count) || count <= 0 || count > 1000000 ||
      Math.abs(count * 100 - Math.round(count * 100)) > 1e-7) {
    throw new RangeError('Invalid Kalshi contract count');
  }
  if (!Number.isFinite(price) || price <= 0 || price >= 1) {
    throw new RangeError('Invalid Kalshi YES-scale price');
  }
  const tif = order.time_in_force ?? 'fill_or_kill';
  if (!['fill_or_kill', 'good_till_canceled', 'immediate_or_cancel'].includes(tif)) {
    throw new RangeError('Invalid Kalshi time in force');
  }
  if (order.reduce_only === true && tif !== 'immediate_or_cancel') {
    throw new RangeError('Reduce-only orders must use immediate_or_cancel');
  }

  const result = {
    ticker,
    client_order_id: clientOrderId,
    side,
    count: count2(count),
    price: price4(price),
    time_in_force: tif,
    self_trade_prevention_type: order.self_trade_prevention_type ?? 'taker_at_cross',
  };
  if (!['taker_at_cross', 'maker'].includes(result.self_trade_prevention_type)) {
    throw new RangeError('Invalid Kalshi self-trade prevention type');
  }
  for (const key of ['cancel_order_on_pause', 'reduce_only', 'post_only']) {
    if (typeof order[key] === 'boolean') result[key] = order[key];
  }
  for (const key of ['expiration_time', 'subaccount', 'order_group_id', 'exchange_index']) {
    if (order[key] != null) result[key] = order[key];
  }
  return result;
}
