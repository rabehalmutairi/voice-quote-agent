import { MetricsDashboard } from "../features/metrics/MetricsDashboard";
import { metricsFixture } from "../mocks/metricsFixture";

export function MetricsPage({ metrics = metricsFixture, status = "ready", error }) {
  return <MetricsDashboard metrics={metrics} status={status} error={error} />;
}
