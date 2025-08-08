import React, { useState } from 'react';
import axios from 'axios';
import './Excel.css';

function App() {
  const [file, setFile] = useState(null);
  const [data, setData] = useState({
    delivered: 0,
    rto: 0,
    pending: 0,
    return: 0,
    cancel: 0,
    shipped: 0,
    other: 0,
  });
  const [dragActive, setDragActive] = useState(false);

  const handleFileChange = (e) => {
    const selectedFile = e.target.files?.[0];
    if (
      selectedFile &&
      (selectedFile.name.endsWith('.csv') ||
        selectedFile.name.endsWith('.xlsx') ||
        selectedFile.name.endsWith('.xls'))
    ) {
      setFile(selectedFile);
    } else {
      alert('Please upload a valid CSV or Excel file');
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragActive(false);
    const droppedFile = e.dataTransfer.files[0];
    if (
      droppedFile &&
      (droppedFile.name.endsWith('.csv') ||
        droppedFile.name.endsWith('.xlsx') ||
        droppedFile.name.endsWith('.xls'))
    ) {
      setFile(droppedFile);
    } else {
      alert('Only .csv or .xlsx files are supported');
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragActive(true);
  };

  const handleDragLeave = () => {
    setDragActive(false);
  };

  const handleUpload = async () => {
    if (!file) {
      alert('Please upload a file first');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await axios.post('http://localhost:5000/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      const result = res.data;

      setData({
        delivered: result.delivered?.length || 0,
        rto: result.rto?.length || 0,
        pending: result.pending?.length || 0,
        return: result.return?.length || 0,
        cancel: result.cancel?.length || 0,
        shipped: result.shipped?.length || 0,
        other: result.other?.length || 0,
      });
    } catch (err) {
      console.error('Upload failed', err);
      alert('Upload failed');
    }
  };

  return (
    <div className="App">
      <nav className="navbar">
        <div className="navbar-logo">Meesho</div>
        <div className="navbar-links">
          <a href="/">Home</a>
          <a href="/">Upload</a>
          <a href="/">Dashboard</a>
        </div>
      </nav>

      <h1 className="heading">Product Status Dashboard</h1>

      <div className="status-boxes">
        <div className="box buy">
          Delivered<br />
          <span>{data.delivered}</span>
        </div>
        <div className="box rto">
          Pending<br />
          <span>{data.pending}</span>
        </div>
        <div className="box return">
          Return<br />
          <span>{data.return}</span>
        </div>
        <div className="box cancel">
          Cancel<br />
          <span>{data.cancel}</span>
        </div>
        <div className="box shipped">
          Shipped<br />
          <span>{data.shipped}</span>
        </div>
        <div className="box other">
          RTO<br />
          <span>{data.rto}</span>
        </div>
        <div className="box other">
          Other<br />
          <span>{data.other}</span>
        </div>
      </div>

      <div
        className={`upload-section ${dragActive ? 'drag-active' : ''}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        <p>Drag and drop your CSV or Excel file here or</p>
        <input
          type="file"
          accept=".csv, .xlsx, .xls"
          onChange={handleFileChange}
        />
        {file && <p className="filename">Selected File: {file.name}</p>}
        <button onClick={handleUpload}>Upload File</button>
      </div>
    </div>
  );
}

export default App;
