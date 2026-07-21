/**
 * Public runtime source registry for Pass the Fear Guide Hub.
 * Maps public-safe source IDs to exact official URLs, last-checked dates and evidence scope.
 * Private evidence (screenshots, research notes, user-provided Trends data) is never published.
 */
export interface Source {
  id: string;
  title: string;
  url: string;
  lastChecked: string;
  scope: string;
  publishState: 'PUBLISHED' | 'SIGNAL_ONLY';
}

export const sources: Source[] = [
  {
    id: 'PTF-S01',
    title: 'Pass the Fear — Steam Store (official store listing)',
    url: 'https://store.steampowered.com/app/3561220/Pass_the_Fear/',
    lastChecked: '2026-07-20',
    scope: 'Game identity, features, systems, release listing and platform requirements. No images copied.',
    publishState: 'PUBLISHED',
  },
  {
    id: 'PTF-S02',
    title: 'Pass the Fear — Steam Community hub and official announcements',
    url: 'https://steamcommunity.com/app/3561220',
    lastChecked: '2026-07-20',
    scope: 'June 14 official launch announcement (July 23, 2026), demo scope (4 characters), full-release additions, and demo offline schedule. No images copied.',
    publishState: 'PUBLISHED',
  },
];

export const sourceById = new Map(sources.map((s) => [s.id, s]));
