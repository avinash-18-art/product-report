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

  // Profit definition
  const totalProfit =
    deliveredSupplierDiscountedPriceTotal - sellInMonthProducts * 500;

  // ✅ Match dashboard: profit % relative to (sellInMonthProducts * 500)
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
    profitPercent: profitPercent.toFixed(2), // as string, like dashboard shows
  };

  return categories;
}

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

async function saveToDB(rows, res) {
  if (!db) return res.status(500).json({ message: "MongoDB not connected yet" });
  if (!rows || !rows.length)
    return res.status(400).json({ message: "No data to save" });

  const categorized = categorizeRows(rows);

  try {
    await db.collection("dashboard_data").insertOne({
      submittedAt: new Date(),
      data: rows,
      totals: categorized.totals,
      categories: categorized,
    });
    console.log("✅ Uploaded data inserted into MongoDB");
    return res.json(categorized);
  } catch (error) {
    console.error("❌ Error saving uploaded data to MongoDB:", error);
    return res.status(500).json({ message: "Failed to save data to MongoDB" });
  }
}

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

app.post("/calculate", (req, res) => {
  const { listedPrice, discountedPrice } = req.body;
  if (listedPrice === undefined || discountedPrice === undefined)
    return res.status(400).json({ error: "Both prices are required" });

  const profit = 500 - discountedPrice;

  // ✅ Match dashboard definition here too
  const profitPercent = (profit / 500) * 100;

  res.json({ profit, profitPercent: profitPercent.toFixed(2) });
});

app.get("/download", async (req, res) => {
  try {
    const result = await db
      .collection("dashboard_data")
      .find()
      .sort({ submittedAt: -1 })
      .limit(1)
      .toArray();

    if (!result.length) {
      return res.status(404).json({ error: "No data found" });
    }

    // ✅ Use stored categories & totals EXACTLY as saved at upload time
    const categorized = result[0].categories || {};
    const totals = result[0].totals || {};

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=dashboard-report.pdf"
    );

    const doc = new PDFDocument({ margin: 40, size: "A4" });
    doc.pipe(res);

    doc
      .fontSize(18)
      .font("Helvetica-Bold")
      .text("Dashboard Report", { align: "center" });
    doc.moveDown(2);

    const tableTop = 120;
    const cellHeight = 30;
    const col1X = 60;
    const col2X = 350;
    const col1Width = 290;
    const col2Width = 150;

    doc.rect(col1X, tableTop, col1Width, cellHeight).stroke();
    doc.rect(col2X, tableTop, col2Width, cellHeight).stroke();

    doc
      .fontSize(12)
      .font("Helvetica-Bold")
      .text("Metric", col1X + 10, tableTop + 10)
      .text("Value", col2X + 10, tableTop + 10);

    const metrics = {
      "All Orders": (categorized.all || []).length || 0,
      "RTO": (categorized.rto || []).length || 0,
      "Door Step Exchanged": (categorized.door_step_exchanged || []).length || 0,
      "Delivered": `${totals?.sellInMonthProducts || 0} (₹${totals?.deliveredSupplierDiscountedPriceTotal || 0})`,
      "Cancelled": (categorized.cancelled || []).length || 0,
      "Pending": (categorized.ready_to_ship || []).length || 0,
      "Shipped": (categorized.shipped || []).length || 0,
      "Other": (categorized.other || []).length || 0,
      "Supplier Listed Total Price": totals?.totalSupplierListedPrice || 0,
      "Supplier Discounted Total Price": totals?.totalSupplierDiscountedPrice || 0,
      "Total Profit": totals?.totalProfit || 0,
      // ✅ This is the SAME value computed at upload time with the dashboard formula
      "Profit %": `${totals?.profitPercent || "0.00"}%`,
    };

    doc.font("Helvetica");
    Object.entries(metrics).forEach(([key, value], index) => {
      const y = tableTop + cellHeight * (index + 1);

      doc.rect(col1X, y, col1Width, cellHeight).stroke();
      doc.rect(col2X, y, col2Width, cellHeight).stroke();

      doc.text(key, col1X + 10, y + 10);
      doc.text(String(value), col2X + 10, y + 10);
    });

    doc.end();
  } catch (err) {
    console.error("❌ PDF generation error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to generate PDF" });
    }
  }
});

app.listen(PORT, () =>
  console.log(`🚀 Server running on http://localhost:${PORT}`)
);
