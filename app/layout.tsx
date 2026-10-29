import type { Metadata, Viewport } from 'next'
import '@fontsource-variable/dm-sans'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import '@fontsource/jetbrains-mono/600.css'
import './globals.css'

export const metadata: Metadata = {
  title: 'Aurum / NP — Gold & Nepal Bullion Intelligence',
  description: 'A live quantitative terminal for XAU/USD, FENEGOSIDA gold benchmarks, Nepal import parity and geopolitical market scenarios.',
  applicationName: 'Aurum / NP',
  keywords: ['gold forecast', 'XAU/USD', 'Nepal gold rate', 'FENEGOSIDA', 'bullion', 'NPR parity'],
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0b0f12',
  colorScheme: 'dark',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className="h-full w-full overflow-hidden"><body className="h-screen w-screen overflow-hidden bg-slate-950 text-slate-100">{children}</body></html>
}
