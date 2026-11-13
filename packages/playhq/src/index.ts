// @firstpass/playhq: PlayHQ's public data for every FirstPass product (Studio, Vantage, HQ).
// TypeScript with no Node, Expo or browser built-ins: the product passes in fetch.
//
//   const transport = createTransport({ fetch, tenant: 'netball-australia' });
//   const playhq = createPlayhqApi(transport);
//   const game = await playhq.game(gameId);

export * from './model';
export * from './links';
export * from './rules';
export * from './queries';
export * from './parse';
export * from './transport';
export * from './api';
export * from './keep';
