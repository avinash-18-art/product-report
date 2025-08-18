import React, { useState } from "react";
import axios from "axios";
import "./Excel.css";

function App() {
  const [file, setFile] = useState(null);
  const [subOrderNo, setSubOrderNo] = useState("");
  const [filterResult, setFilterResult] = useState(null);

  const [data, setData] = useState({
    all: 0,
    rto: 0,
    door_step_exchanged: 0,
    delivered: 0,
    cancelled: 0,
    ready_to_ship: 0,
    shipped: 0,
    other: 0,
    totalSupplierListedPrice: 0,
    totalSupplierDiscountedPrice: 0,
    sellInMonth: 0,
    totalProfit: 0,
    deliveredSupplierDiscountedPriceTotal: 0,
  });

  const [profitPercent, setProfitPercent] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const [showFilteredView, setShowFilteredView] = useState(false);

  const handleFileChange = (e) => {
    const selectedFile = e.target.files?.[0];
    if (
      selectedFile &&
      (selectedFile.name.endsWith(".csv") ||
        selectedFile.name.endsWith(".xlsx") ||
        selectedFile.name.endsWith(".xls"))
    ) {
      setFile(selectedFile);
    } else {
      alert("Please upload a valid CSV or Excel file");
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragActive(false);
    const droppedFile = e.dataTransfer.files[0];
    if (
      droppedFile &&
      (droppedFile.name.endsWith(".csv") ||
        droppedFile.name.endsWith(".xlsx") ||
        droppedFile.name.endsWith(".xls"))
    ) {
      setFile(droppedFile);
    } else {
      alert("Only .csv or .xlsx files are supported");
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragActive(true);
  };

  const handleDragLeave = () => {
    setDragActive(false);
  };

  const handleFilter = async () => {
    if (!subOrderNo) {
      alert("Please enter a Sub Order No.");
      return;
    }

    try {
      const res = await axios.get(`http://localhost:5000/filter/${subOrderNo}`);
      setFilterResult(res.data);

      const calcProfit = res.data.discountedPrice - res.data.listedPrice ;
      const calcProfitPercent = res.data.discountedPrice
        ? (calcProfit / res.data.discountedPrice) * 100
        : 0;

      setProfitPercent(calcProfitPercent.toFixed(2));
      setShowFilteredView(true);
    } catch (err) {
      console.error("Filter failed", err);
      alert("No matching sub order found");
    }
  };

  const handleSubmitAll = async () => {
    if (!file) {
      alert("Please select a file first");
      return;
    }

    try {
      const formData = new FormData();
      formData.append("file", file);

      
      const uploadRes = await axios.post("http://localhost:5000/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      const result = uploadRes.data;
      const totalListed = result.totals?.totalSupplierListedPrice || 0;
      const totalDiscounted = result.totals?.totalSupplierDiscountedPrice || 0;
      const totalProfit = result.totals?.totalProfit || 0;
      const deliveredTotalDiscounted =
        result.totals?.deliveredSupplierDiscountedPriceTotal || 0;

      const updatedData = {
        all: result.all?.length || 0,
        rto: result.rto?.length || 0,
        door_step_exchanged: result.door_step_exchanged?.length || 0,
        delivered: result.delivered?.length || 0,
        cancelled: result.cancelled?.length || 0,
        ready_to_ship: result.ready_to_ship?.length || 0,
        shipped: result.shipped?.length || 0,
        other: result.other?.length || 0,
        totalSupplierListedPrice: totalListed,
        totalSupplierDiscountedPrice: totalDiscounted,
        sellInMonth: result.totals?.sellInMonth || 0,
        totalProfit,
        deliveredSupplierDiscountedPriceTotal: deliveredTotalDiscounted,
      };

      setData(updatedData);

      const calcProfitPercent = totalDiscounted
        ? (totalProfit / totalDiscounted) * 100
        : 0;
      setProfitPercent(calcProfitPercent.toFixed(2));

      
      await axios.post("http://localhost:5000/save-to-db", {
        fileName: file.name,
        processedData: updatedData,
      });

      alert("File processed and data saved to MongoDB!");
    } catch (err) {
      console.error("Submit all failed", err);
      alert("Failed to process & store data");
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
          <button className="filter-btn" onClick={handleFilter}>
            Filter
          </button>
          {showFilteredView && (
            <button
              className="back-btn"
              onClick={() => setShowFilteredView(false)}
              style={{
                marginLeft: "8px",
                padding: "4px 8px",
                fontSize: "12px",
                backgroundColor: "#ccc",
                border: "none",
                borderRadius: "8px",
                cursor: "pointer",
                height: "38px",
                width: "60px",
              }}
            >
              Back
            </button>
          )}
        </div>
      </nav>

      <h1 className="heading">Product Status Dashboard</h1>

      {!showFilteredView ? (
        <div className="status-boxes">
          <div className="box all">All<br /><span>{data.all}</span></div>
          <div className="box rto">RTO<br /><span>{data.rto}</span></div>
          <div className="box door_step_exchanged">Door Step Exchanged<br /><span>{data.door_step_exchanged}</span></div>
          <div className="box delivered">
            Delivered<br />
            <span>{data.delivered}</span>
            <br />
            <small style={{ fontSize: "32px", color: "#222" }}>
              ₹{data.deliveredSupplierDiscountedPriceTotal.toLocaleString()}
            </small>
          </div>
          <div className="box cancelled">Cancelled<br /><span>{data.cancelled}</span></div>
          <div className="box ready_to_ship">Pending<br /><span>{data.ready_to_ship}</span></div>
          <div className="box shipped">Shipped<br /><span>{data.shipped}</span></div>
          <div className="box other">Other<br /><span>{data.other}</span></div>
          <div className="box other">Supplier Listed Total Price<br /><span>{data.totalSupplierListedPrice.toLocaleString()}</span></div>
          <div className="box other">Supplier Discounted Total Price<br /><span>{data.totalSupplierDiscountedPrice.toLocaleString()}</span></div>
          <div className="box other">Total Profit<br /><span>{data.totalProfit.toLocaleString()}</span></div>
          <div className="box other">Profit %<br /><span>{profitPercent}%</span></div>
        </div>
      ) : (
        filterResult && (
          <div className="status-boxes">
            <div className="box other">
              Supplier Listed Price<br />
              <span>{filterResult.listedPrice.toLocaleString()}</span>
            </div>
            <div className="box other">
              Supplier Discounted Price<br />
              <span>{filterResult.discountedPrice.toLocaleString()}</span>
            </div>
          </div>
        )
      )}

      {/* Drag and Drop File Input */}
      <div
        className={`upload-section ${dragActive ? "drag-active" : ""}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        <p>Drag and drop your CSV or Excel file here</p>
        <input
          type="file"
          accept=".csv, .xlsx, .xls"
          onChange={handleFileChange}
        />
        {file && <p className="filename">Selected File: {file.name}</p>}
      </div>

      <div style={{ marginTop: "20px" }}>
        <button
          onClick={handleSubmitAll}
          style={{
            backgroundColor: "#28a745",
            color: "#fff",
            padding: "10px 20px",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
            fontSize: "14px",
          }}
        >
          Submit All (Upload & Save)
        </button>
      </div>
    </div>
  );
}

export default App;
