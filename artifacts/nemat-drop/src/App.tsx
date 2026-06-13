import LeftShowcasePanel from "@/components/LeftShowcasePanel";
import RightContentPanel from "@/components/RightContentPanel";
import CheckoutPage from "@/pages/checkout";
import SuccessPage from "@/pages/success";
import AdminPage from "@/pages/admin";
import AccountPage from "@/pages/account";

function HomePage() {
  return (
    <div className="min-h-screen md:h-screen md:overflow-hidden flex flex-col bg-black">
      <header className="w-full flex items-center justify-between px-4 md:px-8 py-[6px] border-b border-white/[0.06] shrink-0 bg-black relative z-20">
        <div className="w-12 md:w-32" />
        <div className="flex items-center min-w-0">
          <img
            src="/logo.png"
            alt="Tommy Top Decker"
            className="h-9 md:h-14 w-auto object-contain"
          />
        </div>
        <div className="w-12 md:w-32 flex justify-end">
          <a
            href="/account"
            className="px-2 py-1 md:px-4 md:py-2 bg-white text-black text-[10px] md:text-[11px] font-bold uppercase tracking-[0.15em] rounded hover:bg-gray-200 transition-colors"
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

  return <HomePage />;
}
