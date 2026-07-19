type NavLink = {
  href: string;
  label: string;
};

const navLinks: NavLink[] = [
  { href: "/", label: "Home" },
  { href: "/markets", label: "Markets" },
  { href: "/wallet", label: "Wallet" },
];

export function Navbar() {
  return (
    <nav className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <a className="text-lg font-semibold text-slate-950" href="/">
          Prism
        </a>
        <div className="flex items-center gap-4">
          {navLinks.map((link) => (
            <a className="text-sm font-medium text-slate-700 hover:text-sky-700" href={link.href} key={link.href}>
              {link.label}
            </a>
          ))}
        </div>
      </div>
    </nav>
  );
}
