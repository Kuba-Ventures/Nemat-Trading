import ProductHeroSection from "./ProductHeroSection";
import ProductSpecifications from "./ProductSpecifications";
import PullProbabilityChart from "./PullProbabilityChart";
import PossiblePullsGrid from "./PossiblePullsGrid";
import EmailSignup from "./EmailSignup";
import PurchaseBar from "./PurchaseBar";
import IntelReport from "./IntelReport";

export default function RightContentPanel() {
  return (
    <main className="flex-1 min-w-0 bg-[#0d0d0d] overflow-y-auto h-full">
      <div className="max-w-2xl mx-auto px-6 md:px-10 pt-10 pb-0">
        <ProductHeroSection />
        <ProductSpecifications />
        <IntelReport />
        <PullProbabilityChart />
        <PossiblePullsGrid />
        <EmailSignup />

        {/* Footer spacing for sticky bar */}
        <div className="h-24" />
      </div>

      {/* Fixed on mobile, sticky on desktop */}
      <div className="fixed md:sticky bottom-0 inset-x-0 md:inset-x-auto z-50 md:z-10 md:max-w-2xl md:mx-auto px-6 md:px-10">
        <PurchaseBar />
      </div>
    </main>
  );
}
