import { useEffect, useState, useRef } from "react";
import { product as staticProduct } from "@/data/product";
import { useActiveProduct } from "@/hooks/useActiveProduct";

const API_URL = import.meta.env.VITE_API_URL ?? "";

function getTimeLeft(iso: string) {
  const diff = Math.max(0, new Date(iso).getTime() - Date.now());
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return { h, m, s, done: diff === 0 };
}
function pad(n: number) { return String(n).padStart(2, "0"); }

function DealCountdown({ expiresAt }: { expiresAt: string }) {
  const [time, setTime] = useState(() => getTimeLeft(expiresAt));
  useEffect(() => {
    const id = setInterval(() => setTime(getTimeLeft(expiresAt)), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  if (time.done) return (
    <div className="border border-white/[0.06] rounded bg-white/[0.02] px-6 py-4 flex w-fit mx-auto items-center justify-center mb-8">
      <span className="text-[10px] uppercase tracking-[0.25em] text-gray-500">Deal Expired</span>
    </div>
  );

  return (
    <div className="border border-white/[0.06] rounded bg-white/[0.02] px-6 py-4 flex w-fit mx-auto flex-col items-center justify-center mb-8">
      <span className="text-[10px] uppercase tracking-[0.25em] text-gray-500 mb-3">Deal Expires In</span>
      <div className="flex items-end gap-1">
        {[{ v: time.h, l: "HRS" }, { v: time.m, l: "MIN" }, { v: time.s, l: "SEC" }].map((unit, i) => (
          <div key={unit.l} className="flex items-end">
            <div className="flex flex-col items-center">
              <span className="text-2xl md:text-3xl font-mono font-bold text-cyan-400 tracking-widest tabular-nums">{pad(unit.v)}</span>
              <span className="text-[9px] uppercase tracking-[0.2em] text-gray-500 mt-0.5">{unit.l}</span>
            </div>
            {i < 2 && <span className="text-xl font-mono text-cyan-400/60 mx-0.5 mb-4">:</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ProductHeroSection() {
  const dbProduct = useActiveProduct();
  const [tcgPrice, setTcgPrice] = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const setupDoneRef = useRef(false); // ensure we only set up the poll once

  useEffect(() => {
    if (!dbProduct || !API_URL || setupDoneRef.current) return;
    setupDoneRef.current = true;

    const tcgplayerUrl = dbProduct.tcgplayerUrl;
    const tcgMarketPriceCents = dbProduct.tcgMarketPriceCents;

    async function fetchPrice() {
      // Primary: TCGPlayer live lowest listing
      if (tcgplayerUrl) {
        try {
          const r = await fetch(`${API_URL}/api/tcgplayer/price`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: tcgplayerUrl }),
          });
          const d = await r.json();
          if (d.lowestPrice) { setTcgPrice(parseFloat(d.lowestPrice)); return; }
        } catch {}
      }
      // Fallback: stored market price from last admin lookup
      if (tcgMarketPriceCents) {
        setTcgPrice(tcgMarketPriceCents / 100);
      }
    }

    fetchPrice();
    pollRef.current = setInterval(fetchPrice, 5 * 60 * 1000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [dbProduct]);

  const title = dbProduct?.title ?? staticProduct.title;
  const subtitle = dbProduct?.subtitle ?? staticProduct.subtitle;

  // Nemat price is FIXED — always the stored DB price, never fluctuates with TCG
  const nematPrice = dbProduct ? dbProduct.price / 100 : staticProduct.dropPrice;

  // TCG Best: live fetch first, fall back to static
  const tcgBest = tcgPrice ?? staticProduct.tcgBestPrice;

  // Savings calculated dynamically: how much cheaper are we vs current TCG market price
  const savings = tcgBest > nematPrice
    ? parseFloat(((1 - nematPrice / tcgBest) * 100).toFixed(2))
    : 0;

  return (
    <section className="pb-10">
      {/* The status pill doubles as a discreet admin entry (also reachable at /admin). */}
      <a href="/admin" aria-label="Admin" className="flex items-center mb-6 w-fit group">
        <span className="text-[10px] uppercase tracking-[0.3em] text-gray-500 group-hover:text-gray-300 transition-colors">{staticProduct.status}</span>
      </a>

      <h1 className="text-3xl md:text-4xl font-bold text-white leading-tight tracking-tight mb-1">{title}</h1>
      <p className="text-base text-gray-500 uppercase tracking-[0.2em] mb-8">{subtitle}</p>

      {dbProduct?.expiresAt && <DealCountdown expiresAt={dbProduct.expiresAt} />}

      <div className="grid grid-cols-3 gap-0 border border-white/[0.06] rounded overflow-hidden mb-2">
        <div className="flex flex-col items-center justify-center py-4 px-3 border-r border-white/[0.06]">
          {dbProduct?.tcgplayerUrl ? (
            <a href={dbProduct.tcgplayerUrl} target="_blank" rel="noopener noreferrer"
              className="text-[9px] uppercase tracking-[0.2em] text-gray-600 hover:text-cyan-600 transition-colors mb-1 underline underline-offset-2">
              TCG Low ↗
            </a>
          ) : (
            <span className="text-[9px] uppercase tracking-[0.2em] text-gray-600 mb-1">TCG Low</span>
          )}
          <span className="text-base text-gray-500 line-through">${tcgBest.toFixed(2)}</span>
          {tcgPrice && <span className="text-[8px] text-cyan-600 mt-0.5">Live</span>}
        </div>
        <div className="flex flex-col items-center justify-center py-4 px-3 border-r border-white/[0.06] bg-cyan-400/[0.05]">
          <span className="text-[9px] uppercase tracking-[0.2em] text-cyan-400 mb-1">Today's Drop</span>
          <span className="text-xl font-bold text-cyan-400">${nematPrice.toFixed(2)}</span>
        </div>
        <div className="flex flex-col items-center justify-center py-4 px-3">
          <span className="text-[9px] uppercase tracking-[0.2em] text-green-400 mb-1">You Save</span>
          <span className="text-base font-semibold text-green-400">{savings.toFixed(2)}%</span>
        </div>
      </div>
    </section>
  );
}
