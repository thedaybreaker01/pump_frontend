import { useCallback, useEffect, useState } from 'react';
import { fetchHealth } from './lib/api';
import ATokenPromoteAlerts from './components/ATokenPromoteAlerts';
import SidebarLayout, { type NavKey } from './layout/SidebarLayout';
import PositionsPage from './pages/PositionsPage';
import SellHistoryPage from './pages/SellHistoryPage';
import TokensPage from './pages/TokensPage';
import WatchlistPage from './pages/WatchlistPage';
import ATokensPage from './pages/ATokenPage';
import LTokensPage from './pages/LTokenPage';

export default function App() {
  const [active, setActive] = useState<NavKey>('tokens');
  const [aPromoteUnread, setAPromoteUnread] = useState(0);
  const [aPromoteFocusMint, setAPromoteFocusMint] = useState<string | null>(null);
  const [lTokensEnabled, setLTokensEnabled] = useState(false);

  useEffect(() => {
    void fetchHealth()
      .then((h) => setLTokensEnabled(h.l_tokens_enabled === true))
      .catch(() => setLTokensEnabled(false))
  }, [])

  const navigate = useCallback((to: NavKey) => {
    setActive(to);
    if (to === 'a_tokens') {
      setAPromoteUnread(0);
    }
  }, []);

  const onAPromote = useCallback(() => {
    setAPromoteUnread((n) => n + 1);
  }, []);

  const onOpenAFromAlert = useCallback((mint: string) => {
    setAPromoteFocusMint(mint);
    navigate('a_tokens');
  }, [navigate]);

  return (
    <>
      <ATokenPromoteAlerts onPromote={onAPromote} onOpenA={onOpenAFromAlert} />
      <SidebarLayout
        active={active}
        onNavigate={navigate}
        aPromoteUnread={aPromoteUnread}
        lTokensEnabled={lTokensEnabled}
      >
        {active === 'tokens' ? <TokensPage /> : null}
        {active === 'watchlist' ? <WatchlistPage /> : null}
        {active === 'positions' ? <PositionsPage /> : null}
        {active === 'sell_history' ? <SellHistoryPage /> : null}
        {active === 'a_tokens' ? (
          <ATokensPage focusMint={aPromoteFocusMint} onFocusMintHandled={() => setAPromoteFocusMint(null)} />
        ) : null}
        {active === 'l_tokens' && lTokensEnabled ? <LTokensPage /> : null}
      </SidebarLayout>
    </>
  );
}
