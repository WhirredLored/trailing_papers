import type { ReactNode } from 'react'

type ShellProps = {
  title: string
  subtitle?: string
  children?: ReactNode
}

/**
 * Page chrome. Mobile-first by default: the primary device is a phone held in a work
 * glove, so the desktop layout is the enhancement, not the baseline.
 */
export default function Shell({ title, subtitle, children }: ShellProps) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-5 py-10 sm:py-16">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {subtitle ? <p className="mt-2 text-base text-slate-600">{subtitle}</p> : null}
      </header>
      <main className="mt-8 flex-1">{children}</main>
    </div>
  )
}
