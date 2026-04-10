import Image from "next/image";
import Link from "next/link";

export default function Page() {
  return (
    <>
      {/* TopNavBar */}
      <nav className="fixed top-0 w-full z-50 bg-white/70 dark:bg-black/70 backdrop-blur-xl">
        <div className="flex justify-between items-center px-12 py-6 max-w-screen-2xl mx-auto">
          <div className="text-xl font-bold tracking-tighter text-black dark:text-white uppercase">GlitchDraft</div>
          <div className="hidden md:flex gap-12 items-center">
            <Link className="font-body font-bold tracking-[-0.01em] uppercase text-xs text-black dark:text-white border-b-2 border-black dark:border-white pb-1" href="#">Home</Link>
            <Link className="font-body font-[450] tracking-[-0.01em] uppercase text-xs text-neutral-500 dark:text-neutral-400 hover:text-black dark:hover:text-white transition-colors duration-300" href="#">Features</Link>
            <Link className="font-body font-[450] tracking-[-0.01em] uppercase text-xs text-neutral-500 dark:text-neutral-400 hover:text-black dark:hover:text-white transition-colors duration-300" href="#">Dashboard</Link>
            <Link className="font-body font-[450] tracking-[-0.01em] uppercase text-xs text-neutral-500 dark:text-neutral-400 hover:text-black dark:hover:text-white transition-colors duration-300" href="#">Docs</Link>
          </div>
          <button className="bg-primary text-on-primary-container px-6 py-2 rounded-full font-body font-[450] tracking-[-0.01em] uppercase text-xs hover:scale-95 duration-200 transition-all">Get Started</button>
        </div>
      </nav>
      <main>
        {/* Hero Section */}
        <section className="relative min-h-screen flex items-center pt-24 overflow-hidden">
          <div className="absolute inset-0 glitch-gradient z-0"></div>
          <div className="max-w-screen-2xl mx-auto px-12 z-10 w-full grid grid-cols-1 md:grid-cols-12 gap-12 items-center">
            <div className="md:col-span-8">
              <h1 className="text-[86px] leading-[0.95] font-[400] tracking-[-0.02em] text-white mb-8">
                Never lose a <br />
                <span className="font-bold">draft again.</span>
              </h1>
              <p className="text-[26px] font-[340] tracking-[-0.01em] text-white/90 max-w-2xl mb-12">
                Sync your chat drafts across threads and platforms with GlitchDraft.
              </p>
              <div className="flex gap-6 items-center">
                <button className="bg-surface-container-lowest text-primary px-10 py-5 rounded-full font-label font-[540] tracking-[0.05em] uppercase text-sm hover:scale-95 transition-transform dashed-focus">
                  Add to Chrome
                </button>
                <button className="flex items-center gap-3 text-white font-label font-[540] tracking-[0.05em] uppercase text-sm hover:opacity-70 transition-opacity">
                  <span className="material-symbols-outlined">play_circle</span>
                  Watch Demo
                </button>
              </div>
            </div>
            <div className="md:col-span-4 relative">
              <div className="glass-panel p-8 rounded-xl shadow-2xl relative overflow-hidden group">
                <div className="absolute top-4 right-4 h-3 w-3 rounded-full bg-secondary-container animate-pulse"></div>
                <div className="flex items-center gap-3 mb-6">
                  <div className="h-10 w-10 bg-primary rounded-full flex items-center justify-center">
                    <span className="material-symbols-outlined text-white text-xl">sync</span>
                  </div>
                  <div className="font-label font-[540] tracking-[0.05em] uppercase text-[10px] text-on-surface-variant">Real-time Draft Sync</div>
                </div>
                <div className="space-y-4">
                  <div className="h-4 bg-surface-container-high w-3/4 rounded-sm"></div>
                  <div className="h-4 bg-surface-container-high w-full rounded-sm"></div>
                  <div className="h-20 bg-surface-container rounded-sm flex items-end p-3">
                    <div className="h-2 w-1/2 bg-secondary-container rounded-sm"></div>
                  </div>
                </div>
              </div>
              {/* Overlapping decorative element */}
              <div className="absolute -bottom-8 -left-8 h-32 w-32 bg-tertiary-container rounded-full blur-3xl opacity-50"></div>
            </div>
          </div>
        </section>
        {/* Storage Modes Section */}
        <section className="bg-surface py-32">
          <div className="max-w-screen-2xl mx-auto px-12">
            <div className="mb-24">
              <h2 className="text-5xl font-[700] tracking-[-0.02em] mb-6">Built for Persistence.</h2>
              <p className="font-body font-[320] text-xl text-on-surface-variant max-w-xl">Choose your architectural backbone. Whether it's rapid real-time syncing or heavy-duty relational persistence.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-20">
              {/* Firebase Mode */}
              <div className="group">
                <div className="aspect-video bg-surface-container-low rounded-xl mb-12 overflow-hidden flex items-center justify-center relative">
                  <Image fill alt="minimalist geometric visualization of firebase cloud storage with glowing connections and neon green accents on dark background" className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-700" src="https://lh3.googleusercontent.com/aida-public/AB6AXuAEn7p9t7LBKWEWLs9Iy1TPk--jJQcHZ_4CZWD_BBczZhNs8x4osgRWugXRh9ZjB2TYg-PhEehBrXxHKx9CqnfH8Ivl7WJe_XGve5lUqT1OFUIXmytoD88OEB7WsJVo0AlS7p-8P3s9gPIsktKC0GRamRTTFciZ939qL3E2OzhlQD-sC7wuMbAYcwBGxv8V84M64bMgoAnzGWdU9OlAtZ1lmz1d-w942WtbiIkLydWs0DWPhHTXrRoywkv4C6BAKp-9Gap1BqtnS14" referrerPolicy="no-referrer" />
                  <div className="absolute inset-0 bg-primary/5 group-hover:bg-transparent transition-colors"></div>
                </div>
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-3xl font-[540] tracking-[-0.01em] mb-4">Firebase Real-time</h3>
                    <p className="font-body font-[320] text-lg text-on-surface-variant max-w-md mb-8">
                      Instant synchronization across devices. Perfect for users who jump between mobile and desktop mid-sentence.
                    </p>
                    <button className="bg-surface-container-highest text-primary px-8 py-3 rounded-full font-label font-[540] tracking-[0.05em] uppercase text-xs dashed-focus">
                      Explore Cloud Mode
                    </button>
                  </div>
                  <span className="font-label text-4xl text-outline-variant font-light">01</span>
                </div>
              </div>
              {/* Neon/Postgres Mode */}
              <div className="group">
                <div className="aspect-video bg-surface-container-low rounded-xl mb-12 overflow-hidden flex items-center justify-center relative">
                  <Image fill alt="high-end editorial visualization of neon postgres database with deep purple and electric magenta light streaks in a dark void" className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-700" src="https://lh3.googleusercontent.com/aida-public/AB6AXuBEa-06HauJ02JNpcldCWQJxSxoY_hF5HyASC_zeg5sursY1YAH3KRxr-nCdiUitt40s8_du3CZp-A0QOnmVkZd97e7SAfoGN6-LIV1l5oVG_Qn-XcZyWKTSIXKcrV7BobMSZ0c7Cr74MjalzKzBLqDiFlH4C0JERXhsykaKP3a-TCpNXphZFS4hnEFcgr5PNbW5aa9IM6q96LZV0VSmAbWHmb38iFIzasz24sEeFlp6wGSeAgCADdlxiBQuO2zUJge2iMlqAfJ9kI" referrerPolicy="no-referrer" />
                  <div className="absolute inset-0 bg-primary/5 group-hover:bg-transparent transition-colors"></div>
                </div>
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-3xl font-[540] tracking-[-0.01em] mb-4">Neon Relational</h3>
                    <p className="font-body font-[320] text-lg text-on-surface-variant max-w-md mb-8">
                      Structured, high-integrity storage. Ideal for professional writers managing multi-platform content pipelines.
                    </p>
                    <button className="bg-surface-container-highest text-primary px-8 py-3 rounded-full font-label font-[540] tracking-[0.05em] uppercase text-xs dashed-focus">
                      Setup SQL Storage
                    </button>
                  </div>
                  <span className="font-label text-4xl text-outline-variant font-light">02</span>
                </div>
              </div>
            </div>
          </div>
        </section>
        {/* Asymmetric Feature Grid */}
        <section className="bg-surface-container-low py-32 overflow-hidden">
          <div className="max-w-screen-2xl mx-auto px-12 grid grid-cols-12 gap-8">
            <div className="col-span-12 md:col-span-5 flex flex-col justify-center">
              <span className="font-label font-[540] tracking-[0.05em] uppercase text-xs text-tertiary mb-6">Extension Features</span>
              <h2 className="text-6xl font-bold tracking-tight mb-8">Precision sync, zero friction.</h2>
              <div className="space-y-12">
                <div className="flex gap-6">
                  <div className="flex-shrink-0 mt-1">
                    <span className="material-symbols-outlined text-primary">auto_fix_high</span>
                  </div>
                  <div>
                    <div className="font-label font-[540] tracking-[0.05em] uppercase text-sm mb-2">Auto-save Pulse</div>
                    <p className="font-body font-[320] text-on-surface-variant">The interface breathes with your typing. Every stroke is cached and verified.</p>
                  </div>
                </div>
                <div className="flex gap-6">
                  <div className="flex-shrink-0 mt-1">
                    <span className="material-symbols-outlined text-primary">history_edu</span>
                  </div>
                  <div>
                    <div className="font-label font-[540] tracking-[0.05em] uppercase text-sm mb-2">Glitch History</div>
                    <p className="font-body font-[320] text-on-surface-variant">Recover past versions of your drafts with a visual timeline of your creative process.</p>
                  </div>
                </div>
              </div>
            </div>
            <div className="col-span-12 md:col-span-7 flex justify-end">
              <div className="relative w-full max-w-2xl">
                <div className="bg-surface-container-lowest p-4 rounded-xl shadow-sm -rotate-2 relative z-20 aspect-[4/3]">
                  <Image fill alt="clean minimalist user interface showing a list of saved chat drafts with colorful status indicators and dark mode aesthetics" className="rounded-lg object-cover" src="https://lh3.googleusercontent.com/aida-public/AB6AXuDjvRALe53Qct6ESYDpiZP2ItVVwPTdgMWKJqUKHEMYRtAQXuJo_kZpHLCRQrEDQwWR0LoinuiAd8-ZsHLHiZtKSxC1ZjRXNf2Osm4XZ1MqbFHWdKnfaQGSa0x_S54_5pRCz4-31-DznSrpGKkIxYhLM9eCyNmVZigJKfRc2-uMtVjkfRwH_0TuAy92H1z7MphqmiPihB8BM2gpuk-gGI9js0RxL3S8VQs62-b7liCSey5LO3O6ApSwYiamsyRMSGmjfC4npUM1KM4" referrerPolicy="no-referrer" />
                </div>
                <div className="absolute top-20 -right-20 w-full h-full bg-secondary-container rounded-full opacity-10 blur-3xl -z-10"></div>
                {/* Floating metadata pill */}
                <div className="absolute -bottom-10 right-20 bg-primary text-white px-6 py-4 rounded-full font-label text-[10px] tracking-[0.1em] uppercase z-30 shadow-2xl">
                  Status: Syncing 102 Drafts
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
      {/* Footer */}
      <footer className="w-full py-20 bg-neutral-50 dark:bg-neutral-950">
        <div className="grid grid-cols-4 gap-12 px-12 max-w-screen-2xl mx-auto">
          <div className="col-span-4 md:col-span-1">
            <div className="text-lg font-black tracking-tighter uppercase mb-6">GlitchDraft</div>
            <p className="font-body font-[320] text-sm tracking-[-0.01em] text-neutral-500 dark:text-neutral-400">
              © 2024 GlitchDraft. The Kinetic Gallery.
            </p>
          </div>
          <div>
            <div className="font-bold text-black dark:text-white mb-6 uppercase text-xs tracking-widest">Product</div>
            <ul className="space-y-4">
              <li><Link className="font-body font-[320] text-sm text-neutral-500 dark:text-neutral-400 hover:underline decoration-black dark:decoration-white underline-offset-4 transition-all" href="#">Features</Link></li>
              <li><Link className="font-body font-[320] text-sm text-neutral-500 dark:text-neutral-400 hover:underline decoration-black dark:decoration-white underline-offset-4 transition-all" href="#">Security</Link></li>
              <li><Link className="font-body font-[320] text-sm text-neutral-500 dark:text-neutral-400 hover:underline decoration-black dark:decoration-white underline-offset-4 transition-all" href="#">Pricing</Link></li>
            </ul>
          </div>
          <div>
            <div className="font-bold text-black dark:text-white mb-6 uppercase text-xs tracking-widest">Resources</div>
            <ul className="space-y-4">
              <li><Link className="font-body font-[320] text-sm text-neutral-500 dark:text-neutral-400 hover:underline decoration-black dark:decoration-white underline-offset-4 transition-all" href="#">Documentation</Link></li>
              <li><Link className="font-body font-[320] text-sm text-neutral-500 dark:text-neutral-400 hover:underline decoration-black dark:decoration-white underline-offset-4 transition-all" href="#">API Reference</Link></li>
              <li><Link className="font-body font-[320] text-sm text-neutral-500 dark:text-neutral-400 hover:underline decoration-black dark:decoration-white underline-offset-4 transition-all" href="#">Support</Link></li>
            </ul>
          </div>
          <div>
            <div className="font-bold text-black dark:text-white mb-6 uppercase text-xs tracking-widest">Company</div>
            <ul className="space-y-4">
              <li><Link className="font-body font-[320] text-sm text-neutral-500 dark:text-neutral-400 hover:underline decoration-black dark:decoration-white underline-offset-4 transition-all" href="#">About</Link></li>
              <li><Link className="font-body font-[320] text-sm text-neutral-500 dark:text-neutral-400 hover:underline decoration-black dark:decoration-white underline-offset-4 transition-all" href="#">Legal</Link></li>
              <li><Link className="font-body font-[320] text-sm text-neutral-500 dark:text-neutral-400 hover:underline decoration-black dark:decoration-white underline-offset-4 transition-all" href="#">Privacy Policy</Link></li>
            </ul>
          </div>
        </div>
      </footer>
    </>
  );
}
