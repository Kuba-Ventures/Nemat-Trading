import { useEffect, useState } from "react";
import { useActiveProduct, type DbProduct } from "./useActiveProduct";

const API_URL = import.meta.env.VITE_API_URL ?? "";
const POLL_MS = 5 * 60 * 1000;

// If /api/products itself never answers there is no tcgplayerUrl to fetch a price
// for, so nothing would ever move us off "loading" and the strip would sit on
// skeletons for the whole visit. Give up after this and collapse instead.
const NO_PRODUCT_TIMEOUT_MS = 10_000;

/**
 * The TCGPlayer comparison price, fetched once and shared by every component that
 * shows it (hero strip, purchase bar), so the page can never quote two different
 * TCG numbers at the same time.
 *
 * "loading" and "unavailable" are separate states on purpose: there is no seed
 * price to fall back on any more. The old fallback printed a hardcoded $37.49,
 * which turned a CORS break or a Railway cold start into a confident wrong
 * number, and it was doing exactly that in production: the hero fetched the real
 * $41.94 while the purchase bar computed savings against $37.49.
 *
 * `live` is true only for a figure we just fetched. An admin's stored snapshot
 * still renders (it is a deliberate entry, not a mock value) but never wears the
 * "Live" tag.
 */
export type TcgPrice =
  | { status: "loading"; price: null; live: false }
  | { status: "ready"; price: number; live: boolean }
  | { status: "unavailable"; price: null; live: false };

const LOADING: TcgPrice = { status: "loading", price: null, live: false };
const UNAVAILABLE: TcgPrice = { status: "unavailable", price: null, live: false };

let current: TcgPrice = LOADING;
let watching: string | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let stallGuard: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<(p: TcgPrice) => void>();

function notify(next: TcgPrice) {
  current = next;
  listeners.forEach((fn) => fn(next));
}

function positivePrice(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : parseFloat(raw as string);
  return isNaN(n) || n <= 0 ? null : n;
}

async function refresh(product: DbProduct) {
  if (API_URL && product.tcgplayerUrl) {
    try {
      const res = await fetch(`${API_URL}/api/tcgplayer/price`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: product.tcgplayerUrl }),
      });
      const data = await res.json();
      const price = positivePrice(data?.lowestPrice);
      if (price !== null) {
        notify({ status: "ready", price, live: true });
        return;
      }
    } catch {
      // fall through to the snapshot below
    }
  }

  // A poll that fails after we already had a live number keeps showing it: that
  // figure is minutes old, not invented.
  if (current.status === "ready" && current.live) return;

  const snapshot = product.tcgMarketPriceCents ? product.tcgMarketPriceCents / 100 : null;
  notify(snapshot === null ? UNAVAILABLE : { status: "ready", price: snapshot, live: false });
}

/** Start (or restart, when the active product changes) the shared fetch + poll. */
function watch(product: DbProduct) {
  const key = product.tcgplayerUrl ?? `product:${product.id}`;
  if (watching === key) return;
  watching = key;
  if (stallGuard) { clearTimeout(stallGuard); stallGuard = null; }
  if (timer) clearInterval(timer);
  notify(LOADING);
  refresh(product);
  timer = setInterval(() => refresh(product), POLL_MS);
}

/** Collapse rather than spin forever when no active product ever arrives. */
function armStallGuard() {
  if (stallGuard || watching || current.status !== "loading") return;
  stallGuard = setTimeout(() => {
    stallGuard = null;
    if (!watching && current.status === "loading") notify(UNAVAILABLE);
  }, NO_PRODUCT_TIMEOUT_MS);
}

export function useTcgPrice(): TcgPrice {
  const product = useActiveProduct();
  const [price, setPrice] = useState<TcgPrice>(current);

  useEffect(() => {
    listeners.add(setPrice);
    setPrice(current);
    return () => {
      listeners.delete(setPrice);
    };
  }, []);

  useEffect(() => {
    if (!API_URL) {
      // Nothing to call: no point rendering a comparison at all.
      if (current.status === "loading") notify(UNAVAILABLE);
      return;
    }
    if (product) watch(product);
    else armStallGuard();
  }, [product]);

  return price;
}
