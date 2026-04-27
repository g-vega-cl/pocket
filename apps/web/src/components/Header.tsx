import { Link } from '@tanstack/react-router'
import ThemeToggle from './ThemeToggle'

export default function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-[var(--line)] bg-[var(--header-bg)] px-4 backdrop-blur-lg">
      <nav className="page-wrap flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 sm:py-2">
        <h2 className="m-0 flex-shrink-0 text-sm font-semibold tracking-tight">
          <Link
            to="/"
            className="inline-flex items-center gap-2 rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-2.5 py-1 text-xs text-[var(--sea-ink)] no-underline shadow-[0_4px_12px_rgba(30,90,72,0.06)] sm:px-3 sm:py-1.5"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-[linear-gradient(90deg,#56c6be,#7ed3bf)]" />
            Pocket
          </Link>
        </h2>

        <div className="ml-auto flex items-center gap-1.5 sm:ml-0 sm:gap-2">
          <ThemeToggle />
        </div>

        <div className="order-3 flex w-full flex-wrap items-center gap-x-4 gap-y-1 pb-0.5 text-xs font-semibold sm:order-2 sm:w-auto sm:flex-nowrap sm:pb-0">
          <Link
            to="/"
            className="nav-link"
            activeProps={{ className: 'nav-link is-active' }}
          >
            Home
          </Link>
        </div>
      </nav>
    </header>
  )
}
