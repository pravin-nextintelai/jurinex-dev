import Link from "next/link";
import BrandLogo from "@/components/BrandLogo";

/**
 * Solid white bar from the React app's Navbar (its "solidBar" state), without
 * the mega menus. Links back into the React app are plain <a href> because
 * that is a different application; only "Bare Acts" stays inside Next.js.
 */
const REACT_LINKS = [
  { label: "Products", href: "/products" },
  { label: "Pricing", href: "/#pricing" },
  { label: "Blog", href: "/blogs" },
];

export default function Header() {
  return (
    <header className="sticky inset-x-0 top-0 z-50 border-b border-teal-200 bg-white/95 font-body shadow-[0_1px_12px_rgba(8,163,147,0.12)] backdrop-blur">
      <nav className="mx-auto flex h-20 w-full max-w-7xl items-center gap-6 px-5 sm:px-8" aria-label="Primary">
        <a href="/" className="flex shrink-0 items-center transition-opacity hover:opacity-85" aria-label="Jurinex.ai home">
          <BrandLogo />
        </a>

        <ul className="mx-auto hidden h-full items-center gap-0.5 pl-2 md:flex lg:gap-4 lg:pl-4">
          <li className="flex h-full items-center">
            <Link
              href="/"
              className="flex items-center whitespace-nowrap rounded-lg px-2 py-2 text-[15px] font-semibold text-teal-700 transition-colors lg:px-3"
            >
              Bare Acts
            </Link>
          </li>
          {REACT_LINKS.map((link) => (
            <li key={link.href} className="flex h-full items-center">
              <a
                href={link.href}
                className="flex items-center whitespace-nowrap rounded-lg px-2 py-2 text-[15px] font-semibold text-nx-ink transition-colors hover:text-teal-700 lg:px-3"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="ml-auto flex items-center gap-3">
          <a
            href="/login"
            aria-label="Log in to your account"
            className="whitespace-nowrap rounded-lg border border-nx-ink/30 px-5 py-2 text-sm font-semibold text-black transition-colors hover:border-teal-600 hover:text-teal-700"
          >
            Login
          </a>
          <a
            href="/register"
            aria-label="Start your free trial"
            className="hidden whitespace-nowrap rounded-lg bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-teal-500/25 transition-colors hover:bg-teal-700 sm:inline-block"
          >
            Start Free Trial
          </a>
        </div>
      </nav>
    </header>
  );
}
