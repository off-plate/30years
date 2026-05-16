import { useState, useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, BarChart, Bar, Area, AreaChart,
} from "recharts";

// ─── formátování ─────────────────────────────────────────────────────────
const fmt = (n) => {
  if (n == null || isNaN(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} M Kč`;
  if (abs >= 1_000) return `${Math.round(n / 1000)} tis. Kč`;
  return `${Math.round(n)} Kč`;
};
const pct = (v) => `${(v * 100).toFixed(1)} %`;

// ─── výpočetní jádro ────────────────────────────────────────────────────
// Scénář 1: nájem + měsíční investice do akcií
// Scénář 2: hypotéka na byt, případně investice rozdílu mezi splátkou hyp. a (splátka+nájem)
function simulate({
  years,
  // společné
  initialCapital,
  inflation,
  // akcie
  stockReturn,
  monthlyAdd,
  rentMonthly,
  rentGrowth,
  // byt
  apartmentPrice,
  mortgageRate,
  mortgageYears, // doba splácení
  fixationYears, // perioda refixace
  refixRateDrift, // o kolik se sazba změní při refixaci (anualizovaně, +/-)
  appreciation,
  propertyMaintenancePct, // roční náklady na údržbu jako % z ceny
  propertyTaxYearly, // daň z nemovitosti, fixní roční
}) {
  const months = years * 12;
  const r = stockReturn / 12;
  const mr = mortgageRate / 12;
  const inflMonthly = Math.pow(1 + inflation, 1 / 12) - 1;

  // úvodní splátka anuitní pro mortgageYears
  const loan0 = Math.max(0, apartmentPrice - initialCapital);
  const totalMortgageMonths = mortgageYears * 12;
  const annuity = (loanBalance, rateMonthly, monthsLeft) => {
    if (rateMonthly === 0) return loanBalance / monthsLeft;
    return (loanBalance * rateMonthly) / (1 - Math.pow(1 + rateMonthly, -monthsLeft));
  };

  let mortgagePayment = annuity(loan0, mr, totalMortgageMonths);

  let stockBalance = initialCapital;
  let loanBalance = loan0;
  let currentMortgageRate = mortgageRate;
  let currentRent = rentMonthly;
  let currentMonthlyAdd = monthlyAdd;
  let apartmentValue = apartmentPrice;

  let totalRentPaid = 0;
  let totalInterestPaid = 0;
  let totalMaintenancePaid = 0;
  let totalPropertyTaxPaid = 0;
  let totalStockContrib = initialCapital;

  const yearly = [{
    year: 0,
    stock: stockBalance,
    aptEquity: initialCapital,
    aptValue: apartmentPrice,
    loanBalance: loan0,
    rent: currentRent,
    mortgagePayment,
    totalRentPaid: 0,
    totalInterestPaid: 0,
    stockReal: stockBalance,
    aptEquityReal: initialCapital,
  }];

  for (let m = 1; m <= months; m++) {
    // — akcie
    stockBalance = stockBalance * (1 + r) + currentMonthlyAdd;
    totalStockContrib += currentMonthlyAdd;
    totalRentPaid += currentRent;

    // — byt
    const interest = loanBalance * (currentMortgageRate / 12);
    let principal = mortgagePayment - interest;
    if (principal > loanBalance) principal = loanBalance;
    loanBalance = Math.max(0, loanBalance - principal);
    totalInterestPaid += interest;

    // růst hodnoty bytu měsíčně
    apartmentValue = apartmentValue * Math.pow(1 + appreciation, 1 / 12);

    // měsíční náklady na byt: údržba a daň
    const monthlyMaintenance = (apartmentValue * propertyMaintenancePct) / 12;
    const monthlyPropertyTax = propertyTaxYearly / 12;
    totalMaintenancePaid += monthlyMaintenance;
    totalPropertyTaxPaid += monthlyPropertyTax;

    // — yearly anchor
    if (m % 12 === 0) {
      // růst nájmu a inflace příspěvků (mírná indexace)
      currentRent = currentRent * (1 + rentGrowth);
      currentMonthlyAdd = currentMonthlyAdd * (1 + inflation);

      // refixace hypotéky
      const yearIdx = m / 12;
      if (yearIdx % fixationYears === 0 && yearIdx < mortgageYears) {
        currentMortgageRate = Math.max(0.001, currentMortgageRate + refixRateDrift);
        const monthsLeft = totalMortgageMonths - m;
        mortgagePayment = annuity(loanBalance, currentMortgageRate / 12, monthsLeft);
      }

      const realFactor = Math.pow(1 + inflation, yearIdx);
      yearly.push({
        year: yearIdx,
        stock: Math.round(stockBalance),
        aptEquity: Math.round(apartmentValue - loanBalance),
        aptValue: Math.round(apartmentValue),
        loanBalance: Math.round(loanBalance),
        rent: Math.round(currentRent),
        mortgagePayment: Math.round(mortgagePayment),
        totalRentPaid: Math.round(totalRentPaid),
        totalInterestPaid: Math.round(totalInterestPaid),
        stockReal: Math.round(stockBalance / realFactor),
        aptEquityReal: Math.round((apartmentValue - loanBalance) / realFactor),
      });
    }
  }

  return {
    yearly,
    totalRentPaid,
    totalInterestPaid,
    totalMaintenancePaid,
    totalPropertyTaxPaid,
    totalStockContrib,
    finalStock: stockBalance,
    finalAptEquity: apartmentValue - loanBalance,
    finalAptValue: apartmentValue,
    finalLoan: loanBalance,
  };
}

// ─── UI helpers ──────────────────────────────────────────────────────────
const Slider = ({ label, value, min, max, step, onChange, fmtFn, color, hint }) => (
  <div style={{ marginBottom: 18 }}>
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
      <span style={{ color: "#9ca3af", fontSize: 13, fontFamily: "'DM Mono', monospace" }}>{label}</span>
      <span style={{ color: color || "#f0f0f0", fontSize: 13, fontWeight: 700, fontFamily: "'DM Mono', monospace" }}>
        {fmtFn ? fmtFn(value) : value}
      </span>
    </div>
    <input
      type="range" min={min} max={max} step={step} value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{ width: "100%", accentColor: color || "#60a5fa", cursor: "pointer" }}
    />
    {hint && <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>{hint}</div>}
  </div>
);

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "#0f1117",
      border: "1px solid rgba(255,255,255,0.12)",
      borderRadius: 12,
      padding: "12px 18px",
      fontFamily: "'DM Mono', monospace",
    }}>
      <p style={{ color: "#9ca3af", marginBottom: 8, fontSize: 12 }}>Rok {label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color, margin: "4px 0", fontSize: 13, fontWeight: 600 }}>
          {p.name}: {fmt(p.value)}
        </p>
      ))}
    </div>
  );
};

const Card = ({ children, accent, style }) => (
  <div style={{
    background: "rgba(255,255,255,0.04)",
    border: `1px solid ${accent || "rgba(255,255,255,0.08)"}`,
    borderRadius: 20,
    padding: 24,
    ...style,
  }}>{children}</div>
);

// ─── main ────────────────────────────────────────────────────────────────
export default function App() {
  // horizont
  const [years, setYears] = useState(30);

  // společné
  const [initialCapital, setInitialCapital] = useState(800_000);
  const [inflation, setInflation] = useState(0.025); // ČNB cíl ~2 %

  // akcie
  const [stockReturn, setStockReturn] = useState(0.075); // MSCI World ~7-8 % nom. v CZK
  const [monthlyAdd, setMonthlyAdd] = useState(20_000);
  const [rentMonthly, setRentMonthly] = useState(28_000);
  const [rentGrowth, setRentGrowth] = useState(0.04); // Praha posledních 10 let ~4 %

  // byt
  const [apartmentPrice, setApartmentPrice] = useState(8_000_000);
  const [mortgageRate, setMortgageRate] = useState(0.052); // aktuální průměr ČR 2026
  const [mortgageYears, setMortgageYears] = useState(30);
  const [fixationYears, setFixationYears] = useState(5);
  const [refixRateDrift, setRefixRateDrift] = useState(0.0); // o kolik se sazba změní
  const [appreciation, setAppreciation] = useState(0.05); // Praha dlouhodobě ~5 % nom.
  const [propertyMaintenancePct, setPropertyMaintenancePct] = useState(0.01); // 1 % ročně z hodnoty
  const [propertyTaxYearly, setPropertyTaxYearly] = useState(3000);

  const result = useMemo(() => simulate({
    years,
    initialCapital, inflation,
    stockReturn, monthlyAdd, rentMonthly, rentGrowth,
    apartmentPrice, mortgageRate, mortgageYears, fixationYears, refixRateDrift,
    appreciation, propertyMaintenancePct, propertyTaxYearly,
  }), [
    years, initialCapital, inflation, stockReturn, monthlyAdd, rentMonthly, rentGrowth,
    apartmentPrice, mortgageRate, mortgageYears, fixationYears, refixRateDrift,
    appreciation, propertyMaintenancePct, propertyTaxYearly,
  ]);

  const chartData = result.yearly.map((d) => ({
    year: d.year,
    "Akcie": d.stockReal,
    "Byt (vlastní jmění)": d.aptEquityReal,
  }));

  const finalStock = result.yearly[result.yearly.length - 1].stockReal;
  const finalApt = result.yearly[result.yearly.length - 1].aptEquityReal;

  const winner = finalStock > finalApt ? "akcie" : "byt";
  const diff = Math.abs(finalStock - finalApt);

  const monthlyStocks = rentMonthly + monthlyAdd;
  const initialMortgagePayment = result.yearly[1]?.mortgagePayment || 0;
  const monthlyApt = initialMortgagePayment + (apartmentPrice * propertyMaintenancePct / 12) + (propertyTaxYearly / 12);

  // daňový pohled — 3 roky časový test pro akcie = 0 % daň
  // byt: 5letý test pro primární bydlení (nebo 10 let pro investiční po 2021)
  const stockTaxFree = years >= 3;
  const aptTaxFree = years >= 5; // u primárního bydlení

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #0a0e1a 0%, #111827 60%, #0d1529 100%)",
      fontFamily: "'Inter', sans-serif",
      color: "#f0f0f0",
      padding: "32px 20px",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@700;800&family=Inter:wght@400;500;600&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; }
        input[type=range] { height: 4px; border-radius: 999px; }
      `}</style>

      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <div style={{
          display: "inline-block",
          background: "linear-gradient(90deg, #3b82f6, #8b5cf6)",
          borderRadius: 999,
          padding: "4px 16px",
          fontSize: 12,
          fontFamily: "'DM Mono', monospace",
          letterSpacing: 2,
          marginBottom: 14,
          color: "#fff",
        }}>30 LET · ČESKÝ TRH</div>
        <h1 style={{
          fontFamily: "'Syne', sans-serif",
          fontSize: "clamp(28px, 5vw, 52px)",
          fontWeight: 800,
          margin: 0,
          background: "linear-gradient(135deg, #ffffff 30%, #60a5fa 100%)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          lineHeight: 1.1,
        }}>Akcie vs. vlastní byt</h1>
        <p style={{ color: "#6b7280", marginTop: 10, fontSize: 15 }}>
          Dlouhodobá kalkulačka pro český trh — s inflací, růstem nájmu a refixací hypotéky
        </p>
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto" }}>

        {/* horizont */}
        <Card style={{ marginBottom: 24 }}>
          <Slider label={`Investiční horizont`} value={years} min={1} max={30} step={1}
            onChange={setYears} fmtFn={(v) => `${v} ${v === 1 ? "rok" : v < 5 ? "roky" : "let"}`}
            color="#a78bfa" hint={`Všechny hodnoty jsou reálné — po odečtení inflace ${pct(inflation)} ročně (dnešní kupní síla).`} />
        </Card>

        {/* winner banner */}
        <div style={{
          background: winner === "akcie"
            ? "linear-gradient(135deg, rgba(59,130,246,0.15), rgba(99,102,241,0.1))"
            : "linear-gradient(135deg, rgba(245,158,11,0.15), rgba(239,68,68,0.1))",
          border: `1px solid ${winner === "akcie" ? "rgba(59,130,246,0.3)" : "rgba(245,158,11,0.3)"}`,
          borderRadius: 16,
          padding: "20px 28px",
          marginBottom: 24,
        }}>
          <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 20 }}>
            Po {years} {years === 1 ? "roce" : years < 5 ? "letech" : "letech"} vede:{" "}
            <span style={{ color: winner === "akcie" ? "#60a5fa" : "#fbbf24" }}>
              {winner === "akcie" ? "Investice do akcií" : "Vlastní byt"}
            </span>
          </div>
          <div style={{ color: "#9ca3af", fontSize: 14, marginTop: 6 }}>
            Rozdíl ve vlastním jmění: <strong style={{ color: "#f0f0f0" }}>{fmt(diff)}</strong>
            {" · "}Měsíční výdaj akcie: <strong style={{ color: "#60a5fa" }}>{fmt(monthlyStocks)}</strong>
            {" · "}Měsíční výdaj byt (vč. údržby): <strong style={{ color: "#fbbf24" }}>{fmt(monthlyApt)}</strong>
          </div>
        </div>

        {/* dva panely */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>

          {/* akcie */}
          <Card accent="rgba(59,130,246,0.25)">
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
              <span style={{ fontSize: 22 }}>📈</span>
              <div>
                <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 16, color: "#60a5fa" }}>
                  Scénář 1: Pronájem + akcie
                </div>
                <div style={{ fontSize: 12, color: "#6b7280" }}>Bydlíš v nájmu, investuješ úspory</div>
              </div>
            </div>

            <Slider label="Počáteční kapitál (vklad do akcií)" value={initialCapital} min={0} max={5_000_000} step={50_000}
              onChange={setInitialCapital} fmtFn={fmt} color="#60a5fa" />
            <Slider label="Měsíční příspěvek do akcií" value={monthlyAdd} min={0} max={150_000} step={1_000}
              onChange={setMonthlyAdd} fmtFn={fmt} color="#60a5fa"
              hint="Příspěvek se každý rok navyšuje o inflaci." />
            <Slider label="Měsíční nájem (start)" value={rentMonthly} min={5_000} max={80_000} step={500}
              onChange={setRentMonthly} fmtFn={fmt} color="#f87171" />
            <Slider label="Růst nájmu / rok" value={rentGrowth} min={0} max={0.08} step={0.005}
              onChange={setRentGrowth} fmtFn={pct} color="#f87171"
              hint="Praha posledních 10 let cca 4 %." />
            <Slider label="Roční nominální výnos akcií" value={stockReturn} min={0.02} max={0.12} step={0.005}
              onChange={setStockReturn} fmtFn={pct} color="#34d399"
              hint="MSCI World dlouhodobě 7–8 % v CZK." />

            <div style={{
              marginTop: 14, padding: "12px 16px",
              background: "rgba(59,130,246,0.08)", borderRadius: 12,
              fontFamily: "'DM Mono', monospace", fontSize: 13,
            }}>
              <Row label="Celkový měsíční výdaj (start)" value={fmt(monthlyStocks)} />
              <Row label={`Portfolio za ${years} let`} value={fmt(finalStock)} valueColor="#60a5fa" />
              <Row label="Celkem zaplacený nájem" value={fmt(result.totalRentPaid)} valueColor="#f87171" />
            </div>
          </Card>

          {/* byt */}
          <Card accent="rgba(245,158,11,0.25)">
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
              <span style={{ fontSize: 22 }}>🏠</span>
              <div>
                <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 16, color: "#fbbf24" }}>
                  Scénář 2: Vlastní byt na hypotéku
                </div>
                <div style={{ fontSize: 12, color: "#6b7280" }}>Splácíš hypotéku, byt roste na hodnotě</div>
              </div>
            </div>

            <Slider label="Cena bytu" value={apartmentPrice} min={2_000_000} max={20_000_000} step={100_000}
              onChange={setApartmentPrice} fmtFn={fmt} color="#fbbf24" />
            <Slider label="Úroková sazba hypotéky" value={mortgageRate} min={0.02} max={0.09} step={0.001}
              onChange={setMortgageRate} fmtFn={pct} color="#f87171"
              hint="Průměr ČR 2026: ~5,2 %." />
            <Slider label="Splatnost hypotéky (let)" value={mortgageYears} min={5} max={30} step={1}
              onChange={setMortgageYears} fmtFn={(v) => `${v} let`} color="#fbbf24" />
            <Slider label="Fixace (let)" value={fixationYears} min={1} max={10} step={1}
              onChange={setFixationYears} fmtFn={(v) => `${v} let`} color="#fbbf24" />
            <Slider label="Posun sazby při refixaci" value={refixRateDrift} min={-0.02} max={0.03} step={0.0025}
              onChange={setRefixRateDrift} fmtFn={(v) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(2)} pb`} color="#f87171"
              hint="O kolik se sazba změní při každé refixaci." />
            <Slider label="Roční zhodnocení nemovitosti" value={appreciation} min={0} max={0.1} step={0.005}
              onChange={setAppreciation} fmtFn={pct} color="#34d399"
              hint="Praha dlouhodobě ~5 % nom." />
            <Slider label="Údržba a fond oprav / rok" value={propertyMaintenancePct} min={0} max={0.03} step={0.001}
              onChange={setPropertyMaintenancePct} fmtFn={pct} color="#94a3b8"
              hint="Reálně 0,5–1,5 % z hodnoty bytu." />
            <Slider label="Daň z nemovitosti / rok" value={propertyTaxYearly} min={0} max={20_000} step={500}
              onChange={setPropertyTaxYearly} fmtFn={fmt} color="#94a3b8" />

            <div style={{
              marginTop: 14, padding: "12px 16px",
              background: "rgba(245,158,11,0.08)", borderRadius: 12,
              fontFamily: "'DM Mono', monospace", fontSize: 13,
            }}>
              <Row label="Měsíční splátka (start)" value={fmt(initialMortgagePayment)} />
              <Row label="Měsíční výdaj vč. údržby" value={fmt(monthlyApt)} />
              <Row label={`Vlastní jmění za ${years} let`} value={fmt(finalApt)} valueColor="#fbbf24" />
              <Row label="Hodnota bytu" value={fmt(result.finalAptValue)} />
              <Row label="Zbývající dluh" value={fmt(result.finalLoan)} valueColor="#f87171" />
              <Row label="Celkem zaplacené úroky" value={fmt(result.totalInterestPaid)} valueColor="#f87171" />
            </div>
          </Card>
        </div>

        {/* společné předpoklady */}
        <Card style={{ marginBottom: 24 }} accent="rgba(167,139,250,0.25)">
          <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 15, marginBottom: 14, color: "#a78bfa" }}>
            Společné makro-předpoklady
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
            <Slider label="Inflace / rok" value={inflation} min={0} max={0.08} step={0.0025}
              onChange={setInflation} fmtFn={pct} color="#a78bfa"
              hint="Cíl ČNB 2 %. Realita 2014–2025 průměr ~3,5 %." />
          </div>
        </Card>

        {/* hlavní graf */}
        <Card style={{ marginBottom: 24 }}>
          <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 18, marginBottom: 20 }}>
            Vývoj vlastního jmění <span style={{ color: "#a78bfa", fontSize: 14, fontWeight: 500 }}>(reálné hodnoty, dnešní Kč)</span>
          </div>
          <ResponsiveContainer width="100%" height={360}>
            <LineChart data={chartData}>
              <CartesianGrid stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="year" tick={{ fill: "#6b7280", fontSize: 12 }} tickFormatter={(v) => `${v}`} />
              <YAxis tick={{ fill: "#6b7280", fontSize: 12 }} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontFamily: "'DM Mono', monospace", fontSize: 13 }} />
              <Line type="monotone" dataKey="Akcie" stroke="#60a5fa" strokeWidth={3}
                dot={false} activeDot={{ r: 6 }} />
              <Line type="monotone" dataKey="Byt (vlastní jmění)" stroke="#fbbf24" strokeWidth={3}
                dot={false} activeDot={{ r: 6 }} strokeDasharray="6 3" />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        {/* zaplaceno do dýmu */}
        <Card style={{ marginBottom: 24 }}>
          <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 16, marginBottom: 18 }}>
            Co je „do dýmu" za {years} {years === 1 ? "rok" : "let"}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
            <Stat icon="📭" label="Zaplacený nájem" value={fmt(result.totalRentPaid)} color="#f87171" />
            <Stat icon="🏦" label="Úroky hypotéky" value={fmt(result.totalInterestPaid)} color="#f87171" />
            <Stat icon="🔧" label="Údržba bytu" value={fmt(result.totalMaintenancePaid)} color="#94a3b8" />
            <Stat icon="📋" label="Daň z nemovitosti" value={fmt(result.totalPropertyTaxPaid)} color="#94a3b8" />
          </div>
          <div style={{
            marginTop: 18, padding: "14px 18px",
            background: "rgba(255,255,255,0.04)", borderRadius: 12, fontSize: 13, color: "#9ca3af", lineHeight: 1.7
          }}>
            💡 V akciovém scénáři jde do dýmu jen <strong style={{ color: "#f87171" }}>nájem</strong>.
            V bytovém scénáři jdou do dýmu <strong style={{ color: "#f87171" }}>úroky + údržba + daň</strong>
            {" "}— celkem <strong style={{ color: "#f0f0f0" }}>
              {fmt(result.totalInterestPaid + result.totalMaintenancePaid + result.totalPropertyTaxPaid)}
            </strong>.
          </div>
        </Card>

        {/* daňový pohled */}
        <Card style={{ marginBottom: 24 }}>
          <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 16, marginBottom: 16 }}>
            🧾 Daňový pohled (ČR)
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={{
              padding: 16, borderRadius: 12,
              background: stockTaxFree ? "rgba(52,211,153,0.1)" : "rgba(248,113,113,0.1)",
              border: `1px solid ${stockTaxFree ? "rgba(52,211,153,0.3)" : "rgba(248,113,113,0.3)"}`,
            }}>
              <div style={{ fontSize: 13, color: "#9ca3af", marginBottom: 6 }}>Akcie</div>
              <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 18, color: stockTaxFree ? "#34d399" : "#f87171" }}>
                {stockTaxFree ? "0 % daň" : "15 % daň ze zisku"}
              </div>
              <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6, lineHeight: 1.5 }}>
                Časový test 3 roky držby → osvobozeno.
                {!stockTaxFree && ` Tvůj horizont ${years} let < 3 roky.`}
              </div>
            </div>
            <div style={{
              padding: 16, borderRadius: 12,
              background: aptTaxFree ? "rgba(52,211,153,0.1)" : "rgba(248,113,113,0.1)",
              border: `1px solid ${aptTaxFree ? "rgba(52,211,153,0.3)" : "rgba(248,113,113,0.3)"}`,
            }}>
              <div style={{ fontSize: 13, color: "#9ca3af", marginBottom: 6 }}>Byt</div>
              <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 18, color: aptTaxFree ? "#34d399" : "#f87171" }}>
                {aptTaxFree ? "0 % daň (primární bydlení)" : "15 % daň při prodeji"}
              </div>
              <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6, lineHeight: 1.5 }}>
                Časový test 5 let u vlastního bydlení, 10 let u investičního (po 2021).
              </div>
            </div>
          </div>
        </Card>

        {/* tabulka */}
        <Card style={{ marginBottom: 24 }}>
          <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 16, marginBottom: 16 }}>
            Přehled po letech
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "'DM Mono', monospace", fontSize: 12 }}>
              <thead>
                <tr>
                  {["Rok", "Akcie", "Vl. jmění byt", "Hodnota bytu", "Dluh", "Splátka", "Nájem"].map((h, i) => (
                    <th key={h} style={{
                      textAlign: i === 0 ? "left" : "right",
                      padding: "0 8px 10px",
                      color: "#6b7280", fontWeight: 500,
                      borderBottom: "1px solid rgba(255,255,255,0.08)"
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.yearly.slice(1).filter((d) => years <= 15 || d.year % 2 === 0 || d.year === years).map((d) => (
                  <tr key={d.year} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                    <td style={{ padding: "8px", color: "#9ca3af" }}>{d.year}</td>
                    <td style={{ textAlign: "right", padding: "8px", color: "#60a5fa", fontWeight: 600 }}>{fmt(d.stock)}</td>
                    <td style={{ textAlign: "right", padding: "8px", color: "#fbbf24", fontWeight: 600 }}>{fmt(d.aptEquity)}</td>
                    <td style={{ textAlign: "right", padding: "8px", color: "#9ca3af" }}>{fmt(d.aptValue)}</td>
                    <td style={{ textAlign: "right", padding: "8px", color: "#f87171" }}>{fmt(d.loanBalance)}</td>
                    <td style={{ textAlign: "right", padding: "8px", color: "#9ca3af" }}>{fmt(d.mortgagePayment)}</td>
                    <td style={{ textAlign: "right", padding: "8px", color: "#9ca3af" }}>{fmt(d.rent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* insighty */}
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 16, marginBottom: 16
        }}>
          {[
            { icon: "⚡", title: "Likvidita", text: "Akcie prodáš za 1 den. Byt 3–6 měsíců + provize realitce 3–5 %.", color: "#60a5fa" },
            { icon: "🛡", title: "Jistota bydlení", text: "Vlastní byt = konec rizika výpovědi, růstu nájmu nebo špatného pronajímatele.", color: "#fbbf24" },
            { icon: "📉", title: "Volatilita", text: "Akcie mohou v krizi spadnout o 30–50 %. Byt je stabilnější, ale méně roste.", color: "#f87171" },
            { icon: "🔧", title: "Skryté náklady bytu", text: "Údržba, fond oprav, daň, pojištění, opravy. Reálně 1–1,5 % z hodnoty bytu ročně.", color: "#94a3b8" },
            { icon: "🎯", title: "Páka", text: "Hypotéka = páka. Investuješ celý byt z 10–20 % vlastních. To u akcií standardně neuděláš.", color: "#a78bfa" },
            { icon: "📊", title: "Diverzifikace", text: "Akcie = stovky firem napříč světem. Byt = jedna nemovitost na jednom místě.", color: "#34d399" },
          ].map((item) => (
            <div key={item.title} style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 16, padding: 18,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <span style={{ fontSize: 20 }}>{item.icon}</span>
                <span style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14, color: item.color }}>
                  {item.title}
                </span>
              </div>
              <p style={{ fontSize: 12.5, color: "#9ca3af", lineHeight: 1.55, margin: 0 }}>{item.text}</p>
            </div>
          ))}
        </div>

        <div style={{ textAlign: "center", padding: "16px 0 4px", fontSize: 11, color: "#374151", lineHeight: 1.6 }}>
          Kalkulace je ilustrativní. Výnosy v minulosti nezaručují budoucí výsledky.
          <br />
          Defaultní hodnoty vycházejí z dat ČR 2014–2026 (ČSÚ, ČNB, Hypoindex, MSCI World v CZK).
        </div>
      </div>
    </div>
  );
}

const Row = ({ label, value, valueColor }) => (
  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
    <span style={{ color: "#9ca3af" }}>{label}</span>
    <span style={{ color: valueColor || "#f0f0f0", fontWeight: 700 }}>{value}</span>
  </div>
);

const Stat = ({ icon, label, value, color }) => (
  <div>
    <div style={{ fontSize: 13, color: "#9ca3af", marginBottom: 6 }}>{icon} {label}</div>
    <div style={{ fontSize: 20, fontFamily: "'Syne', sans-serif", fontWeight: 700, color: color || "#f0f0f0" }}>
      {value}
    </div>
  </div>
);
