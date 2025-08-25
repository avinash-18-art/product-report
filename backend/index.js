const express = require("express");
const multer = require("multer");
const XLSX = require("xlsx");
const csv = require("csv-parser");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const { MongoClient } = require("mongodb");
const PDFDocument = require("pdfkit");

const app = express();
const PORT = 5000;
const MONGO_URI = "mongodb://127.0.0.1:27017";
const DB_NAME = "dashboard_db";
let db;

// ===== MongoDB connection =====
MongoClient.connect(MONGO_URI, { useUnifiedTopology: true })
  .then((client) => {
    db = client.db(DB_NAME);
    console.log("✅ Connected to MongoDB");
  })
  .catch((err) => {
    console.error("❌ MongoDB connection failed:", err);
  });

app.use(cors());
app.use(express.json());
const upload = multer({ dest: "uploads/" });

// ===== Status list =====
const statusList = [
  "all",
  "rto",
  "door_step_exchanged",
  "delivered",
  "cancelled",
  "ready_to_ship",
  "shipped",
  "supplier_listed_price",
  "supplier_discounted_price",
];

// ===== Helpers =====
function parsePrice(value) {
  if (!value) return 0;
  const clean = value.toString().trim().replace(/[^0-9.\-]/g, "");
  return parseFloat(clean) || 0;
}

function getColumnValue(row, possibleNames) {
  const keys = Object.keys(row).map((k) => k.toLowerCase().trim());
  for (let name of possibleNames) {
    const idx = keys.indexOf(name.toLowerCase().trim());
    if (idx !== -1) return row[Object.keys(row)[idx]];
  }
  return 0;
}

function categorizeRows(rows) {
  const categories = {};
  statusList.forEach((status) => (categories[status] = []));
  categories.other = [];

  let totalSupplierListedPrice = 0;
  let totalSupplierDiscountedPrice = 0;
  let sellInMonthProducts = 0;
  let deliveredSupplierDiscountedPriceTotal = 0;
  let totalDoorStepExchanger = 0;

  rows.forEach((row) => {
    const status = (row["Reason for Credit Entry"] || "").toLowerCase().trim();
    categories["all"].push(row);

    const listedPrice = parsePrice(
      getColumnValue(row, [
        "Supplier Listed Price (Incl. GST + Commission)",
        "Supplier Listed Price",
        "Listed Price",
      ])
    );

    const discountedPrice = parsePrice(
      getColumnValue(row, [
        "Supplier Discounted Price (Incl GST and Commission)",
        "Supplier Discounted Price (Incl GST and Commision)",
        "Supplier Discounted Price",
        "Discounted Price",
      ])
    );

    totalSupplierListedPrice += listedPrice;
    totalSupplierDiscountedPrice += discountedPrice;

    if (status.includes("delivered")) {
      sellInMonthProducts += 1;
      deliveredSupplierDiscountedPriceTotal += discountedPrice;
    }

    if (status.includes("door_step_exchanged")) {
      totalDoorStepExchanger += 80;
    }

    let matched = false;
    if (
      status.includes("rto_complete") ||
      status.includes("rto_locked") ||
      status.includes("rto_initiated")
    ) {
      categories["rto"].push(row);
      matched = true;
    } else {
      statusList.forEach((s) => {
        if (s !== "all" && s !== "rto" && status.includes(s)) {
          categories[s].push(row);
          matched = true;
        }
      });
    }

    if (!matched) categories.other.push(row);
  });

  const totalProfit =
    deliveredSupplierDiscountedPriceTotal - sellInMonthProducts * 500;

  const profitPercent =
    sellInMonthProducts !== 0
      ? (totalProfit / (sellInMonthProducts * 500)) * 100
      : 0;

  categories.totals = {
    totalSupplierListedPrice,
    totalSupplierDiscountedPrice,
    sellInMonthProducts,
    deliveredSupplierDiscountedPriceTotal,
    totalDoorStepExchanger,
    totalProfit,
    profitPercent: profitPercent.toFixed(2),
  };

  return categories;
}

// ===== File upload =====
app.post("/upload", upload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: "No file uploaded" });

  const ext = path.extname(file.originalname).toLowerCase();
  let rows = [];

  try {
    if (ext === ".csv") {
      fs.createReadStream(file.path)
        .pipe(csv())
        .on("data", (data) => rows.push(data))
        .on("end", async () => {
          fs.unlinkSync(file.path);
          await saveToDB(rows, res);
        });
    } else if (ext === ".xlsx" || ext === ".xls") {
      const workbook = XLSX.readFile(file.path);
      const sheetName = workbook.SheetNames[0];
      rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
      fs.unlinkSync(file.path);
      await saveToDB(rows, res);
    } else {
      fs.unlinkSync(file.path);
      return res.status(400).json({ error: "Unsupported file format" });
    }
  } catch (error) {
    console.error("❌ Error processing file:", error);
    return res.status(500).json({ error: "Failed to process file" });
  }
});

// ===== Save to DB =====
async function saveToDB(rows, res) {
  if (!db) return res.status(500).json({ message: "MongoDB not connected yet" });
  if (!rows || !rows.length)
    return res.status(400).json({ message: "No data to save" });

  const categorized = categorizeRows(rows);

  // build profit by date
  const profitByDate = {};
  rows.forEach((row) => {
    const status = (row["Reason for Credit Entry"] || "").toLowerCase().trim();
    if (!status.includes("delivered")) return;

    const dateKey =
      row["Order Date"] ||
      row["Date"] ||
      row["Created At"] ||
      row["Delivered Date"];
    if (!dateKey) return;

    const date = new Date(dateKey).toISOString().split("T")[0];

    const discountedPrice = parsePrice(
      getColumnValue(row, [
        "Supplier Discounted Price (Incl GST and Commission)",
        "Supplier Discounted Price (Incl GST and Commision)",
        "Supplier Discounted Price",
        "Discounted Price",
      ])
    );

    if (!profitByDate[date]) {
      profitByDate[date] = { total: 0, count: 0 };
    }

    profitByDate[date].total += discountedPrice;
    profitByDate[date].count += 1;
  });

  const profitGraphArray = Object.keys(profitByDate).map((date) => {
    const { total, count } = profitByDate[date];
    return {
      date,
      profit: total - count * 500,
    };
  });

  try {
    await db.collection("dashboard_data").insertOne({
      submittedAt: new Date(),
      data: rows,
      totals: categorized.totals,
      categories: categorized,
      profitByDate: profitGraphArray,
    });
    console.log("✅ Uploaded data inserted into MongoDB with profit graph");
    return res.json({ ...categorized, profitByDate: profitGraphArray });
  } catch (error) {
    console.error("❌ Error saving uploaded data to MongoDB:", error);
    return res.status(500).json({ message: "Failed to save data to MongoDB" });
  }
}

// ===== Profit Graph API =====
app.get("/profit-graph", async (req, res) => {
  try {
    const result = await db
      .collection("dashboard_data")
      .find()
      .sort({ submittedAt: -1 })
      .limit(1)
      .toArray();

    if (!result.length) return res.status(404).json({ error: "No data found" });

    const graphData = result[0].profitByDate || [];
    res.json(graphData);
  } catch (err) {
    console.error("❌ Profit graph error:", err);
    res.status(500).json({ error: "Failed to generate profit graph data" });
  }
});

// ===== Filter API =====
app.get("/filter/:subOrderNo", async (req, res) => {
  const subOrderNo = req.params.subOrderNo.trim().toLowerCase();
  if (!subOrderNo) return res.status(400).json({ error: "Sub Order No required" });

  try {
    const result = await db
      .collection("dashboard_data")
      .find()
      .sort({ submittedAt: -1 })
      .limit(1)
      .toArray();

    if (!result.length) return res.status(404).json({ error: "No data found" });

    const rows = result[0].data;

    const match = rows.find((row) => {
      const keys = Object.keys(row).map((k) => k.toLowerCase());
      const subOrderKey = keys.find(
        (k) => k.includes("sub") && k.includes("order")
      );
      if (
        subOrderKey &&
        row[subOrderKey] &&
        row[subOrderKey].toString().trim().toLowerCase() === subOrderNo
      ) {
        return true;
      }

      return Object.values(row).some(
        (v) => v && v.toString().trim().toLowerCase() === subOrderNo
      );
    });

    if (!match) return res.status(404).json({ error: "Sub Order No not found" });

    const listedPrice = parsePrice(
      getColumnValue(match, [
        "Supplier Listed Price (Incl. GST + Commission)",
        "Supplier Listed Price",
        "Listed Price",
      ])
    );

    const discountedPrice = parsePrice(
      getColumnValue(match, [
        "Supplier Discounted Price (Incl GST and Commission)",
        "Supplier Discounted Price (Incl GST and Commision)",
        "Supplier Discounted Price",
        "Discounted Price",
      ])
    );

    res.json({
      subOrderNo,
      listedPrice,
      discountedPrice,
      profit: 500 - discountedPrice,
    });
  } catch (err) {
    console.error("❌ Filter error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ===== PDF Helpers ===== */
function formatINR(n) {
  const num = Number(n) || 0;
  return "₹" + num.toLocaleString("en-IN");
}

function drawTable(doc, { headers, rows }, options = {}) {
  const {
    startX = 60,
    startY = 120,
    colWidths = [],
    rowHeight = 26,
    headerHeight = 28,
    maxY = doc.page.height - 60,
    headerFont = "Helvetica-Bold",
    rowFont = "Helvetica",
    fontSize = 10,
    cellPaddingX = 8,
  } = options;

  const cols = headers.length;
  const widths =
    colWidths.length === cols
      ? colWidths
      : Array(cols).fill(Math.floor((doc.page.width - startX * 2) / cols));

  let y = startY;

  function maybeAddPage(nextRowHeight) {
    if (y + nextRowHeight > maxY) {
      doc.addPage();
      y = 60; // top margin on new page
    }
  }

  // Header
  doc.font(headerFont).fontSize(fontSize);
  maybeAddPage(headerHeight);
  let x = startX;
  for (let c = 0; c < cols; c++) {
    doc.rect(x, y, widths[c], headerHeight).stroke();
    doc.text(String(headers[c]), x + cellPaddingX, y + 8, {
      width: widths[c] - cellPaddingX * 2,
      ellipsis: true,
    });
    x += widths[c];
  }
  y += headerHeight;

  // Rows
  doc.font(rowFont).fontSize(fontSize);
  rows.forEach((row) => {
    maybeAddPage(rowHeight);
    let x = startX;
    for (let c = 0; c < cols; c++) {
      doc.rect(x, y, widths[c], rowHeight).stroke();
      doc.text(String(row[c] ?? ""), x + cellPaddingX, y + 7, {
        width: widths[c] - cellPaddingX * 2,
        ellipsis: true,
      });
      x += widths[c];
    }
    y += rowHeight;
  });

  return y; // last Y position
}

// ===== PDF Download API WITH Profit-By-Date Table =====
app.get("/download-pdf", async (req, res) => {
  try {
    const result = await db
      .collection("dashboard_data")
      .find()
      .sort({ submittedAt: -1 })
      .limit(1)
      .toArray();

    if (!result.length) return res.status(404).json({ error: "No data found" });

    const latest = result[0];
    const categorized = latest.categories || {};
    const totals = latest.totals || {};
    const profitByDate = Array.isArray(latest.profitByDate)
      ? [...latest.profitByDate]
      : [];

    // sort dates ascending for table
    profitByDate.sort((a, b) => (a.date > b.date ? 1 : a.date < b.date ? -1 : 0));

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=dashboard-report.pdf"
    );

    const doc = new PDFDocument({ margin: 40, size: "A4" });
    doc.pipe(res);

    // Title + meta
    doc
      .fontSize(18)
      .font("Helvetica-Bold")
      .text("📊 Dashboard Report", { align: "center" });
    doc.moveDown(0.5);
    doc
      .fontSize(10)
      .font("Helvetica")
      .text(`Generated: ${new Date().toLocaleString()}`, { align: "center" });
    doc.moveDown(1.5);

    // ===== Metrics Table (2 columns) =====
    doc.font("Helvetica-Bold").fontSize(12).text("Summary Metrics");
    doc.moveDown(0.5);

    const tableTop = doc.y + 6;
    const cellHeight = 26;
    const col1X = 60;
    const col2X = 360;
    const col1Width = 300;
    const col2Width = 160;

    // Header row
    doc.rect(col1X, tableTop, col1Width, cellHeight).stroke();
    doc.rect(col2X, tableTop, col2Width, cellHeight).stroke();

    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .text("Metric", col1X + 8, tableTop + 8)
      .text("Value", col2X + 8, tableTop + 8);

    const metrics = {
      "All Orders": (categorized.all || []).length || 0,
      "RTO": (categorized.rto || []).length || 0,
      "Door Step Exchanged": (categorized.door_step_exchanged || []).length || 0,
      "Delivered (count / discounted total)":
        `${totals?.sellInMonthProducts || 0} /${formatINR(
          totals?.deliveredSupplierDiscountedPriceTotal || 0
        )}`,
      "Cancelled": (categorized.cancelled || []).length || 0,
      "Pending": (categorized.ready_to_ship || []).length || 0,
      "Shipped": (categorized.shipped || []).length || 0,
      "Other": (categorized.other || []).length || 0,
      "Supplier Listed Total Price": formatINR(totals?.totalSupplierListedPrice || 0),
      "Supplier Discounted Total Price": formatINR(
        totals?.totalSupplierDiscountedPrice || 0
      ),
      "Total Profit": formatINR(totals?.totalProfit || 0),
      "Profit %": `${totals?.profitPercent || "0.00"}%`,
    };

    doc.font("Helvetica").fontSize(10);
    let rowIndex = 0;
    let y = tableTop + cellHeight;

    const bottomMargin = doc.page.height - 60;

    for (const [key, value] of Object.entries(metrics)) {
      // page break if needed
      if (y + cellHeight > bottomMargin) {
        doc.addPage();
        y = 60;

        // redraw header on new page
        doc.rect(col1X, y, col1Width, cellHeight).stroke();
        doc.rect(col2X, y, col2Width, cellHeight).stroke();
        doc
          .font("Helvetica-Bold")
          .text("Metric", col1X + 8, y + 8)
          .text("Value", col2X + 8, y + 8);
        y += cellHeight;
        doc.font("Helvetica");
      }

      doc.rect(col1X, y, col1Width, cellHeight).stroke();
      doc.rect(col2X, y, col2Width, cellHeight).stroke();

      doc.text(key, col1X + 8, y + 8, { width: col1Width - 16, ellipsis: true });
      doc.text(String(value), col2X + 8, y + 8, {
        width: col2Width - 16,
        ellipsis: true,
      });

      y += cellHeight;
      rowIndex++;
    }

    doc.moveDown(2);

    // ===== Profit By Date Table =====
    doc.font("Helvetica-Bold").fontSize(12).text("Profit By Date");
    doc.moveDown(0.5);

    const headers = ["Date", "Profit"];
    const rows = profitByDate.map((p) => [p.date, formatINR(p.profit || 0)]);

    // If empty, still show an empty table
    const tableData = {
      headers,
      rows: rows.length ? rows : [["—", "—"]],
    };

    drawTable(doc, tableData, {
      startX: 60,
      startY: doc.y + 6,
      colWidths: [200, 140],
      rowHeight: 24,
      headerHeight: 26,
      maxY: doc.page.height - 60,
      fontSize: 10,
    });

    doc.end();
  } catch (err) {
    console.error("❌ PDF generation error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to generate PDF" });
    }
  }
});

// ===== Start Server =====
app.listen(PORT, () =>
  console.log(`🚀 Server running on http://localhost:${PORT}`)
);
