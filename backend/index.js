const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const { MongoClient } = require('mongodb');

const app = express();
const PORT = 5000;

const MONGO_URI = "mongodb://127.0.0.1:27017";
const DB_NAME = "dashboard_db";
let db;

// MongoDB Connection
MongoClient.connect(MONGO_URI, { useUnifiedTopology: true })
  .then(client => {
    db = client.db(DB_NAME);
    console.log("✅ Connected to MongoDB");
  })
  .catch(err => {
    console.error("❌ MongoDB connection failed:", err);
  });

app.use(cors());
app.use(express.json());

const upload = multer({ dest: 'uploads/' });

const statusList = [
  "all",
  "rto",
  "door_step_exchanged",
  "delivered",
  "cancelled",
  "ready_to_ship",
  "shipped",
  "supplier_listed_price",
  "supplier_discounted_price"
];

// ✅ Helper Functions
function parsePrice(value) {
  if (!value) return 0;
  let clean = value.toString().trim().replace(/[^0-9.\-]/g, '');
  return parseFloat(clean) || 0;
}

function getColumnValue(row, possibleNames) {
  const keys = Object.keys(row).map(k => k.toLowerCase().trim());
  for (let name of possibleNames) {
    let idx = keys.indexOf(name.toLowerCase().trim());
    if (idx !== -1) return row[Object.keys(row)[idx]];
  }
  return 0;
}

function categorizeRows(rows) {
  const categories = {};
  statusList.forEach(status => categories[status] = []);
  categories.other = [];

  let totalSupplierListedPrice = 0;
  let totalSupplierDiscountedPrice = 0;
  let sellInMonthProducts = 0;
  let totalProfit = 0;
  let deliveredSupplierDiscountedPriceTotal = 0;

  rows.forEach(row => {
    const status = (row['Reason for Credit Entry'] || '').toLowerCase().trim();
    categories["all"].push(row);

    const listedPrice = parsePrice(getColumnValue(row, [
      'Supplier Listed Price (Incl. GST + Commission)',
      'Supplier Listed Price',
      'Listed Price'
    ]));
    const discountedPrice = parsePrice(getColumnValue(row, [
      'Supplier Discounted Price (Incl GST and Commission)',
      'Supplier Discounted Price (Incl GST and Commision)',
      'Supplier Discounted Price',
      'Discounted Price'
    ]));

    totalSupplierListedPrice += listedPrice;
    totalSupplierDiscountedPrice += discountedPrice;
    totalProfit += listedPrice - discountedPrice;

    if (status.includes('delivered')) {
      sellInMonthProducts += 1;
      deliveredSupplierDiscountedPriceTotal += discountedPrice;
    }

    let matched = false;
    if (status.includes('rto_complete') || status.includes('rto_locked') || status.includes('rto_initiated')) {
      categories["rto"].push(row);
      matched = true;
    } else {
      statusList.forEach(s => {
        if (s !== "all" && s !== "rto" && status.includes(s)) {
          categories[s].push(row);
          matched = true;
        }
      });
    }

    if (!matched) categories.other.push(row);
  });

  categories.totals = {
    totalSupplierListedPrice,
    totalSupplierDiscountedPrice,
    sellInMonthProducts,
    totalProfit,
    deliveredSupplierDiscountedPriceTotal
  };

  return categories;
}

// ✅ Upload Endpoint
app.post('/upload', upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file uploaded' });

  const ext = path.extname(file.originalname).toLowerCase();
  let rows = [];

  try {
    if (ext === '.csv') {
      rows = [];
      fs.createReadStream(file.path)
        .pipe(csv())
        .on('data', data => rows.push(data))
        .on('end', async () => {
          fs.unlinkSync(file.path);
          await saveToDB(rows, res);
        });
    } else if (ext === '.xlsx' || ext === '.xls') {
      const workbook = XLSX.readFile(file.path);
      const sheetName = workbook.SheetNames[0];
      rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
      fs.unlinkSync(file.path);
      await saveToDB(rows, res);
    } else {
      fs.unlinkSync(file.path);
      return res.status(400).json({ error: 'Unsupported file format' });
    }
  } catch (error) {
    console.error("❌ Error processing file:", error);
    return res.status(500).json({ error: 'Failed to process file' });
  }
});

// ✅ Save to MongoDB
async function saveToDB(rows, res) {
  if (!db) return res.status(500).json({ message: "MongoDB not connected yet" });
  if (!rows || !rows.length) return res.status(400).json({ message: "No data to save" });

  const categorized = categorizeRows(rows);

  try {
    await db.collection("dashboard_data").insertOne({
      submittedAt: new Date(),
      data: rows,
      totals: categorized.totals
    });
    console.log("✅ Uploaded data inserted into MongoDB");
    return res.json(categorized);
  } catch (error) {
    console.error("❌ Error saving uploaded data to MongoDB:", error);
    return res.status(500).json({ message: "Failed to save data to MongoDB" });
  }
}

// ✅ Fixed Filter Endpoint
app.get('/filter/:subOrderNo', async (req, res) => {
  const subOrderNo = req.params.subOrderNo.trim().toLowerCase();
  if (!subOrderNo) return res.status(400).json({ error: "Sub Order No required" });

  try {
    // Get latest uploaded data
    const result = await db.collection("dashboard_data")
      .find()
      .sort({ submittedAt: -1 })
      .limit(1)
      .toArray();

    if (!result.length) return res.status(404).json({ error: "No data found" });

    const rows = result[0].data;

    // Try to find row where Sub Order No matches
    const match = rows.find(row => {
      // Look for possible "sub order no" column first
      const keys = Object.keys(row).map(k => k.toLowerCase());
      const subOrderKey = keys.find(k => k.includes("sub") && k.includes("order"));
      if (subOrderKey && row[subOrderKey] &&
        row[subOrderKey].toString().trim().toLowerCase() === subOrderNo) {
        return true;
      }

      // Fallback: search all values
      return Object.values(row).some(v =>
        v && v.toString().trim().toLowerCase() === subOrderNo
      );
    });

    if (!match) return res.status(404).json({ error: "Sub Order No not found" });

    // Extract prices
    const listedPrice = parsePrice(getColumnValue(match, [
      'Supplier Listed Price (Incl. GST + Commission)',
      'Supplier Listed Price',
      'Listed Price'
    ]));

    const discountedPrice = parsePrice(getColumnValue(match, [
      'Supplier Discounted Price (Incl GST and Commission)',
      'Supplier Discounted Price (Incl GST and Commision)',
      'Supplier Discounted Price',
      'Discounted Price'
    ]));

    res.json({
      subOrderNo,
      listedPrice,
      discountedPrice,
      profit: listedPrice - discountedPrice
    });

  } catch (err) {
    console.error("❌ Filter error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ✅ Profit Calculation
app.post('/calculate', (req, res) => {
  const { listedPrice, discountedPrice } = req.body;
  if (listedPrice === undefined || discountedPrice === undefined)
    return res.status(400).json({ error: 'Both prices are required' });

  const profit = listedPrice - discountedPrice;
  const profitPercent = discountedPrice !== 0 ? (profit / discountedPrice) * 100 : 0;
  res.json({ profit, profitPercent: profitPercent.toFixed(2) });
});

// ✅ Start Server
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
