// PlayHQ page links. Two kinds are pasted into FirstPass:
//   organisation  https://www.playhq.com/netball-australia/org/west-coast-mens-and-mixed-netball-association/a9434809
//                 (Studio's competition setup: the organisation whose competitions to list)
//   season        https://www.playhq.com/netball-australia/org/perth-netball/winter-2026/ec69e46d
//                 (HQ's fixture import: one competition season)
// Either may have a page after it (/fixture, /teams, ?tab=1, #ladder), a locale (/au/) before the
// sport, and no https:// or www. Anything that isn't playhq.com itself is refused.

/** The sport's PlayHQ "tenant", such as netball-australia. Sent as a header on every request. */
export type Tenant = string;

export type OrganisationLink = {
  kind: 'organisation';
  tenant: Tenant;
  /** The organisation's name in the link, such as west-coast-mens-and-mixed-netball-association. */
  orgSlug: string;
  /** PlayHQ's 8-character organisation id, such as a9434809. */
  orgId: string;
  /** The link without any page, query or locale after or before it. */
  url: string;
};

export type SeasonLink = {
  kind: 'season';
  tenant: Tenant;
  orgSlug: string;
  /** The season's name in the link, such as winter-2026. */
  seasonSlug: string;
  /** The season's short id at the end of the link, such as ec69e46d. PlayHQ's discoverSeason takes it. */
  seasonCode: string;
  url: string;
};

export type PlayhqLink = OrganisationLink | SeasonLink;

const PREFIX = /^(?:https?:\/\/)?(?:www\.)?playhq\.com\/(?:([a-z]{2})\/)?([a-z0-9-]+)\/org\/([^/?#\s]+)\/([^/?#\s]+)(?:\/([^/?#\s]+))?(?=[/?#]|$)/i;
const ORG_ID = /^[0-9a-f]{8}$/i;
const SEASON_CODE = /^[0-9a-f]{6,}$/i;

/**
 * Reads an organisation or season link (see the top of this file). null when it is neither.
 * A link whose third part is a 6+ character hex code is a season; otherwise one whose second part is
 * an 8-character hex id is an organisation (whatever page follows it).
 */
export function parsePlayhqLink(text: string | null | undefined): PlayhqLink | null {
  const m = String(text ?? '').trim().match(PREFIX);
  if (!m) return null;
  const [, , tenantRaw, org, second, third] = m;
  if (!tenantRaw || !org || !second) return null;
  const tenant = tenantRaw.toLowerCase();
  if (third && SEASON_CODE.test(third)) {
    return {
      kind: 'season',
      tenant,
      orgSlug: org,
      seasonSlug: second,
      seasonCode: third.toLowerCase(),
      url: `https://www.playhq.com/${tenantRaw}/org/${org}/${second}/${third}`,
    };
  }
  if (ORG_ID.test(second)) {
    return {
      kind: 'organisation',
      tenant,
      orgSlug: org,
      orgId: second.toLowerCase(),
      url: `https://www.playhq.com/${tenantRaw}/org/${org}/${second}`,
    };
  }
  return null;
}

/** Studio's parsePlayhqUrl: the tenant and organisation id of an organisation link, else null. */
export function parseOrganisationLink(text: string | null | undefined): { tenant: Tenant; orgId: string } | null {
  const link = parsePlayhqLink(text);
  return link && link.kind === 'organisation' ? { tenant: link.tenant, orgId: link.orgId } : null;
}

/** HQ's parsePlayhqLink: the tenant, season code and tidy link of a season link, else null. */
export function parseSeasonLink(
  text: string | null | undefined,
): { tenant: Tenant; seasonCode: string; url: string } | null {
  const link = parsePlayhqLink(text);
  return link && link.kind === 'season' ? { tenant: link.tenant, seasonCode: link.seasonCode, url: link.url } : null;
}

/** A tenant PlayHQ would accept in its header: lower-case letters, digits and dashes. */
export const isTenant = (s: unknown): s is Tenant => typeof s === 'string' && /^[a-z0-9-]+$/.test(s);
