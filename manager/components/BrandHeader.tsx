/**
 * File: BrandHeader.tsx
 * Kind: TypeScript React
 * Container: /manager/components
 * Summary: Componente compartilhado de logotipo e título da plataforma para padronizar cabeçalhos.
 * Version: 1.0.0
 * Created: 2026-11-24
 * Modified: 2026-11-25
 * Developer: Osvandir Júnior
 */

import React from 'react';

interface BrandHeaderProps {
  platformName: string;
}

export const BrandHeader: React.FC<BrandHeaderProps> = ({ platformName }) => (
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
