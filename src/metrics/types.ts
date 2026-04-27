export interface MetricsOptions {
  riskFreeRate?: number;
  topDrawdowns?: number;
  varConfidence?: number;
}

export interface DrawdownEntry {
  peakDate: string;
  troughDate: string;
  recoveryDate: string | null;
  depth: number;
  durationDays: number;
  underwaterDays: number;
}

export interface MonthlyReturnsTable {
  rows: Array<{ year: number; months: (number | null)[]; ytd: number | null }>;
}

export interface MetricsResult {
  range: { from: string; to: string; years: number };
  returns: {
    totalReturn: number;
    cagr: number;
    bestYear: { year: number; return: number } | null;
    worstYear: { year: number; return: number } | null;
    bestMonth: { date: string; return: number } | null;
    worstMonth: { date: string; return: number } | null;
    pctPositiveMonths: number;
  };
  risk: {
    volatility: number;
    downsideDeviation: number;
    maxDrawdown: DrawdownEntry;
    currentDrawdown: number;
    ulcerIndex: number;
    skew: number;
    kurtosis: number;
    var95: number;
    cvar95: number;
  };
  riskAdjusted: { sharpe: number; sortino: number; calmar: number };
  activity: { rebalances: number; trades: number; turnover: number; winRate: number };
  tables: {
    drawdowns: DrawdownEntry[];
    monthly: MonthlyReturnsTable;
    yearly: Array<{ year: number; return: number }>;
  };
}
