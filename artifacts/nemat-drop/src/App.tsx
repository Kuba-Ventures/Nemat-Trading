import LeftShowcasePanel from "@/components/LeftShowcasePanel";
import RightContentPanel from "@/components/RightContentPanel";
import CheckoutPage from "@/pages/checkout";
import SuccessPage from "@/pages/success";
import AdminPage from "@/pages/admin";
import AccountPage from "@/pages/account";
import PrivacyPage from "@/pages/privacy";
import TermsPage from "@/pages/terms";
import SupportPage from "@/pages/support";
import PastDropsPage from "@/pages/past-drops";
import HowItWorksPage from "@/pages/how-it-works";

const NAV_LINKS = [
  { href: "/past-drops", label: "Past Drops" },
  { href: "/how-it-works", label: "How It Works" },
] as const;

function HomePage({ path }: { path: string }) {
  return (
    <div className="min-h-screen md:h-screen md:overflow-hidden flex flex-col bg-black">
      <header className="w-full flex items-center justify-between gap-6 h-[72px] px-[26px] border-b border-white/[0.06] shrink-0 bg-black relative z-20">
        <div className="flex items-center gap-3 min-w-0">
          <img
            src="/logo-mark.svg"
            alt="Tommy Top Decker"
            className="w-10 h-auto block"
          />
          <div className="flex flex-col">
            <span className="text-[13px] font-bold tracking-[0.16em] uppercase text-[#f4f0e8] leading-none">
              TommyTopDecker
            </span>
            <span className="text-[10px] font-bold tracking-[0.3em] uppercase text-[#c85a5a] leading-none mt-[3px]">
              Trading Cards
            </span>
          </div>
        </div>
        <div className="flex items-center gap-6 shrink-0">
          <nav className="hidden md:flex items-center gap-6" aria-label="Main">
            {NAV_LINKS.map(({ href, label }) => (
              <a
                key={href}
                href={href}
                aria-current={path === href ? "page" : undefined}
                className={`text-[10px] font-bold uppercase tracking-[0.16em] whitespace-nowrap pb-[5px] border-b transition-colors focus-visible:outline-1 focus-visible:outline-cyan-400 focus-visible:outline-offset-4 ${
                  path === href
                    ? "text-cyan-400 border-cyan-400"
                    : "text-gray-500 border-transparent hover:text-cyan-400 hover:border-cyan-400"
                }`}
              >
                {label}
              </a>
            ))}
          </nav>
          <a
            href="/account"
            className="px-2 py-1 md:px-4 md:py-2 bg-white text-black text-[10px] md:text-[11px] font-bold uppercase tracking-[0.15em] rounded hover:bg-gray-200 transition-colors whitespace-nowrap"
          >
            Account
          </a>
        </div>
      </header>
      <div className="flex flex-col md:flex-row md:flex-1 md:min-h-0">
        <LeftShowcasePanel />
        <RightContentPanel />
      </div>
    </div>
  );
}

export default function App() {
  const path = window.location.pathname;

  if (path === "/admin") return <AdminPage />;
  if (path === "/account") return <AccountPage />;
  if (path === "/checkout") return <CheckoutPage />;
  if (path === "/success") return <SuccessPage />;
  if (path === "/privacy") return <PrivacyPage />;
  if (path === "/terms") return <TermsPage />;
  if (path === "/support") return <SupportPage />;
  if (path === "/past-drops") return <PastDropsPage />;
  if (path === "/how-it-works") return <HowItWorksPage />;

  return <HomePage path={path} />;
}
