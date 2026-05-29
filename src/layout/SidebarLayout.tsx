import type { ReactNode } from 'react';
import BotTradingToggle from '../components/BotTradingToggle';
import SMarkModeToggle from '../components/SMarkModeToggle';
import WalletBalance from '../components/WalletBalance';

export type NavKey =
  | 'tokens'
  | 'watchlist'
  | 'positions'
  | 'sell_history'
  | 'a_tokens'
  | 'l_tokens';

export default function SidebarLayout(props: {
  active: NavKey;
  onNavigate: (to: NavKey) => void;
  children: ReactNode;
  /** Unseen A-tier promotions (cleared when opening A_Tokens). */
  aPromoteUnread?: number;
  lTokensEnabled?: boolean;
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
            Buy / Sell
          </button>
          <button
            type="button"
            className={`navItem ${props.active === 'a_tokens' ? 'active' : ''}`}
            onClick={() => props.onNavigate('a_tokens')}
          >
            A_Tokens
            {(props.aPromoteUnread ?? 0) > 0 ? (
              <span className="navBadge" aria-label={`${props.aPromoteUnread} new A-token(s)`}>
                {(props.aPromoteUnread ?? 0) > 99 ? '99+' : props.aPromoteUnread}
              </span>
            ) : null}
          </button>
          {props.lTokensEnabled ? (
            <button
              type="button"
              className={`navItem ${props.active === 'l_tokens' ? 'active' : ''}`}
              onClick={() => props.onNavigate('l_tokens')}
            >
              L_Tokens
            </button>
          ) : null}
        </nav>

        <BotTradingToggle />
        <WalletBalance />
        <SMarkModeToggle />
      </aside>

      <main className="content">{props.children}</main>
    </div>
  );
}
