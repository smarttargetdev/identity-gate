import React from 'react';

interface BrandHeaderLogoProps {
  platformName: string;
}

export const BrandHeaderLogo: React.FC<BrandHeaderLogoProps> = ({ platformName }) => (
  <div className="flex items-center gap-2.5 min-w-0">
    <img
      src="https://assets.smarttarget.com.br/company/target.svg"
      alt={platformName}
      className="w-[34px] h-[34px] object-contain shrink-0"
    />
    <span className="font-display text-sm font-semibold tracking-tight text-white leading-tight whitespace-nowrap truncate">
      {platformName}
    </span>
  </div>
);
