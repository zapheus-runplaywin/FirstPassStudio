// FirstPass Studio - the venue link: a game's FirstPass events over the venue's own network.
//
// A club's FirstPass stats normally reach Studio from the club's FirstPass HQ over the internet (hqstats.ts). At a
// venue whose internet is slow, FirstPass Vantage (the statistician's tablet) can also hand each event straight to
// Studio, and the FirstPass Vision phone app (the coach's phone) can read them from Studio, so the stream's graphics
// and the coach keep up with the game. HQ still gets every event from Vantage as before, and stays the record.
//
// Two routes, both FirstPass routes, so private as the rest (access.firstpassRefusal()): they answer this Mac, a
// browser allowed over the secure link, and a FirstPass app allowed in Devices… (devices.ts kind 'stats': it asks and
// collects its key over the secure link, someone at the Mac presses Allow, and its key counts for these routes only).
// Never over plain http from another device: the events are about athletes, many under 18.
//
//   POST /api/firstpass/venue/events { gameId, events: [...] }
//     From Vantage. Taken only for the game Studio is already following from HQ (the game on the scoreboard, recorded
//     by a club signed in on this Mac), so HQ's rules still decide whether Studio may hold the game at all. Answers
//     { throughSeq, taken }: how far the game's primary events now reach here, so Vantage knows where to send from.
//     409 { reason: 'not-followed' } when it isn't that game, { reason: 'other-recorder' } when HQ's copy showed this
//     device's events aren't the game's record. Only this Mac or a FirstPass app may send (not a paired browser).
//
//   GET /api/firstpass/venue/events?game=<id>&after=<seq>&wait=<seconds>
//     For Vision. The game's primary events after a seq and every helper event, as hqstats.ts holds them (HQ's, then
//     any the venue link gave that HQ hasn't sent yet). Ids only: names and the game's setup come from HQ itself.
//     With wait (25 at most) it answers as soon as there is something after that seq, or when the wait ends. 404 when
//     the game isn't the one followed.
//
// Nothing is saved here and nothing is logged but counts (hqstats.ts).

import { arr, str } from './check';
import { validGame } from './firstpass';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HqStats } from './hqstats';
import type { Body, Send } from './types';

const MAX_WAIT_S = 25;
const MAX_EVENTS = 200;   // in one POST
const MAX_WAITING = 20;   // readers waiting at once; the next one is answered straight away

function create({ stats }: { stats: Pick<HqStats, 'venue' | 'since' | 'onChange'> }) {
  let waiting = 0;

  // Resolves when the followed game's events grow, the wait ends or the reader goes away.
  function grown(req: IncomingMessage, ms: number): Promise<void> {
    return new Promise(resolve => {
      waiting++;
      const done = () => { waiting--; clearTimeout(timer); off(); req.off('close', done); resolve(); };
      const off = stats.onChange(done);
      const timer = setTimeout(done, ms);
      timer.unref?.();
      req.on('close', done);
    });
  }

  // true when the request was one of the venue link's (and has been answered). sender: the FirstPass app's device id,
  // 'this-mac', or '' for anything else that may read FirstPass stats (a secure paired browser).
  async function route(req: IncomingMessage, res: ServerResponse, url: URL,
    { send, readBody, sender }: { send: Send; readBody: (req: IncomingMessage) => Promise<Body>; sender: string }): Promise<boolean> {
    if (url.pathname !== '/api/firstpass/venue/events') return false;
    if (req.method === 'POST') {
      if (!sender) { send(res, 403, { error: 'Only FirstPass Vantage, allowed in Devices… on the Mac, sends a game\'s events to Studio.' }); return true; }
      let body: Body;
      try { body = await readBody(req); } catch { send(res, 400, { error: 'That wasn\'t JSON.' }); return true; }
      const gameId = str(body.gameId);
      const events = arr(body.events);
      if (!validGame(gameId) || events.length > MAX_EVENTS) { send(res, 400, { error: `Send { gameId, events }, ${MAX_EVENTS} events at most.` }); return true; }
      const took = stats.venue(gameId, events, sender);
      if (!took.ok) {
        send(res, 409, { reason: took.reason, error: took.reason === 'not-followed'
          ? 'Studio isn\'t following this game: it takes the game on its scoreboard, recorded by a club signed in to FirstPass HQ on the Mac.'
          : 'FirstPass HQ has this game from another device, so Studio isn\'t taking this one\'s events.' });
        return true;
      }
      send(res, 200, { throughSeq: took.throughSeq, taken: took.taken });
      return true;
    }
    if (req.method !== 'GET') return false;
    const gameId = url.searchParams.get('game') || '';
    const after = Math.max(0, Math.floor(Number(url.searchParams.get('after')) || 0));
    const wait = Math.min(MAX_WAIT_S, Math.max(0, Number(url.searchParams.get('wait')) || 0));
    let got = validGame(gameId) ? stats.since(gameId, after) : null;
    if (got && wait && !got.events.length && waiting < MAX_WAITING) {
      await grown(req, wait * 1000);
      if (res.destroyed || req.destroyed) return true;
      got = stats.since(gameId, after);
    }
    if (!got) { send(res, 404, { reason: 'not-followed', error: 'Studio isn\'t following this game.' }); return true; }
    send(res, 200, got);
    return true;
  }

  return { route };
}

export { create, MAX_WAIT_S, MAX_EVENTS };
