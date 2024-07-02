## General Indexing Flow

1. Markets are created by the `MarketCreated` event from the MarketFactory
1. Orders are created by the `OrderCreated` event
   - This creates a Market Order and Account Order
   - This may also create a Market Account Position if going from zero to non-zero
   - Orders are linked to a SubOracle version
1. When a SubOracle version is fulfilled - the `fulfillOrder` callback is called for each Order
   - This optimistically updates the order's position
   - This also updates the market's latest price
1. The `PositionProcessed` and `AccountPositionProcessed` events update the Market and Account positions
   - As part of the account processing, various fees and pnl breakdowns are calculated and recorded for the order
   - Accumulations are updated for the market and account
