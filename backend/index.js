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

// ✅ All statuses from name.txt (lowercase for matching)
const statusList = [
  "all",
  "rto_complete",
  "door_step_exchanged",
  "delivered",
  "cancelled",
  "rto_locked",
  "ready_to_ship",
  "shipped",
  "rto_initiated"
];

// ✅ Categorization function
function categorizeRows(rows) {
  const categories = {};

  // Create empty arrays for each category
  statusList.forEach(status => {
    categories[status] = [];
  });

  // Extra category for anything unmatched
  categories.other = [];

  rows.forEach(row => {
    const status = (row['Reason for Credit Entry'] || '').toLowerCase().trim();

    // Push into "all" always
    categories["all"].push(row);

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

  return categories;
}

// ✅ Upload route
app.post('/upload', upload.single('file'), (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file uploaded' });

  const ext = path.extname(file.originalname).toLowerCase();

  if (ext === '.csv') {
    const results = [];
    fs.createReadStream(file.path)
      .pipe(csv())
      .on('data', (data) => results.push(data)) // keeps all fields
      .on('end', () => {
        fs.unlinkSync(file.path);
        res.json(categorizeRows(results));
      });
  } 
  else if (ext === '.xlsx' || ext === '.xls') {
    const workbook = XLSX.readFile(file.path);
    const sheetName = workbook.SheetNames[0];
    const jsonData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]); // keeps all fields
    fs.unlinkSync(file.path);
    res.json(categorizeRows(jsonData));
  } 
  else {
    fs.unlinkSync(file.path);
    res.status(400).json({ error: 'Unsupported file format' });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
