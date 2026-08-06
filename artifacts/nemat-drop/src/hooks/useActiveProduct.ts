import { useEffect, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL ?? "";
const STORAGE_KEY = "ttd_active_product";

export type DbProduct = {
  id: number;
  title: string;
  shortTitle: string;
  subtitle: string;
  price: number;
  imageUrl: string;
  stock: number;
  active: boolean;
  expiresAt: string | null;
  scryfallId: string | null;
  discountPercent: number;
  tcgplayerUrl: string | null;
  tcgMarketPriceCents: number | null;
  specs: string;             // JSON array of {label, value}
  contents: string;          // JSON array of strings
  pullProbabilities: string; // JSON array
  possiblePulls: string;     // JSON array
  intelReport: string;       // plain text, paragraphs separated by \n\n
};

function readStorage(): DbProduct | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStorage(p: DbProduct) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {}
}

// Seed from localStorage so first render has the correct product immediately
let cached: DbProduct | null = readStorage();
const listeners: Array<(p: DbProduct | null) => void> = [];

function notify(p: DbProduct | null) {
  cached = p;
  if (p) writeStorage(p);
  listeners.forEach((fn) => fn(p));
}

async function fetchActive() {
  if (!API_URL) return;
  try {
    const res = await fetch(`${API_URL}/api/products`);
    const data = await res.json();
    notify(Array.isArray(data) && data[0] ? data[0] : null);
  } catch {
    // silently keep whatever is in cache
  }
}

// Kick off the fetch once at module load
fetchActive();

export function useActiveProduct() {
  const [product, setProduct] = useState<DbProduct | null>(cached);

  useEffect(() => {
    listeners.push(setProduct);
    if (cached) setProduct(cached);
    return () => {
      const i = listeners.indexOf(setProduct);
      if (i !== -1) listeners.splice(i, 1);
    };
  }, []);

  return product;
}
