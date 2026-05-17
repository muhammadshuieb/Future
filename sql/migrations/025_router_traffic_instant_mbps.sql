ALTER TABLE router_health_snapshots
  ADD COLUMN traffic_rx_mbps DECIMAL(14,2) NULL AFTER traffic_tx_mb_period,
  ADD COLUMN traffic_tx_mbps DECIMAL(14,2) NULL AFTER traffic_rx_mbps;
