"use client";

import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  AreaSeries,
  BarSeries,
  BaselineSeries,
  CandlestickData,
  CandlestickSeries,
  ColorType,
  createChart,
  HistogramData,
  HistogramSeries,
  LineData,
  LineSeries,
  UTCTimestamp,
} from "lightweight-charts";

type PriceView = "candlestick" | "ohlc" | "line" | "area" | "baseline";
type RequiredColumn = "time" | "open" | "high" | "low" | "close" | "volume";
type DataSourceKind = "default" | "uploaded";

type MarketPoint = {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type ParsedDataset = {
  points: MarketPoint[];
  ohlcData: CandlestickData<UTCTimestamp>[];
  closeData: LineData<UTCTimestamp>[];
  volumeData: HistogramData<UTCTimestamp>[];
  sma20: LineData<UTCTimestamp>[];
  ema50: LineData<UTCTimestamp>[];
};

type CsvStructureInfo = {
  headers: string[];
  columnMap: Record<RequiredColumn, string>;
  validRows: number;
  skippedRows: number;
  startTime: UTCTimestamp;
  endTime: UTCTimestamp;
};

type ParsedCsvResult = {
  dataset: ParsedDataset;
  structure: CsvStructureInfo;
};

type DataSource = {
  kind: DataSourceKind;
  name: string;
};

const DEFAULT_CSV_PATH = "/data/NSE_ADANIENT_15.csv";
const DEFAULT_CSV_NAME = "NSE_ADANIENT_15.csv";

const REQUIRED_COLUMNS: RequiredColumn[] = [
  "time",
  "open",
  "high",
  "low",
  "close",
  "volume",
];

const PRICE_VIEWS: { id: PriceView; label: string }[] = [
  { id: "candlestick", label: "Candlestick" },
  { id: "ohlc", label: "OHLC Bar" },
  { id: "line", label: "Line" },
  { id: "area", label: "Area" },
  { id: "baseline", label: "Baseline" },
];

const HEADER_ALIASES: Record<RequiredColumn, string[]> = {
  time: ["time", "timestamp", "datetime", "date"],
  open: ["open", "o"],
  high: ["high", "h"],
  low: ["low", "l"],
  close: ["close", "c", "last"],
  volume: ["volume", "vol", "v", "qty", "quantity"],
};

const UP_COLOR = "#16a34a";
const DOWN_COLOR = "#dc2626";
const GRID_COLOR = "#dbe3f0";

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findColumnIndexes(headers: string[]): {
  indexes: Record<RequiredColumn, number>;
  mappedHeaders: Record<RequiredColumn, string>;
} {
  const normalizedHeaders = headers.map(normalizeHeader);
  const indexes = {} as Record<RequiredColumn, number>;
  const mappedHeaders = {} as Record<RequiredColumn, string>;
  const missing: RequiredColumn[] = [];

  for (const key of REQUIRED_COLUMNS) {
    const aliases = HEADER_ALIASES[key].map(normalizeHeader);
    const index = normalizedHeaders.findIndex((header) => aliases.includes(header));

    if (index === -1) {
      missing.push(key);
      continue;
    }

    indexes[key] = index;
    mappedHeaders[key] = headers[index];
  }

  if (missing.length > 0) {
    throw new Error(
      `CSV structure invalid. Missing columns: ${missing.join(", ")}. Found headers: ${headers.join(", ")}.`,
    );
  }

  return { indexes, mappedHeaders };
}

function buildSma(data: LineData<UTCTimestamp>[], period: number): LineData<UTCTimestamp>[] {
  if (data.length < period) {
    return [];
  }

  const result: LineData<UTCTimestamp>[] = [];
  let rollingSum = 0;

  for (let i = 0; i < data.length; i += 1) {
    rollingSum += data[i].value;

    if (i >= period) {
      rollingSum -= data[i - period].value;
    }

    if (i >= period - 1) {
      result.push({
        time: data[i].time,
        value: Number((rollingSum / period).toFixed(2)),
      });
    }
  }

  return result;
}

function buildEma(data: LineData<UTCTimestamp>[], period: number): LineData<UTCTimestamp>[] {
  if (data.length < period) {
    return [];
  }

  const multiplier = 2 / (period + 1);
  const seed = data.slice(0, period).reduce((sum, point) => sum + point.value, 0) / period;
  const result: LineData<UTCTimestamp>[] = [
    { time: data[period - 1].time, value: Number(seed.toFixed(2)) },
  ];

  let previousEma = seed;

  for (let i = period; i < data.length; i += 1) {
    previousEma = data[i].value * multiplier + previousEma * (1 - multiplier);
    result.push({
      time: data[i].time,
      value: Number(previousEma.toFixed(2)),
    });
  }

  return result;
}

function parseCsvToDataset(csvContent: string): ParsedCsvResult {
  const lines = csvContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    throw new Error("CSV file has no data rows.");
  }

  const headers = lines[0].split(",").map((header) => header.trim());
  const { indexes, mappedHeaders } = findColumnIndexes(headers);

  const points: MarketPoint[] = [];
  let skippedRows = 0;

  for (let i = 1; i < lines.length; i += 1) {
    const columns = lines[i].split(",").map((value) => value.trim());
    if (columns.length < headers.length) {
      skippedRows += 1;
      continue;
    }

    const timestampMs = Date.parse(columns[indexes.time]);
    const open = Number(columns[indexes.open]);
    const high = Number(columns[indexes.high]);
    const low = Number(columns[indexes.low]);
    const close = Number(columns[indexes.close]);
    const volume = Number(columns[indexes.volume]);

    if (
      Number.isNaN(timestampMs) ||
      [open, high, low, close, volume].some((value) => Number.isNaN(value)) ||
      high < low
    ) {
      skippedRows += 1;
      continue;
    }

    points.push({
      time: Math.floor(timestampMs / 1000) as UTCTimestamp,
      open,
      high,
      low,
      close,
      volume,
    });
  }

  if (points.length === 0) {
    throw new Error("No valid market rows were parsed from CSV data.");
  }

  points.sort((a, b) => Number(a.time) - Number(b.time));

  const ohlcData: CandlestickData<UTCTimestamp>[] = points.map((point) => ({
    time: point.time,
    open: point.open,
    high: point.high,
    low: point.low,
    close: point.close,
  }));

  const closeData: LineData<UTCTimestamp>[] = points.map((point) => ({
    time: point.time,
    value: point.close,
  }));

  const volumeData: HistogramData<UTCTimestamp>[] = points.map((point) => ({
    time: point.time,
    value: point.volume,
    color:
      point.close >= point.open ? "rgba(22, 163, 74, 0.45)" : "rgba(220, 38, 38, 0.45)",
  }));

  return {
    dataset: {
      points,
      ohlcData,
      closeData,
      volumeData,
      sma20: buildSma(closeData, 20),
      ema50: buildEma(closeData, 50),
    },
    structure: {
      headers,
      columnMap: mappedHeaders,
      validRows: points.length,
      skippedRows,
      startTime: points[0].time,
      endTime: points[points.length - 1].time,
    },
  };
}

function formatCompact(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPrice(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDateTimeFromEpoch(seconds: UTCTimestamp): string {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(Number(seconds) * 1000);
}

export default function StockChartDashboard() {
  const chartHostRef = useRef<HTMLDivElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const defaultCsvRef = useRef<string | null>(null);

  const [priceView, setPriceView] = useState<PriceView>("candlestick");
  const [dataset, setDataset] = useState<ParsedDataset | null>(null);
  const [structure, setStructure] = useState<CsvStructureInfo | null>(null);
  const [source, setSource] = useState<DataSource>({
    kind: "default",
    name: DEFAULT_CSV_NAME,
  });
  const [isLoadingCsv, setIsLoadingCsv] = useState(true);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  function applyCsv(text: string, nextSource: DataSource) {
    const parsed = parseCsvToDataset(text);
    setDataset(parsed.dataset);
    setStructure(parsed.structure);
    setSource(nextSource);
    setLoadingError(null);
  }

  async function fetchDefaultCsvText(): Promise<string> {
    if (defaultCsvRef.current) {
      return defaultCsvRef.current;
    }

    const response = await fetch(DEFAULT_CSV_PATH, { cache: "force-cache" });
    if (!response.ok) {
      throw new Error(`Default CSV fetch failed with status ${response.status}.`);
    }

    const text = await response.text();
    defaultCsvRef.current = text;
    return text;
  }

  useEffect(() => {
    let isCancelled = false;

    async function bootstrapDefaultCsv() {
      try {
        const text = await fetchDefaultCsvText();
        if (isCancelled) {
          return;
        }

        applyCsv(text, { kind: "default", name: DEFAULT_CSV_NAME });
      } catch (error) {
        if (isCancelled) {
          return;
        }

        const message =
          error instanceof Error ? error.message : "Failed to load the default CSV.";
        setLoadingError(message);
      } finally {
        if (!isCancelled) {
          setIsLoadingCsv(false);
        }
      }
    }

    void bootstrapDefaultCsv();

    return () => {
      isCancelled = true;
    };
  }, []);

  async function handleResetDefaultCsv() {
    setIsLoadingCsv(true);
    setLoadingError(null);

    try {
      const text = await fetchDefaultCsvText();
      applyCsv(text, { kind: "default", name: DEFAULT_CSV_NAME });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load the default CSV.";
      setLoadingError(message);
    } finally {
      setIsLoadingCsv(false);
    }
  }

  async function readAndApplyUploadedFile(file: File) {
    setIsLoadingCsv(true);
    setLoadingError(null);

    try {
      const text = await file.text();
      applyCsv(text, { kind: "uploaded", name: file.name });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to parse uploaded CSV.";
      setLoadingError(`Upload failed for "${file.name}". ${message}`);
    } finally {
      setIsLoadingCsv(false);
    }
  }

  async function handleCsvUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    await readAndApplyUploadedFile(file);
    event.target.value = "";
  }

  async function handleCsvDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDragOver(false);

    const file = event.dataTransfer.files?.[0];
    if (!file) {
      return;
    }

    await readAndApplyUploadedFile(file);
  }

  useEffect(() => {
    if (!dataset || !chartHostRef.current) {
      return;
    }

    const chart = createChart(chartHostRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#f8fbff" },
        textColor: "#0f172a",
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: GRID_COLOR },
        horzLines: { color: GRID_COLOR },
      },
      rightPriceScale: {
        borderColor: "#cbd5e1",
      },
      timeScale: {
        borderColor: "#cbd5e1",
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        vertLine: { color: "#64748b" },
        horzLine: { color: "#64748b" },
      },
      localization: {
        locale: "en-IN",
      },
    });

    if (priceView === "candlestick") {
      const series = chart.addSeries(CandlestickSeries, {
        upColor: UP_COLOR,
        downColor: DOWN_COLOR,
        borderUpColor: UP_COLOR,
        borderDownColor: DOWN_COLOR,
        wickUpColor: UP_COLOR,
        wickDownColor: DOWN_COLOR,
      });
      series.setData(dataset.ohlcData);
    } else if (priceView === "ohlc") {
      const series = chart.addSeries(BarSeries, {
        upColor: UP_COLOR,
        downColor: DOWN_COLOR,
        openVisible: true,
        thinBars: false,
      });
      series.setData(dataset.ohlcData);
    } else if (priceView === "line") {
      const series = chart.addSeries(LineSeries, {
        color: "#2563eb",
        lineWidth: 2,
      });
      series.setData(dataset.closeData);
    } else if (priceView === "area") {
      const series = chart.addSeries(AreaSeries, {
        lineColor: "#2563eb",
        topColor: "rgba(37, 99, 235, 0.35)",
        bottomColor: "rgba(37, 99, 235, 0.02)",
        lineWidth: 2,
      });
      series.setData(dataset.closeData);
    } else {
      const series = chart.addSeries(BaselineSeries, {
        baseValue: { type: "price", price: dataset.closeData[0].value },
        topLineColor: "#16a34a",
        topFillColor1: "rgba(22, 163, 74, 0.32)",
        topFillColor2: "rgba(22, 163, 74, 0.03)",
        bottomLineColor: "#dc2626",
        bottomFillColor1: "rgba(220, 38, 38, 0.03)",
        bottomFillColor2: "rgba(220, 38, 38, 0.28)",
        lineWidth: 2,
      });
      series.setData(dataset.closeData);
    }

    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: "rgba(59, 130, 246, 0.5)",
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    volumeSeries.setData(dataset.volumeData);

    const sma20Series = chart.addSeries(LineSeries, {
      color: "#f97316",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    sma20Series.setData(dataset.sma20);

    const ema50Series = chart.addSeries(LineSeries, {
      color: "#7c3aed",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    ema50Series.setData(dataset.ema50);

    chart.priceScale("right").applyOptions({
      scaleMargins: { top: 0.08, bottom: 0.24 },
    });
    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.76, bottom: 0 },
    });
    chart.timeScale().fitContent();

    return () => {
      chart.remove();
    };
  }, [dataset, priceView]);

  const stats = useMemo(() => {
    if (!dataset) {
      return null;
    }

    const first = dataset.points[0];
    const last = dataset.points[dataset.points.length - 1];
    const absoluteChange = last.close - first.open;
    const percentChange = (absoluteChange / first.open) * 100;

    return {
      bars: dataset.points.length,
      high: Math.max(...dataset.points.map((point) => point.high)),
      low: Math.min(...dataset.points.map((point) => point.low)),
      latestClose: last.close,
      totalVolume: dataset.points.reduce((sum, point) => sum + point.volume, 0),
      absoluteChange,
      percentChange,
    };
  }, [dataset]);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {PRICE_VIEWS.map((view) => (
              <button
                key={view.id}
                type="button"
                onClick={() => setPriceView(view.id)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  priceView === view.id
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                {view.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => uploadInputRef.current?.click()}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Upload CSV
            </button>
            <button
              type="button"
              onClick={() => void handleResetDefaultCsv()}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Reset Default
            </button>
          </div>
        </div>

        <label
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={(event) => {
            event.preventDefault();
            setIsDragOver(false);
          }}
          onDrop={(event) => void handleCsvDrop(event)}
          className={`block cursor-pointer rounded-xl border-2 border-dashed p-4 text-sm ${
            isDragOver
              ? "border-blue-400 bg-blue-50 text-blue-700"
              : "border-slate-300 bg-slate-50 text-slate-600"
          }`}
        >
          <input
            ref={uploadInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => void handleCsvUpload(event)}
            className="hidden"
          />
          <p className="font-medium">Drop a CSV here or click to upload</p>
          <p className="mt-1 text-xs">
            Local-only parsing in browser memory. Uploaded files are not stored or sent to a server.
          </p>
        </label>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-700">
            Source: {source.kind === "default" ? "Default" : "Uploaded"} ({source.name})
          </span>
          {structure && (
            <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-700">
              Valid Rows: {structure.validRows.toLocaleString("en-IN")} | Skipped Rows:{" "}
              {structure.skippedRows.toLocaleString("en-IN")}
            </span>
          )}
        </div>

        {stats && (
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
            <div className="rounded-lg bg-slate-50 p-2">
              <p className="text-xs text-slate-500">Latest Close</p>
              <p className="font-semibold">{formatPrice(stats.latestClose)}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-2">
              <p className="text-xs text-slate-500">Net Change</p>
              <p
                className={`font-semibold ${
                  stats.absoluteChange >= 0 ? "text-green-700" : "text-red-700"
                }`}
              >
                {stats.absoluteChange >= 0 ? "+" : ""}
                {formatPrice(stats.absoluteChange)} ({stats.percentChange.toFixed(2)}%)
              </p>
            </div>
            <div className="rounded-lg bg-slate-50 p-2">
              <p className="text-xs text-slate-500">Session High</p>
              <p className="font-semibold">{formatPrice(stats.high)}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-2">
              <p className="text-xs text-slate-500">Session Low</p>
              <p className="font-semibold">{formatPrice(stats.low)}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-2">
              <p className="text-xs text-slate-500">Bars Parsed</p>
              <p className="font-semibold">{stats.bars.toLocaleString("en-IN")}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-2">
              <p className="text-xs text-slate-500">Total Volume</p>
              <p className="font-semibold">{formatCompact(stats.totalVolume)}</p>
            </div>
          </div>
        )}

        <div
          ref={chartHostRef}
          className="h-[60vh] min-h-[420px] w-full overflow-hidden rounded-xl border border-slate-200"
        />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-sm">
        <p className="font-semibold text-slate-900">CSV Mapping And Validation</p>
        <p className="mt-1">
          Required logical columns: time, open, high, low, close, volume.
        </p>
        <p className="mt-1 text-slate-500">
          Accepted aliases include timestamp/date for time, and vol/qty for volume.
        </p>
        {structure && (
          <>
            <p className="mt-2 text-xs text-slate-500">
              Data Range: {formatDateTimeFromEpoch(structure.startTime)} to{" "}
              {formatDateTimeFromEpoch(structure.endTime)}
            </p>
            <div className="mt-2 grid grid-cols-1 gap-1 text-xs sm:grid-cols-2 lg:grid-cols-3">
              {REQUIRED_COLUMNS.map((column) => (
                <p key={column} className="rounded bg-slate-50 px-2 py-1">
                  <span className="font-medium">{column}</span>: {structure.columnMap[column]}
                </p>
              ))}
            </div>
          </>
        )}
      </div>

      {(isLoadingCsv || loadingError) && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
          {isLoadingCsv && <p className="text-slate-600">Loading and mapping CSV data...</p>}
          {loadingError && <p className="text-red-600">{loadingError}</p>}
        </div>
      )}
    </section>
  );
}
