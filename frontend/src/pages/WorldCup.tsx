import React from 'react';

const streamLinks = [
  {
    title: 'FIFA Match Centre',
    description: 'Official match page, live score, lineups, stats, highlights, and broadcast information for the World Cup final.',
    href: 'https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026',
    action: 'Open FIFA',
    icon: '⚽'
  },
  {
    title: 'FIFA+',
    description: 'Official FIFA video hub for live coverage where broadcast rights permit, replays, highlights, and features.',
    href: 'https://www.plus.fifa.com/',
    action: 'Open FIFA+',
    icon: '📺'
  },
  {
    title: 'JioHotstar',
    description: 'Official Indian broadcaster for the FIFA World Cup 2026. Sign in with your own Hotstar/JioHotstar subscription.',
    href: 'https://www.hotstar.com/in',
    action: 'Open Hotstar',
    icon: '🇮🇳'
  },
  {
    title: 'ZEE5',
    description: 'Open the official ZEE5 site and sign in with your own valid account if your region carries match coverage.',
    href: 'https://www.zee5.com/',
    action: 'Open ZEE5',
    icon: '🔵'
  },
  {
    title: 'Sony LIV',
    description: 'Another major streaming platform carrying international football coverage in certain regions.',
    href: 'https://www.sonyliv.com/',
    action: 'Open SonyLIV',
    icon: '📡'
  },
  {
    title: 'Official Broadcasters List',
    description: 'Find the licensed broadcaster in your country from the official FIFA media rights page.',
    href: 'https://www.fifa.com/en/about-fifa/commercial/media-rights',
    action: 'Find Broadcaster',
    icon: '🌍'
  },
];

export default function WorldCup() {
  return (
    <div className="space-y-6">
      {/* Hero banner */}
      <section className="rounded-xl border border-blue-100 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">
              FIFA World Cup 2026 · Canada / Mexico / USA
            </p>
            <h1 className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">
              🏆 Watch the Final
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-gray-600 dark:text-gray-300">
              Quick access to official match coverage, licensed streaming platforms, live scores, and post-match highlights.
              All links open the official broadcaster or FIFA's own properties.
            </p>
          </div>
          <div className="flex gap-3 flex-wrap">
            <a
              href="https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center rounded-lg bg-[#0072ce] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#005eb8]"
            >
              Open Match Centre
            </a>
            <a
              href="https://www.plus.fifa.com/"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center rounded-lg border border-blue-200 px-4 py-2 text-sm font-semibold text-blue-700 transition hover:border-blue-500 hover:bg-blue-50 dark:border-blue-900 dark:text-blue-300 dark:hover:bg-blue-950"
            >
              Open FIFA+
            </a>
          </div>
        </div>
      </section>

      {/* Stream cards */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400">
          Official Streaming Options
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {streamLinks.map(link => (
            <article
              key={link.title}
              className="flex flex-col rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition hover:border-blue-400 hover:shadow-md dark:border-gray-800 dark:bg-gray-900"
            >
              <div className="mb-3 text-3xl">{link.icon}</div>
              <h3 className="text-base font-semibold text-gray-900 dark:text-white">{link.title}</h3>
              <p className="mt-2 flex-1 text-sm leading-6 text-gray-600 dark:text-gray-300">
                {link.description}
              </p>
              <a
                href={link.href}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex items-center justify-center rounded-lg border border-blue-200 px-3 py-2 text-sm font-semibold text-blue-700 transition hover:border-blue-500 hover:bg-blue-50 dark:border-blue-900 dark:text-blue-300 dark:hover:bg-blue-950"
              >
                {link.action} ↗
              </a>
            </article>
          ))}
        </div>
      </section>

      {/* Safety reminder */}
      <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-900 dark:bg-amber-950/40">
        <h2 className="text-base font-semibold text-amber-950 dark:text-amber-100">Account Safety</h2>
        <p className="mt-2 text-sm leading-6 text-amber-900 dark:text-amber-100">
          Sign in only with your own valid subscription on the official platform. Shared, cracked, or hacked streaming credentials expose your device and data to serious security risks and are not supported here.
        </p>
      </section>
    </div>
  );
}
