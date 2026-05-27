import TierListPage from './TierListPage'

export default function ATokensPage() {
  return (
    <TierListPage
      tier="a"
      title="A_Tokens"
      description="DEX-graduated tokens only: promoted to A when pump.fun shows DEX badge. A_mark at promote; ~1s price chart; S_mark on exit rules."
      fastPriceHint="Prices and chart refresh every 1s (tier_price + this page). Chart uses 1-second bars."
    />
  )
}
