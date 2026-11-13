import { describe, expect, it } from 'vitest';
import { isTenant, parseOrganisationLink, parsePlayhqLink, parseSeasonLink } from '../src/links';

// Both kinds of link FirstPass reads: HQ's season links and Studio's organisation links.
// The season cases are HQ's src/lib/__tests__/playhq.test.ts, so HQ can switch without a change.
describe('season links (HQ fixture import)', () => {
  const link = 'https://www.playhq.com/netball-australia/org/perth-netball/winter-2026/ec69e46d';

  it('reads a competition season link', () => {
    expect(parseSeasonLink(link)).toEqual({ tenant: 'netball-australia', seasonCode: 'ec69e46d', url: link });
    expect(parsePlayhqLink(link)).toEqual({
      kind: 'season', tenant: 'netball-australia', orgSlug: 'perth-netball', seasonSlug: 'winter-2026', seasonCode: 'ec69e46d', url: link,
    });
  });

  it('reads a link with a page after it', () => {
    expect(parseSeasonLink(`${link}/fixture`)?.seasonCode).toBe('ec69e46d');
    expect(parseSeasonLink(`${link}/teams`)?.url).toBe(link);
    expect(parseSeasonLink(`${link}?tab=1`)?.url).toBe(link);
    expect(parseSeasonLink(`${link}#ladder`)?.url).toBe(link);
  });

  it('reads a link without https or www, and with spaces around it', () => {
    expect(parseSeasonLink('playhq.com/netball-australia/org/perth-netball/winter-2026/ec69e46d')?.url).toBe(link);
    expect(parseSeasonLink('  http://playhq.com/netball-australia/org/perth-netball/winter-2026/ec69e46d  ')?.url).toBe(link);
  });

  it('lower-cases the tenant and code but keeps the link as typed', () => {
    expect(parseSeasonLink('https://www.playhq.com/Netball-Australia/org/Perth/Winter/EC69E46D')).toEqual({
      tenant: 'netball-australia',
      seasonCode: 'ec69e46d',
      url: 'https://www.playhq.com/Netball-Australia/org/Perth/Winter/EC69E46D',
    });
  });

  it('refuses anything that is not a season link on playhq.com', () => {
    expect(parseSeasonLink('')).toBeNull();
    expect(parseSeasonLink(null)).toBeNull();
    expect(parseSeasonLink('https://example.com/netball-australia/org/a/b/ec69e46d')).toBeNull();
    expect(parseSeasonLink('https://www.playhq.com/netball-australia/org/perth-netball')).toBeNull();
    // The season code is hex, at least six characters.
    expect(parseSeasonLink('https://www.playhq.com/netball-australia/org/a/b/ec69e')).toBeNull();
    expect(parseSeasonLink('https://www.playhq.com/netball-australia/org/a/b/zzzzzzzz')).toBeNull();
    expect(parseSeasonLink('https://www.playhq.com/netball-australia/org/a/b/ec69e46dzz')).toBeNull();
    expect(parseSeasonLink('https://www.playhq.com.evil.com/netball-australia/org/a/b/ec69e46d')).toBeNull();
    // An organisation link is not a season link.
    expect(parseSeasonLink('https://www.playhq.com/netball-australia/org/wcmmna/a9434809')).toBeNull();
  });
});

describe('organisation links (Studio competition setup)', () => {
  const org = 'https://www.playhq.com/netball-australia/org/west-coast-mens-and-mixed-netball-association/a9434809';

  it('reads the tenant and organisation id', () => {
    expect(parseOrganisationLink(org)).toEqual({ tenant: 'netball-australia', orgId: 'a9434809' });
    expect(parsePlayhqLink(org)).toEqual({
      kind: 'organisation', tenant: 'netball-australia', orgSlug: 'west-coast-mens-and-mixed-netball-association', orgId: 'a9434809', url: org,
    });
  });

  it('reads one with a page after it, a locale before the sport, or no https', () => {
    expect(parseOrganisationLink(`${org}/competitions`)).toEqual({ tenant: 'netball-australia', orgId: 'a9434809' });
    expect(parsePlayhqLink(`${org}/competitions`)?.url).toBe(org);
    expect(parseOrganisationLink('https://www.playhq.com/au/netball-australia/org/wcmmna/a9434809')).toEqual({ tenant: 'netball-australia', orgId: 'a9434809' });
    expect(parseOrganisationLink('playhq.com/basketball-victoria/org/club/0123abcd?x=1')).toEqual({ tenant: 'basketball-victoria', orgId: '0123abcd' });
  });

  it('refuses one without an 8-character id, or not on playhq.com', () => {
    expect(parseOrganisationLink('https://www.playhq.com/netball-australia/org/wcmmna')).toBeNull();
    expect(parseOrganisationLink('https://www.playhq.com/netball-australia/org/wcmmna/a943480')).toBeNull();
    expect(parseOrganisationLink('https://www.playhq.com/netball-australia/org/wcmmna/a9434809z')).toBeNull();
    expect(parseOrganisationLink('https://evilplayhq.com/netball-australia/org/wcmmna/a9434809')).toBeNull();
    expect(parseOrganisationLink(undefined)).toBeNull();
    // A season link is not an organisation link.
    expect(parseOrganisationLink('https://www.playhq.com/netball-australia/org/perth-netball/winter-2026/ec69e46d')).toBeNull();
  });

  it('reads an organisation link whose page name happens to be hex as an organisation', () => {
    // "/a9434809/fixture": "fixture" isn't hex, so this is the organisation's fixture page.
    expect(parsePlayhqLink(`${org}/fixture`)?.kind).toBe('organisation');
  });
});

describe('isTenant', () => {
  it('accepts what PlayHQ takes in its tenant header and nothing else', () => {
    expect(isTenant('netball-australia')).toBe(true);
    expect(isTenant('Netball-Australia')).toBe(false);
    expect(isTenant('netball australia')).toBe(false);
    expect(isTenant('')).toBe(false);
    expect(isTenant(undefined)).toBe(false);
  });
});
