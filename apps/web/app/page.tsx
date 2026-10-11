import { DATA_REGIONS } from "@daybell/config";

export default function Home() {
  return (
    <main style={{ padding: "48px 16px", maxWidth: 640, margin: "0 auto" }}>
      <h1 style={{ fontSize: 32, margin: 0 }}>Daybell</h1>
      <p style={{ color: "var(--muted)" }}>
        Foundations in progress. Data regions ready: {DATA_REGIONS.join(", ").toUpperCase()}.
      </p>
    </main>
  );
}
