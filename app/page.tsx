import StockChartDashboard from "@/app/components/stock-chart-dashboard";

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-100 text-slate-900">
      <div className="mx-auto flex w-full flex-col gap-4 px-4 py-5 sm:px-6 lg:px-8">

        <StockChartDashboard />
      </div>
    </main>
  );
}
