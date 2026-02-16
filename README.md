# Q-Prism® SNP Visualizer

![Python 3.12](https://img.shields.io/badge/python-3.12-blue.svg)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688.svg)
![Docker](https://img.shields.io/badge/docker-automated-blue)
![Tests](https://img.shields.io/badge/tests-49%20passing-brightgreen)
![License](https://img.shields.io/badge/license-MIT-green)

A web-based analysis tool for Allele-Specific Genotyping PCR (ASG-PCR) SNP discrimination. Q-Prism® provides interactive visualization of real-time PCR fluorescence data, enabling rapid genotype analysis directly in the browser.

> **Disclaimer**: Q-Prism® is a project name. It is not affiliated with or endorsed by Applied Biosystems, Thermo Fisher Scientific, or Bio-Rad Laboratories.

## Overview

The SNP Visualizer parses raw data files from common qPCR instruments and renders interactive scatter plots, plate views, and amplification curves. It eliminates the need for proprietary desktop software for routine allele discrimination analysis, offering a lightweight, containerized alternative with ROX normalization and cycle-by-cycle playback.

## Features

- **Allelic Discrimination Scatter Plot** -- FAM vs. VIC/HEX with ROX normalization, WebGL-accelerated
- **96-Well Plate View** -- Color-coded wells with bidirectional selection (click plate or scatter point to sync)
- **Cycle-by-Cycle Slider** -- Animate amplification progress with play/pause controls
- **Per-Well Amplification Curves** -- Click any well to view its full fluorescence trajectory
- **Smart File Detection** -- Auto-identifies instrument and file type across 15 export formats, with specific guidance for unsupported files
- **PCR Protocol Editor** -- Interactive thermal profile visualization
- **Multi-File Drag-and-Drop** -- Drop multiple XML files or entire folders; client-side ZIP packaging via JSZip

## Supported Instruments and Formats

| Instrument | Format | Description |
| :--- | :--- | :--- |
| **QuantStudio 3** (Applied Biosystems) | `.eds` | Raw instrument files (ZIP archive with multicomponent XML) |
| | `.xls` | Exported Multicomponent Data or Amplification Data |
| **CFX Opus** (Bio-Rad) | `.xlsx` | Amplification Results, End Point Results, or Allelic Discrimination |
| | `.zip` | Archived XML exports (~16 files per run) |
| | Folder / multi-XML | Drag-and-drop XML files or folders (auto-zipped client-side) |

5 formats accepted, 10 rejected with helpful error messages pointing users to the correct export.

## Quick Start

### Prerequisites

- Docker

### Run

```bash
git clone https://github.com/Key-man-fromArchive/Q-Prism-SNP-visualizer.git
cd Q-Prism-SNP-visualizer/snp-analyzer
docker compose up --build
```

Open `http://localhost:8002` in your browser.

### Local Development (without Docker)

```bash
cd snp-analyzer
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8002
```

## Testing

49 Playwright E2E tests covering uploads, interactions, error handling, and API endpoints.

```bash
# From project root
npm install
npx playwright install chromium
npx playwright test
```

## Architecture

### Backend (Python / FastAPI)

- **Smart Detector** (`detector.py`) -- routes files to the correct parser based on extension and content
- **Parsers** -- `quantstudio.py`, `cfx_opus.py`, `cfx_xml_parser.py`, `eds_raw.py`
- **Normalization** -- ROX-based: FAM/ROX, Allele2/ROX
- **Session Store** -- In-memory with Pydantic `UnifiedData` model
- **Endpoints** -- `POST /api/upload`, `GET /api/data/{session_id}/scatter`, `/plate`, `/amplification`

### Frontend (Vanilla JS, no build step)

- **Plotly.js** -- WebGL `scattergl` for performant rendering
- **JSZip** -- Client-side ZIP creation for multi-file uploads
- **ES Modules** -- `app.js`, `scatter.js`, `plateview.js`, `cycleslider.js`, `protocol.js`, `settings.js`

## Project Structure

```
snp-analyzer/
  app/
    main.py                 # FastAPI entry point
    config.py               # Constants (session expiry, upload limits)
    models.py               # Pydantic data models
    parsers/
      detector.py           # Smart file format detection
      quantstudio.py        # QuantStudio 3 .xls parser
      cfx_opus.py           # CFX Opus .xlsx parser
      cfx_xml_parser.py     # CFX XML ZIP parser
      eds_raw.py            # QuantStudio .eds raw parser
      xlsx_fixer.py         # CFX xlsx repair utility
    processing/
      normalize.py          # ROX normalization
    routers/
      upload.py             # File upload endpoint
      data.py               # Data retrieval endpoints
    static/
      index.html
      css/style.css
      js/                   # Frontend ES modules
  Dockerfile
  docker-compose.yml
  requirements.txt
tests/                      # 49 Playwright E2E tests
playwright.config.ts
CFX-opus/                   # Format analysis documentation
```

## License

MIT
