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

// Updated categorization to match your Excel file
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
    // Use the exact column name from your Excel
    const status = (row['Reason for Credit Entry'] || '').toLowerCase().trim();

    if (status.includes('delivered')) categories.delivered.push(row);
    else if (status.includes('pending') || status.includes('ready_to_ship')) categories.pending.push(row);
    else if (status.includes('rto')) categories.rto.push(row);
    else if (status.includes('exchange') || status.includes('return')) categories.return.push(row);
    else if (status.includes('shipped')) categories.shipped.push(row);
    else if (status.includes('cancel')) categories.cancel.push(row);
    else categories.other.push(row);
  });

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
  } 
  else if (ext === '.xlsx' || ext === '.xls') {
    const workbook = XLSX.readFile(file.path);
    const sheetName = workbook.SheetNames[0];
    const jsonData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
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
