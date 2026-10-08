'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { ROLE_LABELS, type Me, type Permission } from '@sda-shs/shared';
import { api } from '@/lib/api';
import { MeContext } from '@/lib/me';
import { Loading } from '@/components/ui';

const NAV: { href: string; label: string; permission?: Permission }[] = [
  { href: '/', label: 'Dashboard' },
  { href: '/announcements', label: 'Announcements', permission: 'announcements:publish' },
  { href: '/assignments', label: 'Assignments', permission: 'assignments:manage' },
  { href: '/results', label: 'Results', permission: 'results:enter' },
  { href: '/events', label: 'Calendar', permission: 'events:manage' },
  { href: '/timetable', label: 'Timetable', permission: 'timetable:manage' },
  { href: '/users', label: 'People', permission: 'users:read' },
  { href: '/academics', label: 'Classes & subjects', permission: 'academics:manage' },
  { href: '/houses', label: 'Houses', permission: 'houses:manage' },
  { href: '/school', label: 'School profile', permission: 'school:manage' },
  { href: '/audit', label: 'Audit log', permission: 'audit:read' },
];

export default function PortalLayout({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    api<Me>('/auth/me')
      .then((m) => (m.mustChangePassword ? router.replace('/change-password') : setMe(m)))
      .catch(() => undefined);
  }, [router]);

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
  }

  if (!me) {
    return (
      <main>
        <Loading />
      </main>
    );
  }

  const links = NAV.filter((n) => !n.permission || me.permissions.includes(n.permission));
  return (
    <MeContext.Provider value={me}>
      <div className="shell">
        <nav className="sidebar" aria-label="Main">
          <div className="brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="" />
            SDA SHS
          </div>
          <div className="brand-sub">Knowledge for Excellence</div>
          {links.map((l) => (
            <Link key={l.href} href={l.href} aria-current={pathname === l.href || (l.href !== '/' && pathname.startsWith(l.href)) ? 'page' : undefined}>
              {l.label}
            </Link>
          ))}
          <div className="spacer" />
          <div className="who">
            <div>{me.fullName}</div>
            <div style={{ opacity: 0.75, marginBottom: 8 }}>{ROLE_LABELS[me.role]}</div>
            <button onClick={signOut}>Sign out</button>
          </div>
        </nav>
        <main>{children}</main>
      </div>
    </MeContext.Provider>
  );
}
