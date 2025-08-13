import React, { useState } from 'react';
import axios from 'axios';
import './Excel.css';

function App() {
  const [file, setFile] = useState(null);
  const [subOrderNo, setSubOrderNo] = useState("");
  const [filterResult, setFilterResult] = useState(null);

  const [data, setData] = useState({
    all: 0,
    rto_complete: 0,
    door_step_exchanged: 0,
    delivered: 0,
    cancelled: 0,
    rto_locked: 0,
    ready_to_ship: 0,
    shipped: 0,
    rto_initiated: 0,
    other: 0,
    totalSupplierListedPrice: 0,
    totalSupplierDiscountedPrice: 0
  });

  const [dragActive, setDragActive] = useState(false);
  const [showFilteredView, setShowFilteredView] = useState(false); // NEW STATE

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
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      const result = res.data;

      setData({
        all: result.all?.length || 0,
        rto_complete: result.rto_complete?.length || 0,
        door_step_exchanged: result.door_step_exchanged?.length || 0,
        delivered: result.delivered?.length || 0,
        cancelled: result.cancelled?.length || 0,
        rto_locked: result.rto_locked?.length || 0,
        ready_to_ship: result.ready_to_ship?.length || 0,
        shipped: result.shipped?.length || 0,
        rto_initiated: result.rto_initiated?.length || 0,
        other: result.other?.length || 0,
        totalSupplierListedPrice: result.totals?.totalSupplierListedPrice || 0,
        totalSupplierDiscountedPrice: result.totals?.totalSupplierDiscountedPrice || 0
      });

      setShowFilteredView(false); // Reset to normal view after upload
    } catch (err) {
      console.error('Upload failed', err);
      alert('Upload failed');
    }
  };

  const handleFilter = async () => {
    if (!subOrderNo) {
      alert("Please enter a Sub Order No.");
      return;
    }

    try {
      const res = await axios.get(`http://localhost:5000/filter/${subOrderNo}`);
      setFilterResult(res.data);
      setShowFilteredView(true); // Switch to filtered view
    } catch (err) {
      console.error("Filter failed", err);
      alert("No matching sub order found");
    }
  };

  return (
    <div className="App">
      <nav className="navbar">
        <div className="navbar-logo">Meesho</div>

        <div className="navbar-search">
          <input 
            type="search" 
            placeholder="Add here Sub Order No" 
            value={subOrderNo}
            onChange={(e) => setSubOrderNo(e.target.value)}
          />
          <button className="filter-btn" onClick={handleFilter}>Filter</button>
        </div>

        <div className="navbar-links">
          <a href="/">Home</a>
          <a href="/">Upload</a>
          <a href="/">Dashboard</a>
        </div>
      </nav>

      <h1 className="heading">Product Status Dashboard</h1>

      {!showFilteredView ? (
        <div className="status-boxes">
          <div className="box all">
            All<br />
            <span>{data.all}</span>
          </div>
          <div className="box rto_complete">
            RTO Complete<br />
            <span>{data.rto_complete}</span>
          </div>
          <div className="box door_step_exchanged">
            Door Step Exchanged<br />
            <span>{data.door_step_exchanged}</span>
          </div>
          <div className="box delivered">
            Delivered<br />
            <span>{data.delivered}</span>
          </div>
          <div className="box cancelled">
            Cancelled<br />
            <span>{data.cancelled}</span>
          </div>
          <div className="box rto_locked">
            RTO Locked<br />
            <span>{data.rto_locked}</span>
          </div>
          <div className="box ready_to_ship">
            Pending<br />
            <span>{data.ready_to_ship}</span>
          </div>
          <div className="box shipped">
            Shipped<br />
            <span>{data.shipped}</span>
          </div>
          <div className="box rto_initiated">
            RTO Initiated<br />
            <span>{data.rto_initiated}</span>
          </div>
          <div className="box other">
            Other<br />
            <span>{data.other}</span>
          </div>

          <div className="box other">
            Supplier Listed Total Price (Incl. GST + Commission)<br />
            <span>{data.totalSupplierListedPrice.toLocaleString()}</span>
          </div>

          <div className="box other">
            Supplier Discounted Total Price (Incl GST and Commission)<br />
            <span>{data.totalSupplierDiscountedPrice.toLocaleString()}</span>
          </div>
        </div>
      ) : (
        filterResult && (
          <div className="status-boxes">
            <div className="box other">
              Supplier Listed Price (Incl. GST + Commission)<br />
              <span>{filterResult.listedPrice.toLocaleString()}</span>
            </div>
            <div className="box other">
              Supplier Discounted Price (Incl GST and Commission)<br />
              <span>{filterResult.discountedPrice.toLocaleString()}</span>
            </div>
          </div>
        )
      )}

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
