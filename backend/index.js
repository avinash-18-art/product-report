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

// MongoDB Config
const MONGO_URI = "mongodb://127.0.0.1:27017";
const DB_NAME = "dashboard_db";
let db;

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

let uploadedData = [];

// Status categories
const statusList = [
  "all",
  "rto_complete",
  "door_step_exchanged",
  "delivered",
  "cancelled",
  "rto_locked",
  "ready_to_ship",
  "shipped",
  "rto_initiated",
  "supplier_listed_price",
  "supplier_discounted_price"
];

function parsePrice(value) {
  if (!value) return 0;
  let clean = value.toString().trim().replace(/[^0-9.\-]/g, '');
  return parseFloat(clean) || 0;
}

function getColumnValue(row, possibleNames) {
  const keys = Object.keys(row).map(k => k.toLowerCase().trim());
  for (let name of possibleNames) {
    let idx = keys.indexOf(name.toLowerCase().trim());
    if (idx !== -1) {
      return row[Object.keys(row)[idx]];
    }
  }
  return 0;
}

// Categorize & calculate totals
function categorizeRows(rows) {
  const categories = {};
  statusList.forEach(status => {
    categories[status] = [];
  });
  categories.other = [];

  let totalSupplierListedPrice = 0;
  let totalSupplierDiscountedPrice = 0;
  let sellInMonthProducts = 0;
  let totalProfit = 0;

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
    totalProfit += (listedPrice - discountedPrice);

    if (status.includes('delivered')) {
      sellInMonthProducts += 1;
    }

    let matched = false;
    statusList.forEach(s => {
      if (s !== "all" && status.includes(s)) {
        categories[s].push(row);
        matched = true;
      }
    });

    if (!matched) {
      categories.other.push(row);
    }
  });

  categories.totals = {
    totalSupplierListedPrice,
    totalSupplierDiscountedPrice,
    sellInMonthProducts,
    totalProfit
  };

  return categories;
}

// File upload API
app.post('/upload', upload.single('file'), (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file uploaded' });

  const ext = path.extname(file.originalname).toLowerCase();

  if (ext === '.csv') {
    const results = [];
    fs.createReadStream(file.path)
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', () => {
        fs.unlinkSync(file.path);
        uploadedData = results;
        res.json(categorizeRows(results));
      });
  } else if (ext === '.xlsx' || ext === '.xls') {
    const workbook = XLSX.readFile(file.path);
    const sheetName = workbook.SheetNames[0];
    const jsonData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
    fs.unlinkSync(file.path);
    uploadedData = jsonData;
    res.json(categorizeRows(jsonData));
  } else {
    fs.unlinkSync(file.path);
    res.status(400).json({ error: 'Unsupported file format' });
  }
});

// Search specific order
app.get('/filter/:subOrderNo', (req, res) => {
  const subOrderNo = req.params.subOrderNo.trim().toLowerCase();

  if (!uploadedData.length) {
    return res.status(400).json({ error: 'No file uploaded yet' });
  }

  const match = uploadedData.find(row => {
    const val = Object.values(row).find(v =>
      v && v.toString().trim().toLowerCase() === subOrderNo
    );
    return Boolean(val);
  });

  if (!match) {
    return res.status(404).json({ error: 'Sub Order No not found' });
  }

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

  const profit = listedPrice - discountedPrice;

  res.json({
    listedPrice,
    discountedPrice,
    profit
  });
});

// NEW: Profit calculation endpoint
app.post('/calculate', (req, res) => {
  const { listedPrice, discountedPrice } = req.body;

  if (listedPrice === undefined || discountedPrice === undefined) {
    return res.status(400).json({ error: 'Both prices are required' });
  }

  const profit = listedPrice - discountedPrice;
  const profitPercent = discountedPrice !== 0 ? (profit / discountedPrice) * 100 : 0;

  res.json({
    profit,
    profitPercent: profitPercent.toFixed(2)
  });
});

// Save all data to MongoDB
app.post('/submit-all', async (req, res) => {
  try {
    const submittedData = req.body;

    if (!db) {
      return res.status(500).json({ message: "Database not connected" });
    }

    const collection = db.collection("dashboard_data");

    await collection.insertOne({
      submittedAt: new Date(),
      data: submittedData
    });

    console.log("✅ Data inserted into MongoDB");
    res.json({ message: "All data submitted and saved to MongoDB!" });

  } catch (error) {
    console.error("❌ Error saving to MongoDB:", error);
    res.status(500).json({ message: "Failed to submit all data" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
