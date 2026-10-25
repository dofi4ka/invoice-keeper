import {
  BarElement,
  CategoryScale,
  Chart,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  LogarithmicScale,
  PointElement,
  Tooltip,
} from "chart.js";
import type { Currency } from "../types";

Chart.register(CategoryScale, LinearScale, LogarithmicScale, PointElement, LineElement, BarElement, Filler, Tooltip, Legend);
Chart.defaults.font.family = "Inter, system-ui, sans-serif";
Chart.defaults.font.size = 12;
Chart.defaults.color = "#6e6e73";

export const CURRENCY_COLOR: Record<Currency, string> = {
  RUB: "#4cc6f1",
  USD: "#182d48",
  EUR: "#e97c35",
};

export const CURRENCY_FILL: Record<Currency, string> = {
  RUB: "rgba(76, 198, 241, 0.35)",
  USD: "rgba(24, 45, 72, 0.3)",
  EUR: "rgba(233, 124, 53, 0.3)",
};

export const legendBottom = {
  position: "bottom" as const,
  labels: { usePointStyle: true, pointStyle: "circle" as const, boxWidth: 8, boxHeight: 8, padding: 16 },
};

export const tooltipStyle = {
  backgroundColor: "#000",
  padding: 10,
  cornerRadius: 10,
  boxPadding: 4,
  usePointStyle: true,
};
