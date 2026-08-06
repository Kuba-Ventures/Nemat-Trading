
interface QuantitySelectorProps {
  quantity: number;
  onChange: (qty: number) => void;
  min?: number;
  max?: number;
}

export default function QuantitySelector({ quantity, onChange, min = 1, max = 99 }: QuantitySelectorProps) {
  const dec = () => onChange(Math.max(min, quantity - 1));
  const inc = () => onChange(Math.min(max, quantity + 1));

  return (
    <div className="flex items-center gap-0 border border-white/10 rounded">
      <button
        onClick={dec}
        className="w-11 h-11 lg:w-9 lg:h-9 flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/5 transition-colors rounded-l text-xl lg:text-lg select-none"
        aria-label="Decrease quantity"
      >
        −
      </button>
      <span className="w-12 lg:w-10 text-center text-base lg:text-sm font-medium text-white tabular-nums">
        {quantity}
      </span>
      <button
        onClick={inc}
        className="w-11 h-11 lg:w-9 lg:h-9 flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/5 transition-colors rounded-r text-xl lg:text-lg select-none"
        aria-label="Increase quantity"
      >
        +
      </button>
    </div>
  );
}
