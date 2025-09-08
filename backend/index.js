const express = require("express");
const multer = require("multer");
const XLSX = require("xlsx");
const csv = require("csv-parser");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const PDFDocument = require("pdfkit");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
  origin :"https://product-report-263j.vercel.app",
  methods :["GET","POST","PUT","DELETE"],
  credentials: true
}));
app.use(cors({
  origin : "*"
}))
app.use(express.json());
const upload = multer({ dest: "uploads/" });

// ===== In-memory storage =====
let latestData = null;

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
          saveData(rows, res);
        });
    } else if (ext === ".xlsx" || ext === ".xls") {
      const workbook = XLSX.readFile(file.path);
      const sheetName = workbook.SheetNames[0];
      rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
      fs.unlinkSync(file.path);
      saveData(rows, res);
    } else {
      fs.unlinkSync(file.path);
      return res.status(400).json({ error: "Unsupported file format" });
    }
  } catch (error) {
    console.error("❌ Error processing file:", error);
    return res.status(500).json({ error: "Failed to process file" });
  }
});

// ===== Save Data (in-memory) =====
function saveData(rows, res) {
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

  // Save in memory
  latestData = {
    submittedAt: new Date(),
    data: rows,
    totals: categorized.totals,
    categories: categorized,
    profitByDate: profitGraphArray,
  };

  console.log("✅ Data stored in memory");
  return res.json({ ...categorized, profitByDate: profitGraphArray });
}

// ===== Profit Graph API =====
app.get("/profit-graph", (req, res) => {
  if (!latestData) return res.status(404).json({ error: "No data found" });
  res.json(latestData.profitByDate || []);
});

// ===== Filter API =====
app.get("/filter/:subOrderNo", (req, res) => {
  if (!latestData) return res.status(404).json({ error: "No data found" });

  const subOrderNo = req.params.subOrderNo.trim().toLowerCase();
  const rows = latestData.data;

  const match = rows.find((row) => {
    const keys = Object.keys(row).map((k) => k.toLowerCase());
    const subOrderKey = keys.find((k) => k.includes("sub") && k.includes("order"));
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
});

// ===== PDF Download API =====
function formatINR(n) {
  const num = Number(n) || 0;
  return "₹" + num.toLocaleString("en-IN");
}

app.get("/download-pdf", (req, res) => {
  if (!latestData) return res.status(404).json({ error: "No data found" });

  const categorized = latestData.categories || {};
  const totals = latestData.totals || {};
  const profitByDate = Array.isArray(latestData.profitByDate)
    ? [...latestData.profitByDate]
    : [];

  profitByDate.sort((a, b) => (a.date > b.date ? 1 : a.date < b.date ? -1 : 0));

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", "attachment; filename=dashboard-report.pdf");

  const doc = new PDFDocument({ margin: 40, size: "A4" });
  doc.pipe(res);

  doc.fontSize(18).font("Helvetica-Bold").text("📊 Dashboard Report", { align: "center" });
  doc.moveDown(0.5);
  doc.fontSize(10).font("Helvetica").text(`Generated: ${new Date().toLocaleString()}`, { align: "center" });
  doc.moveDown(1.5);

  doc.font("Helvetica-Bold").fontSize(12).text("Summary Metrics");
  doc.moveDown(0.5);

  const metrics = {
    "All Orders": (categorized.all || []).length || 0,
    "RTO": (categorized.rto || []).length || 0,
    "Door Step Exchanged": (categorized.door_step_exchanged || []).length || 0,
    "Delivered (count / discounted total)":
      `${totals?.sellInMonthProducts || 0} /${formatINR(totals?.deliveredSupplierDiscountedPriceTotal || 0)}`,
    "Cancelled": (categorized.cancelled || []).length || 0,
    "Pending": (categorized.ready_to_ship || []).length || 0,
    "Shipped": (categorized.shipped || []).length || 0,
    "Other": (categorized.other || []).length || 0,
    "Supplier Listed Total Price": formatINR(totals?.totalSupplierListedPrice || 0),
    "Supplier Discounted Total Price": formatINR(totals?.totalSupplierDiscountedPrice || 0),
    "Total Profit": formatINR(totals?.totalProfit || 0),
    "Profit %": `${totals?.profitPercent || "0.00"}%`,
  };

  Object.entries(metrics).forEach(([k, v]) => {
    doc.text(`${k}: ${v}`);
  });

  doc.moveDown(2);
  doc.font("Helvetica-Bold").fontSize(12).text("Profit By Date");
  profitByDate.forEach((p) => {
    doc.text(`${p.date}: ${formatINR(p.profit || 0)}`);
  });

  doc.end();
});

// ===== Start Server =====
app.listen(PORT, () =>
  console.log(`🚀 Server running on http://localhost:${PORT}`)
);
