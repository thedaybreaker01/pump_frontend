import TierListPage from './TierListPage'

export default function LTokensPage() {
  return (
    <TierListPage
      tier="l"
      title="L_Tokens"
      description="Long-lived tokens: first seen at least 24 hours ago when promoted. Stays on this list once promoted."
      fastPriceHint="Prices and chart refresh every 2s (tier_price + this page). Chart uses 5-second bars."
    />
  )
}
