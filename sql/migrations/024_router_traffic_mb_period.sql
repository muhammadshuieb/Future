ALTER TABLE router_health_snapshots
  ADD COLUMN traffic_rx_mb_period DECIMAL(14,2) NULL AFTER traffic_tx_bps,
  ADD COLUMN traffic_tx_mb_period DECIMAL(14,2) NULL AFTER traffic_rx_mb_period;
