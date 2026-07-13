export default function SuccessPage() {
  return (
    <main className="min-h-screen bg-black text-white px-6 py-10">
      {/* Header */}
      <div className="mx-auto max-w-2xl flex items-center justify-between mb-10">
        <a href="/" className="flex items-center gap-2 text-xs text-gray-500 hover:text-white transition-colors">
          <span>←</span><span>Back</span>
        </a>
        <div className="flex items-center">
          <img src="/logo-mark.svg" alt="Tommy Top Decker" className="h-24 md:h-[7.5rem] w-auto object-contain" />
        </div>
        <div className="w-12" />
      </div>

      <div className="flex items-center justify-center">
      <div className="text-center max-w-md">
        <div className="text-5xl mb-6">✓</div>
        <h1 className="text-3xl font-bold text-cyan-400 mb-3">Order Confirmed</h1>
        <p className="text-gray-400 mb-8">
          Your payment was successful. You'll receive a confirmation email shortly.
        </p>
        <a
          href="/"
          className="inline-block rounded bg-cyan-400 px-8 py-3 text-xs font-bold uppercase tracking-[0.25em] text-black hover:bg-cyan-300 transition-colors"
        >
          Back to Shop
        </a>
      </div>
      </div>
    </main>
  );
}
