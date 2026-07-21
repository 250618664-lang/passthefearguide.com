export const siteConfig = {
  name: 'Pass the Fear Guide Hub',
  gameName: 'Pass the Fear',
  siteUrl: 'https://passthefearguide.com',
  description: 'An unofficial, source-aware English guide hub for Pass the Fear on Steam. Helps players find verified launch facts and routes to the right guide without generic fear content or Halloween Horror Nights pollution.',
  language: 'en',
  templateMode: false,
  noIndex: false,
  lastUpdated: '2026-07-20',
  sourceScope: 'Official Steam store (store.steampowered.com) and official Steam Community announcement hub (steamcommunity.com). All facts traced to PTF-S01 and PTF-S02.',
  theme: {
    themeColor: '#9B8CFF',
    backgroundColor: '#090D18',
    cardColor: '#141A2A',
    textColor: '#F4F1FF',
    accentColor: '#55D6BE',
  },
  ads: {
    enabled: true,
    provider: 'native-banner',
    slots: {
      'native-after-answer': {
        loaderUrl: 'https://pl30459301.effectivecpmnetwork.com/4499ca96010bfd0d82e881acb7d864fe/invoke.js',
        containerId: 'container-4499ca96010bfd0d82e881acb7d864fe',
      },
    },
  },
};
