# AI-Based MT5 Trading Log & Slippage Analyzer

An advanced, broker-independent SaaS portal designed for risk officers, dealers, and compliance teams to reconstruct MT5 client order lifecycles, isolate execution slippage, calculate millisecond latencies, and generate AI-compliance audits.

---

## 🚀 Key Features

* **Broker-Independent Log Correlation Engine**: Uses explicit transaction IDs (Order ID, Deal ID, Position ID) with side-specific directional fallbacks to reconstruct trade lifecycles, preventing time-proximity mapping errors on high-frequency trades.
* **Entry and Exit leg Isolation**: Separately analyzes opening (entry) and closing (exit) executions for raw price difference, point slippage, adverse/favorable classification, and execution delay.
* **Dynamic Symbol Specifications**: Automatically queries contract digits and point sizes from connected MT5 servers ($10^{-\text{digits}}$ fallback) to accurately convert price differences into slippage points across Metals, Indices, FX, and Cryptos.
* **Persisted Database Self-Healing**: Automatically triggers dynamic metrics recalculation and database record patching on-the-fly when historical compliance files are queried.
* **Compliance AI Audit Report**: Integrates LLM analysis to construct chronological timeline compliance summaries and answer caseworker follow-up questions.
* **Excel Data Export**: One-click client-side export to download reconstructed positions as formatted, Excel-compatible CSVs.

---

## 🛠 Tech Stack

* **Frontend**: React (Vite), TypeScript, Tailwind CSS, TanStack Query, Lucide Icons
* **Backend**: NestJS, TypeScript, Prisma ORM, SQLite / PostgreSQL
* **MT5 Connector**: Python, FastAPI, MetaTrader 5 Manager DLL wrapper
* **Database**: SQLite (local development) / PostgreSQL (production)

---

## ⚙️ Project Directory Structure

```text
├── backend/            # NestJS API Gateway & Metrics Engine
├── frontend/           # React + Vite Client Dashboard
├── mt5-connector/      # Python FastAPI gateway to MT5 manager session
├── prisma/             # Schema definitions and database migrations
└── package.json        # Monorepo workspace configuration
```

---

## 🔧 Installation & Quick Start

### Prerequisites
* Node.js (v18+)
* Python (3.10+)
* Windows OS (Required for native MT5 DLL bindings)

### 1. Initialize Workspace Dependencies
From the root of the project, run:
```bash
npm install
```

### 2. Configure Database
Set up your SQLite database file and run the migrations:
```bash
npx prisma db push
```

### 3. Spin up Python Connector Daemon
Install the Python virtual environment and start the uvicorn API:
```bash
cd mt5-connector
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python -m uvicorn main:app --host 127.0.0.1 --port 4500
```

### 4. Start Development Servers
Run both NestJS backend and React frontend concurrently from the root directory:
```bash
npm run dev
```

The portal will be active at:
* **Frontend**: `http://localhost:3000`
* **API Gateway**: `http://localhost:4000/api/v1`

---

## 🧪 Running Automated Test Suites

The backend includes Jest tests covering normalization engines, ID-based correlation priorities, slippage calculations, and latency checks.

To run the backend tests:
```bash
npm run test -w backend
```
