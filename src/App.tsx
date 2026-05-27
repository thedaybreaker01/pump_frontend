import { useState } from 'react';
import SidebarLayout, { type NavKey } from './layout/SidebarLayout';
import PositionsPage from './pages/PositionsPage';
import SellHistoryPage from './pages/SellHistoryPage';
import TokensPage from './pages/TokensPage';
import WatchlistPage from './pages/WatchlistPage';
import ATokensPage from './pages/ATokenPage';
import LTokensPage from './pages/LTokenPage';

export default function App() {
  const [active, setActive] = useState<NavKey>('tokens');
  return (
    <SidebarLayout active={active} onNavigate={setActive}>
      {active === 'tokens' ? <TokensPage /> : null}
      {active === 'watchlist' ? <WatchlistPage /> : null}
      {active === 'positions' ? <PositionsPage /> : null}
      {active === 'sell_history' ? <SellHistoryPage /> : null}
      {active === 'a_tokens' ? <ATokensPage /> : null}
      {active === 'l_tokens' ? <LTokensPage /> : null}
    </SidebarLayout>
  );
}
