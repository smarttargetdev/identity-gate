import React, { useEffect, useRef, useState } from 'react';
import { Info } from 'lucide-react';

interface InfoTooltipProps {
  text: string;
  align?: 'left' | 'right';
}

export const InfoTooltip: React.FC<InfoTooltipProps> = ({ text, align = 'left' }) => {
  const [pinned, setPinned] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!pinned) return;
    const handleOutside = (ev: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(ev.target as Node)) {
        setPinned(false);
      }
    };
    const handleEsc = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setPinned(false);
    };
    document.addEventListener('mousedown', handleOutside);
    window.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('keydown', handleEsc);
    };
  }, [pinned]);

  return (
    <span ref={containerRef} className="relative inline-flex items-center group align-middle">
      <button
        type="button"
        onClick={(ev) => {
          ev.stopPropagation();
          setPinned((prev) => !prev);
        }}
        aria-label={text}
        aria-expanded={pinned}
        title={text}
        className={`p-0.5 rounded transition-colors focus:outline-none ${
          pinned
            ? 'text-[#F6821F]'
            : 'text-slate-500 hover:text-[#F6821F] focus:text-[#F6821F]'
        }`}
      >
        <Info className="w-3.5 h-3.5 shrink-0" />
      </button>
      <span
        role="tooltip"
        className={`absolute top-full mt-1.5 z-40 w-64 sm:w-80 bg-[#090D16] border border-slate-700/90 text-[11px] font-sans font-normal text-slate-200 rounded-md px-3 py-2 shadow-xl leading-relaxed whitespace-normal transition-opacity duration-150 ${
          align === 'right' ? 'right-0' : 'left-0'
        } ${
          pinned
            ? 'opacity-100 pointer-events-auto'
            : 'opacity-0 pointer-events-none group-hover:opacity-100 group-focus-within:opacity-100'
        }`}
      >
        {text}
      </span>
    </span>
  );
};
