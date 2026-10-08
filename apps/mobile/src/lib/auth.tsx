import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AuthResponse, Me, StudentSummary } from '@sda-shs/shared';
import { api, clearTokens, loadTokens, saveTokens, setSignedOutHandler } from './api';
import { registerForPush, unregisterPush } from './push';

interface AuthState {
  status: 'loading' | 'signedOut' | 'signedIn';
  me: Me | null;
  /** For parents with several children: the one currently being viewed. */
  child: StudentSummary | null;
  selectChild: (id: string) => void;
  signIn: (identifier: string, password: string) => Promise<Me>;
  signOut: () => Promise<void>;
  refreshMe: () => Promise<void>;
  setMe: (me: Me) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [me, setMe] = useState<Me | null>(null);
  const [childId, setChildId] = useState<string | null>(null);

  const reset = useCallback(() => {
    setMe(null);
    setChildId(null);
    setStatus('signedOut');
  }, []);

  useEffect(() => {
    setSignedOutHandler(() => {
      void clearTokens();
      reset();
    });
    (async () => {
      if (!(await loadTokens())) return reset();
      try {
        setMe(await api<Me>('/auth/me'));
        setStatus('signedIn');
      } catch {
        reset();
      }
    })();
  }, [reset]);

  useEffect(() => {
    if (status === 'signedIn' && me && !me.mustChangePassword) void registerForPush();
  }, [status, me]);

  const value = useMemo<AuthState>(
    () => ({
      status,
      me,
      child: me?.role === 'student' ? me.student : (me?.children.find((c) => c.id === childId) ?? me?.children[0] ?? null),
      selectChild: setChildId,
      async signIn(identifier, password) {
        const res = await api<AuthResponse>('/auth/login', { method: 'POST', body: { identifier, password, deviceName: 'Mobile app' }, auth: false });
        await saveTokens(res);
        setMe(res.user);
        setStatus('signedIn');
        return res.user;
      },
      async signOut() {
        await unregisterPush().catch(() => undefined);
        await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
        await clearTokens();
        reset();
      },
      async refreshMe() {
        setMe(await api<Me>('/auth/me'));
      },
      setMe,
    }),
    [status, me, childId, reset],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** Query-string suffix selecting a parent's chosen child; empty for everyone else. */
export function useStudentQuery(prefix: '?' | '&' = '?'): string {
  const { me, child } = useAuth();
  return me?.role === 'parent' && child ? `${prefix}studentId=${child.id}` : '';
}
