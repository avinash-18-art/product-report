const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = 5000;

app.use(cors());
const upload = multer({ dest: 'uploads/' });

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

// ✅ Clean and convert prices
function parsePrice(value) {
  if (!value) return 0;
  let clean = value.toString().trim().replace(/[^0-9.\-]/g, '');
  return parseFloat(clean) || 0;
}

// ✅ Get column value by checking multiple possible header names
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

function categorizeRows(rows) {
  const categories = {};
  statusList.forEach(status => {
    categories[status] = [];
  });
  categories.other = [];

  let totalSupplierListedPrice = 0;
  let totalSupplierDiscountedPrice = 0;

  rows.forEach(row => {
    const status = (row['Reason for Credit Entry'] || '').toLowerCase().trim();

    // Add to "all"
    categories["all"].push(row);

    // ✅ Match listed price columns
    const listedPrice = parsePrice(getColumnValue(row, [
      'Supplier Listed Price (Incl. GST + Commission)',
      'Supplier Listed Price',
      'Listed Price'
    ]));

    // ✅ Match discounted price columns — includes the CSV’s “Commision” typo
    const discountedPrice = parsePrice(getColumnValue(row, [
      'Supplier Discounted Price (Incl GST and Commission)', // correct spelling
      'Supplier Discounted Price (Incl GST and Commision)',  // CSV typo spelling
      'Supplier Discounted Price',
      'Discounted Price'
    ]));

    totalSupplierListedPrice += listedPrice;
    totalSupplierDiscountedPrice += discountedPrice;

    // Match by status
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

  // Add totals
  categories.totals = {
    totalSupplierListedPrice,
    totalSupplierDiscountedPrice
  };

  return categories;
}

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
        res.json(categorizeRows(results));
      });
  } else if (ext === '.xlsx' || ext === '.xls') {
    const workbook = XLSX.readFile(file.path);
    const sheetName = workbook.SheetNames[0];
    const jsonData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
    fs.unlinkSync(file.path);
    res.json(categorizeRows(jsonData));
  } else {
    fs.unlinkSync(file.path);
    res.status(400).json({ error: 'Unsupported file format' });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
