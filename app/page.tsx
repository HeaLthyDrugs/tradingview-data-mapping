import StockChartDashboard from "@/app/components/stock-chart-dashboard";

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-100 text-slate-900">
      <div className="mx-auto flex w-full flex-col gap-4 px-4 py-5 sm:px-6 lg:px-8">
        <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h1 className="text-2xl font-semibold tracking-tight">Stock Data Mapping Dashboard</h1>
          <p className="mt-2 text-sm text-slate-600">
            Lightweight TradingView charts powered by CSV mapping (
            <span className="font-medium">time/open/high/low/close/Volume</span>).
          </p>
        </header>

        <StockChartDashboard />
      </div>
    </main>
  );
}
