export interface LabelBatch {
  batchNumber: string;
  medicineName: string;
  /** Any date string the Date constructor reads, for example 2028-11-01. */
  expiryDate: string;
}

export interface LabelRow { sscc: string; uid: string; secret: string }

/** Largest batch printed as a PDF in the browser; bigger batches use the CSV in the label printing software. */
export const MAX_PDF_LABELS = 2000;

const PAGE = { width: 210, height: 297 };
const LABEL = { width: 70, height: 37, columns: 3, rows: 7, top: 12 };
const PER_PAGE = LABEL.columns * LABEL.rows;

/** Reads the CSV of the labels endpoint: a header line, then `sscc,uid,secret_code` per box. */
export function parseLabelCsv(csv: string): LabelRow[] {
  return csv.split(/\r?\n/).slice(1).filter(line => line.trim()).map(line => {
    const [sscc = '', uid = '', secret = ''] = line.split(',');
    return { sscc: sscc.trim(), uid: uid.trim(), secret: secret.trim() };
  });
}

/**
 * The link in a QR code. The outer box label carries only the box UID, so anyone can read the history. The label under
 * the scratch layer also carries the secret code, so scanning it verifies the box as genuine. The data sits in the URL
 * fragment, which the browser never sends to a server.
 */
export function traceLink(origin: string, uid: string, secret?: string): string {
  return `${origin}/trace#uid=${uid}${secret ? `&code=${secret}` : ''}`;
}

/** Drops a trailing "(15 Blisters x 12 Tablets)" so the medicine name fits three lines of a label. */
export function shortMedicineName(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*$/, '').trim() || name;
}

interface Sheet { title: string; labels: { draw: (x: number, y: number) => void }[] }

/**
 * A printable PDF for one batch, three sections on 70 x 37 mm label sheets (3 x 7 per A4 page):
 * 1. one label per carton with the SSCC as a QR code,
 * 2. one label per box with the QR code to stick on the box,
 * 3. one label per box for under the scratch layer: a QR code that verifies the box and the secret code as text for typing,
 *    in the same order as section 2.
 */
export async function buildBatchLabelPdf(batch: LabelBatch, rows: LabelRow[], origin: string): Promise<Blob> {
  const [{ jsPDF }, QRCode] = await Promise.all([import('jspdf'), import('qrcode')]);
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const expiry = new Date(batch.expiryDate).toLocaleDateString('en-GB');
  // QR codes are drawn as vector squares: a few hundred rectangles per code keep a PDF of thousands of labels small.
  const drawQr = (text: string, x: number, y: number, size: number) => {
    const modules = QRCode.create(text, { errorCorrectionLevel: 'M' }).modules;
    const count = modules.size;
    const cell = size / count;
    pdf.setFillColor(0, 0, 0);
    for (let row = 0; row < count; row++) {
      for (let column = 0; column < count; column++) if (modules.get(row, column)) pdf.rect(x + column * cell, y + row * cell, cell + 0.02, cell + 0.02, 'F');
    }
  };

  const cartons = [...new Set(rows.map(row => row.sscc).filter(Boolean))];
  const boxesIn = (sscc: string) => rows.filter(row => row.sscc === sscc).length;

  const sheets: Sheet[] = [
    {
      title: `Carton labels - batch ${batch.batchNumber}`,
      labels: cartons.map(sscc => ({
        draw: (x, y) => {
          drawQr(sscc, x + 3, y + 5, 27);
          pdf.setFont('helvetica', 'bold').setFontSize(8).text('CARTON', x + 34, y + 9);
          pdf.setFont('helvetica', 'normal').setFontSize(7);
          pdf.text(`SSCC ${sscc}`, x + 34, y + 14, { maxWidth: 34 });
          pdf.text(`Batch ${batch.batchNumber}`, x + 34, y + 23, { maxWidth: 34 });
          pdf.text(`${boxesIn(sscc)} boxes`, x + 34, y + 27);
          pdf.text(`Exp ${expiry}`, x + 34, y + 31);
        },
      })),
    },
    {
      title: `Box labels - batch ${batch.batchNumber}`,
      labels: rows.map(row => ({
        draw: (x, y) => {
          drawQr(traceLink(origin, row.uid), x + 3, y + 5, 27);
          pdf.setFont('helvetica', 'bold').setFontSize(7).text(pdf.splitTextToSize(shortMedicineName(batch.medicineName), 34).slice(0, 3), x + 34, y + 8);
          pdf.setFont('helvetica', 'normal').setFontSize(7);
          pdf.text(`Batch ${batch.batchNumber}`, x + 34, y + 21, { maxWidth: 34 });
          pdf.text(`Exp ${expiry}`, x + 34, y + 25);
          pdf.setFontSize(6).text(`ID ${row.uid.slice(0, 8)}`, x + 34, y + 29);
          pdf.text('Scan to check', x + 34, y + 32);
        },
      })),
    },
    {
      title: `Secret codes (under the scratch layer) - batch ${batch.batchNumber}`,
      labels: rows.map(row => ({
        draw: (x, y) => {
          drawQr(traceLink(origin, row.uid, row.secret), x + 3, y + 5, 27);
          pdf.setFont('helvetica', 'bold').setFontSize(8).text('SECRET CODE', x + 34, y + 9);
          pdf.setFont('courier', 'normal').setFontSize(6.5);
          for (let line = 0; line < 4; line++) pdf.text(row.secret.slice(line * 16, line * 16 + 16), x + 34, y + 14 + line * 3.6);
          pdf.setFont('helvetica', 'normal').setFontSize(6);
          pdf.text('Scan to verify, or type the', x + 34, y + 30);
          pdf.text(`4 lines. Box ID ${row.uid.slice(0, 8)}`, x + 34, y + 33);
        },
      })),
    },
  ];

  let firstPage = true;
  for (const sheet of sheets) {
    for (let start = 0; start < sheet.labels.length; start += PER_PAGE) {
      if (!firstPage) pdf.addPage();
      firstPage = false;
      pdf.setFont('helvetica', 'normal').setFontSize(8).setTextColor(90);
      pdf.text(`${sheet.title} - page ${start / PER_PAGE + 1} of ${Math.ceil(sheet.labels.length / PER_PAGE)}`, PAGE.width / 2, PAGE.height - 8, { align: 'center' });
      pdf.setTextColor(0);
      for (const [index, label] of sheet.labels.slice(start, start + PER_PAGE).entries()) {
        const x = (index % LABEL.columns) * LABEL.width;
        const y = LABEL.top + Math.floor(index / LABEL.columns) * LABEL.height;
        pdf.setDrawColor(200).setLineWidth(0.1).rect(x + 0.5, y + 0.5, LABEL.width - 1, LABEL.height - 1);
        label.draw(x, y);
      }
    }
  }
  return pdf.output('blob');
}
