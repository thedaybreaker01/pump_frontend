import type { ReactNode } from 'react'

export type NavKey = 'tokens' | 'watchlist' | 'positions' | 'sell_history'

export default function SidebarLayout(props: {
  active: NavKey
  onNavigate: (to: NavKey) => void
  children: ReactNode
}) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandDot" />
          <div>
            <div className="brandTitle">Pump Bot</div>
            <div className="brandSub">Dashboard</div>
          </div>
        </div>

        <nav className="nav">
          <button
            type="button"
            className={`navItem ${props.active === 'tokens' ? 'active' : ''}`}
            onClick={() => props.onNavigate('tokens')}
          >
            Tokens
          </button>
          <button
            type="button"
            className={`navItem ${props.active === 'watchlist' ? 'active' : ''}`}
            onClick={() => props.onNavigate('watchlist')}
          >
            Watch list
          </button>
          <button
            type="button"
            className={`navItem ${props.active === 'positions' ? 'active' : ''}`}
            onClick={() => props.onNavigate('positions')}
          >
            Positions
          </button>
          <button
            type="button"
            className={`navItem ${props.active === 'sell_history' ? 'active' : ''}`}
            onClick={() => props.onNavigate('sell_history')}
          >
            Sell history
          </button>
        </nav>
      </aside>

      <main className="content">
        {props.children}
      </main>
    </div>
  )
}

