export type PrepaidCardPrintItem = {
  cardnum: string;
  password: string;
  packageName: string;
  speedLabel?: string;
  validityLabel?: string;
  priceLabel?: string;
  instructions?: string;
};

export type PrepaidPrintOptions = {
  companyName: string;
  showPrice: boolean;
  showQr: boolean;
  layout: "a4-8" | "a4-6" | "a4-4";
  cards: PrepaidCardPrintItem[];
  labels: {
    package: string;
    username: string;
    password: string;
    speed: string;
    validity: string;
    price: string;
    instructions: string;
  };
};

function layoutGrid(layout: PrepaidPrintOptions["layout"]): string {
  switch (layout) {
    case "a4-4":
      return "grid-template-columns: repeat(2, 1fr);";
    case "a4-6":
      return "grid-template-columns: repeat(3, 1fr);";
    case "a4-8":
    default:
      return "grid-template-columns: repeat(4, 1fr);";
  }
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function buildPrepaidCardsPrintHtml(opts: PrepaidPrintOptions): string {
  const grid = layoutGrid(opts.layout);
  const cardsHtml = opts.cards
    .map((c) => {
      const qr =
        opts.showQr && c.cardnum
          ? `<img class="qr" src="https://api.qrserver.com/v1/create-qr-code/?size=72x72&amp;data=${encodeURIComponent(c.cardnum)}" alt="" />`
          : "";
      return `<article class="card">
        <div class="brand">${escapeHtml(opts.companyName)}</div>
        <div class="pkg">${escapeHtml(opts.labels.package)}: <strong>${escapeHtml(c.packageName)}</strong></div>
        <div class="row"><span>${escapeHtml(opts.labels.username)}</span><strong dir="ltr">${escapeHtml(c.cardnum)}</strong></div>
        <div class="row"><span>${escapeHtml(opts.labels.password)}</span><strong dir="ltr">${escapeHtml(c.password)}</strong></div>
        ${c.speedLabel ? `<div class="row"><span>${escapeHtml(opts.labels.speed)}</span><strong>${escapeHtml(c.speedLabel)}</strong></div>` : ""}
        ${c.validityLabel ? `<div class="row"><span>${escapeHtml(opts.labels.validity)}</span><strong>${escapeHtml(c.validityLabel)}</strong></div>` : ""}
        ${opts.showPrice && c.priceLabel ? `<div class="row price"><span>${escapeHtml(opts.labels.price)}</span><strong>${escapeHtml(c.priceLabel)}</strong></div>` : ""}
        ${qr}
        <p class="hint">${escapeHtml(c.instructions ?? opts.labels.instructions)}</p>
      </article>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(opts.companyName)}</title>
  <style>
    @page { size: A4; margin: 8mm; }
    * { box-sizing: border-box; }
    body { font-family: "Segoe UI", Tahoma, Arial, sans-serif; margin: 0; padding: 8mm; direction: rtl; color: #111; }
    h1 { font-size: 14px; text-align: center; margin: 0 0 8px; }
    .grid { display: grid; ${grid} gap: 6px; }
    .card { border: 1px dashed #444; border-radius: 8px; padding: 8px 10px; min-height: 120px; break-inside: avoid; position: relative; font-size: 11px; line-height: 1.35; }
    .brand { font-weight: 700; font-size: 12px; margin-bottom: 4px; text-align: center; }
    .pkg { margin-bottom: 6px; font-size: 10px; }
    .row { display: flex; justify-content: space-between; gap: 6px; margin: 2px 0; }
    .row span { opacity: 0.75; }
    .row strong { text-align: left; word-break: break-all; }
    .price strong { color: #0d6b3a; }
    .qr { position: absolute; left: 8px; bottom: 8px; width: 48px; height: 48px; }
    .hint { margin: 6px 0 0; font-size: 9px; opacity: 0.8; }
  </style>
</head>
<body>
  <h1>${escapeHtml(opts.companyName)}</h1>
  <div class="grid">${cardsHtml}</div>
  <script>window.onload = function(){ window.print(); };</script>
</body>
</html>`;
}
