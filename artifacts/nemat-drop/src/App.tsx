import LeftShowcasePanel from "@/components/LeftShowcasePanel";
import RightContentPanel from "@/components/RightContentPanel";
import CheckoutPage from "@/pages/checkout";
import SuccessPage from "@/pages/success";
import AdminPage from "@/pages/admin";
import AccountPage from "@/pages/account";
import PrivacyPage from "@/pages/privacy";
import TermsPage from "@/pages/terms";

function HomePage() {
  return (
    <div className="min-h-screen md:h-screen md:overflow-hidden flex flex-col bg-black">
      <header className="w-full flex items-center justify-between h-[72px] px-[26px] border-b border-white/[0.06] shrink-0 bg-black relative z-20">
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
            <span className="text-[8px] font-bold tracking-[0.3em] uppercase text-[#b03a3a] leading-none mt-[3px]">
              Trading Cards
            </span>
          </div>
        </div>
        <a
          href="/account"
          className="px-2 py-1 md:px-4 md:py-2 bg-white text-black text-[10px] md:text-[11px] font-bold uppercase tracking-[0.15em] rounded hover:bg-gray-200 transition-colors"
        >
          Account
        </a>
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

  return <HomePage />;
}
