-- Enable RLS on all public-data tables and grant read-only access via anon key.
-- service_role bypasses RLS automatically for server-side writes/ingestion.

ALTER TABLE trading_days ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read" ON trading_days FOR SELECT USING (true);

ALTER TABLE tickers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read" ON tickers FOR SELECT USING (true);

ALTER TABLE indicators ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read" ON indicators FOR SELECT USING (true);

ALTER TABLE indicators_series ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read" ON indicators_series FOR SELECT USING (true);

ALTER TABLE signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read" ON signals FOR SELECT USING (true);

ALTER TABLE signals_series ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read" ON signals_series FOR SELECT USING (true);
