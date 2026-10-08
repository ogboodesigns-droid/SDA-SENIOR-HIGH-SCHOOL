'use client';

import { createContext, useContext } from 'react';
import type { Me, Permission } from '@sda-shs/shared';

export const MeContext = createContext<Me | null>(null);

export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error('useMe must be used inside the portal layout');
  return me;
}

export function useCan(permission: Permission): boolean {
  return useMe().permissions.includes(permission);
}
