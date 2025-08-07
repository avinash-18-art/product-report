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

// ✅ Updated: Helper to categorize rows by status
function categorizeRows(rows) {
  const categories = {
    delivered: [],
    pending: [],
    rto: [],
    return: [],
    shipped: [],
    cancel: [],
    other: [],
  };

  rows.forEach(row => {
    // ✅ Find the status field dynamically (status, Status, Order Status, etc.)
    const statusKey = Object.keys(row).find(
      key => key.toLowerCase().includes('status')
    );

    const status = (row[statusKey] || '').toLowerCase().trim();

    if (status.includes('delivered')) categories.delivered.push(row);
    else if (status.includes('pending')) categories.pending.push(row);
    else if (status.includes('rto')) categories.rto.push(row);
    else if (status.includes('return')) categories.return.push(row);
    else if (status.includes('shipped')) categories.shipped.push(row);
    else if (status.includes('cancel')) categories.cancel.push(row);
    else categories.other.push(row);
  });

  return categories;
}

// ✅ Upload endpoint
app.post('/upload', upload.single('file'), (req, res) => {
  const file = req.file;
  const ext = path.extname(file.originalname).toLowerCase();

  if (!file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  if (ext === '.csv') {
    const results = [];

    fs.createReadStream(file.path)
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', () => {
        fs.unlinkSync(file.path); // Clean up
        const categorized = categorizeRows(results);
        res.json(categorized);
      });

  } else if (ext === '.xlsx' || ext === '.xls') {
    const workbook = XLSX.readFile(file.path);
    const sheetName = workbook.SheetNames[0];
    const jsonData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
    fs.unlinkSync(file.path); // Clean up
    const categorized = categorizeRows(jsonData);
    res.json(categorized);
  } else {
    fs.unlinkSync(file.path);
    res.status(400).json({ error: 'Unsupported file format' });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
