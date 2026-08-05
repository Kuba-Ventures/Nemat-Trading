interface ComingSoonProps {
  /** Page title, e.g. "Past Drops". */
  title: string;
  /** One-line description of what will live here. */
  blurb: string;
}

/**
 * Placeholder shell for routes that are linked in the header but not built yet
 * (/past-drops, /how-it-works). Reuses the sub-page header lockup so it reads as
 * an unfinished section of the site rather than a broken link or a 404.
 */
export default function ComingSoon({ title, blurb }: ComingSoonProps) {
  return (
    <main className="min-h-screen bg-black text-white px-6 py-10 flex flex-col">
      {/* Header — matches the other sub-pages */}
      <div className="mx-auto w-full max-w-2xl flex items-center justify-between mb-10">
        <a href="/" className="flex items-center gap-2 text-xs text-gray-500 hover:text-white transition-colors">
          <span>←</span><span>Back</span>
        </a>
        <div className="flex items-center gap-3">
          <img src="/logo-mark.svg" alt="Tommy Top Decker" className="w-10 h-auto block" />
          <div className="flex flex-col">
            <span className="text-[13px] font-bold tracking-[0.16em] uppercase text-[#f4f0e8] leading-none">TommyTopDecker</span>
            <span className="text-[8px] font-bold tracking-[0.3em] uppercase text-[#b03a3a] leading-none mt-[3px]">Trading Cards</span>
          </div>
        </div>
        <div className="w-12" />
      </div>

      <section className="mx-auto w-full max-w-2xl flex-1 flex flex-col items-center justify-center text-center pb-16">
        <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-cyan-400">Coming Soon</span>
        <h1 className="mt-4 text-3xl md:text-4xl font-bold">{title}</h1>
        <p className="mt-4 max-w-md text-sm leading-relaxed text-gray-400">{blurb}</p>
        <a
          href="/"
          className="mt-8 px-6 py-3 bg-cyan-400 text-black text-xs font-bold uppercase tracking-[0.25em] rounded hover:bg-cyan-300 transition-colors"
        >
          Back to the Drop
        </a>
      </section>
    </main>
  );
}
