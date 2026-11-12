import Link from "next/link";
import { headers } from "next/headers";
import { requireSession } from "@/lib/security/auth";
import { signOut } from "@/app/(app)/actions";

const nav = [
  ["Dashboard", "/dashboard", "▦"],
  ["Upload & Analyze", "/upload", "⇧"],
  ["Quotations", "/rfqs", "▤"],
  ["Customers", "/customers", "◎"],
  ["Manufacturing Masters", "/masters", "▧"],
  ["Master Rates", "/rates", "₹"],
  ["Settings", "/settings", "⚙"]
] as const;

export async function AppShell({ children }: { children: React.ReactNode }) {
  const { user, membership } = await requireSession();
  const currentPath = (await headers()).get("x-pathname") ?? "";
  const tenant = membership.tenants as unknown as { name?: string } | null;
  const name = user.user_metadata?.full_name ?? user.email?.split("@")[0] ?? "User";
  const platformAdmins = (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const isPlatformAdmin = Boolean(user.email && platformAdmins.includes(user.email.toLowerCase()));

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">FQ</div>
          <div className="brand-copy">
            <strong>ForgeQuote</strong>
            <span>Drawing-to-quotation</span>
          </div>
        </div>
        <nav aria-label="Primary navigation">
          <div className="nav-group">
            <div className="nav-title">Workspace</div>
            {nav.map(([label, href, icon]) => {
              const active = currentPath === href || currentPath.startsWith(`${href}/`);
              return (
                <Link key={href} className={`nav-link${active ? " active" : ""}`} href={href}>
                  <span className="nav-icon" aria-hidden>{icon}</span>
                  <span className="nav-text">{label}</span>
                </Link>
              );
            })}
          </div>
          {isPlatformAdmin && (
            <div className="nav-group">
              <div className="nav-title">Platform</div>
              <Link className={`nav-link${currentPath.startsWith("/platform-admin") ? " active" : ""}`} href="/platform-admin">
                <span className="nav-icon">◆</span>
                <span className="nav-text">Platform Admin</span>
              </Link>
            </div>
          )}
        </nav>
      </aside>
      <section className="main">
        <header className="topbar">
          <div className="topbar-title">
            <strong>{tenant?.name ?? "Company workspace"}</strong>
            <span>Secure drawing analysis and quotation</span>
          </div>
          <div className="top-actions">
            <Link className="btn btn-primary btn-sm" href="/upload">＋ Upload drawing</Link>
            <div className="user-chip">
              <div className="avatar">{name.slice(0, 2).toUpperCase()}</div>
              <div><strong>{name}</strong><div className="help">{membership.role}</div></div>
            </div>
            <form action={signOut}><button className="btn btn-sm" type="submit">Sign out</button></form>
          </div>
        </header>
        <div className="content">{children}</div>
      </section>
    </div>
  );
}
